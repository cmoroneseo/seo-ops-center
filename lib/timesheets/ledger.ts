import { formatLocalDate, parseLocalDate } from '../planner/local-date.ts';
import type { TimeLogImportStatus, TimeLogSource, TimeLogStatus } from '../types.ts';

/**
 * Weekly read model over the canonical `time_logs` ledger.
 *
 * Pure functions only — no Supabase, no fetch, no clock. Every total the
 * Ledger Grid renders is derived here so the UI never re-implements arithmetic.
 *
 * `time_logs.date` is a Postgres `date`, i.e. already the local calendar day the
 * work happened on. There is therefore no timezone conversion in this module:
 * bucketing a row into a week column is a string comparison against the seven
 * local dates of that week.
 */

/** The `time_logs` fields the weekly read model actually depends on. */
export interface LedgerLog {
    id: string;
    organizationId: string;
    /** Absent for internal work — a 1:1 has no client (migration 030). */
    clientId?: string;
    clientName?: string;
    taskId?: string;
    taskTitle?: string;
    userId: string;
    /** yyyy-MM-dd local calendar day. */
    date: string;
    hours: number;
    description: string;
    countsTowardBudget: boolean;
    status: TimeLogStatus;
    source: TimeLogSource;
    importStatus: TimeLogImportStatus;
    voidedAt?: string;
}

export interface LedgerTaskRow {
    /** Stable identity for selection: client bucket + task bucket. */
    key: string;
    taskId: string | null;
    taskTitle: string;
    /** Which systems contributed to this row, for the quiet source label. */
    sources: TimeLogSource[];
    /** Seven cells, Sunday-first, aligned with `WeeklyLedger.days`. */
    dailyMinutes: number[];
    totalMinutes: number;
    entryIds: string[];
    needsReview: boolean;
}

export interface LedgerClientGroup {
    /** null for the internal bucket and the review bucket — never a guess. */
    clientId: string | null;
    clientName: string;
    isInternal: boolean;
    needsReview: boolean;
    rows: LedgerTaskRow[];
    dailyMinutes: number[];
    totalMinutes: number;
    budgetMinutes: number;
    nonBudgetMinutes: number;
}

export interface LedgerTotals {
    dailyMinutes: number[];
    totalMinutes: number;
    /** Client time that consumes the SEO budget. */
    budgetMinutes: number;
    /** Client time that is tracked but must not eat deliverable budget. */
    nonBudgetMinutes: number;
    /** Time with no client at all. */
    internalMinutes: number;
    unmappedCount: number;
}

export type LedgerExceptionKind = 'unmapped_import';

export interface LedgerException {
    kind: LedgerExceptionKind;
    timeLogId: string;
    date: string;
    minutes: number;
    userId: string;
    description: string;
}

export interface WeeklyLedger {
    weekStart: string;
    days: string[];
    clients: LedgerClientGroup[];
    totals: LedgerTotals;
    exceptions: LedgerException[];
}

export interface WeeklyLedgerOptions {
    /** Restrict to one member. Authorization is enforced server-side, not here. */
    userId?: string;
}

const DAYS_IN_WEEK = 7;
export const INTERNAL_GROUP_LABEL = 'Internal';
export const REVIEW_GROUP_LABEL = 'Needs review';

/** Hours are numeric(5,2); minutes are the unit every total is carried in. */
export function minutesFromHours(hours: number): number {
    if (!Number.isFinite(hours)) return 0;
    return Math.round(hours * 60);
}

function addDays(date: string, days: number): string {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new RangeError(`Invalid ledger date: ${date}`);
    parsed.setDate(parsed.getDate() + days);
    return formatLocalDate(parsed);
}

/** Snap any local date to the Sunday that opens its week. */
export function weekStartFor(date: string): string {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new RangeError(`Invalid ledger date: ${date}`);
    return addDays(date, -parsed.getDay());
}

/** The seven local dates of a week, Sunday-first. */
export function weekDays(weekStart: string): string[] {
    return Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDays(weekStart, index));
}

function emptyDays(): number[] {
    return Array.from({ length: DAYS_IN_WEEK }, () => 0);
}

/** A row that no longer reflects real, resolved, finalized work. */
function isLedgerEligible(log: LedgerLog): boolean {
    return log.status === 'logged'
        && log.importStatus !== 'voided'
        && !log.voidedAt;
}

/**
 * Unresolved imports get their own bucket. We deliberately do not fall back to
 * whatever client/task the payload hinted at — a wrong attribution is worse
 * than a visible exception.
 */
function isUnmapped(log: LedgerLog): boolean {
    return log.importStatus === 'needs_review';
}

interface GroupKey {
    clientId: string | null;
    clientName: string;
    isInternal: boolean;
    needsReview: boolean;
}

function groupKeyFor(log: LedgerLog): GroupKey {
    if (isUnmapped(log)) {
        return {
            clientId: null,
            clientName: REVIEW_GROUP_LABEL,
            isInternal: false,
            needsReview: true,
        };
    }
    if (!log.clientId) {
        return {
            clientId: null,
            clientName: INTERNAL_GROUP_LABEL,
            isInternal: true,
            needsReview: false,
        };
    }
    return {
        clientId: log.clientId,
        clientName: log.clientName ?? 'Unnamed client',
        isInternal: false,
        needsReview: false,
    };
}

function groupIdentity(key: GroupKey): string {
    if (key.needsReview) return 'review';
    return key.clientId ?? 'internal';
}

interface RowAccumulator extends LedgerTaskRow {
    sourceSet: Set<TimeLogSource>;
}

interface GroupAccumulator extends GroupKey {
    rows: Map<string, RowAccumulator>;
    dailyMinutes: number[];
    totalMinutes: number;
    budgetMinutes: number;
    nonBudgetMinutes: number;
}

/**
 * Build the weekly Ledger Grid read model.
 *
 * @param logs   any set of ledger rows; entries outside the week are ignored
 * @param weekStart the Sunday that opens the week (yyyy-MM-dd)
 */
export function buildWeeklyLedger(
    logs: LedgerLog[],
    weekStart: string,
    options: WeeklyLedgerOptions = {},
): WeeklyLedger {
    const days = weekDays(weekStart);
    const dayIndex = new Map(days.map((day, index) => [day, index]));

    const groups = new Map<string, GroupAccumulator>();
    const exceptions: LedgerException[] = [];
    const totals: LedgerTotals = {
        dailyMinutes: emptyDays(),
        totalMinutes: 0,
        budgetMinutes: 0,
        nonBudgetMinutes: 0,
        internalMinutes: 0,
        unmappedCount: 0,
    };

    for (const log of logs) {
        if (options.userId && log.userId !== options.userId) continue;
        if (!isLedgerEligible(log)) continue;

        const index = dayIndex.get(log.date);
        if (index === undefined) continue;

        const minutes = minutesFromHours(log.hours);
        const key = groupKeyFor(log);
        const identity = groupIdentity(key);

        let group = groups.get(identity);
        if (!group) {
            group = {
                ...key,
                rows: new Map(),
                dailyMinutes: emptyDays(),
                totalMinutes: 0,
                budgetMinutes: 0,
                nonBudgetMinutes: 0,
            };
            groups.set(identity, group);
        }

        // An unmapped import has no trustworthy task, so it rows up by entry.
        const rowKey = key.needsReview
            ? `${identity}:entry:${log.id}`
            : `${identity}:${log.taskId ?? 'untasked'}`;
        let row = group.rows.get(rowKey);
        if (!row) {
            row = {
                key: rowKey,
                taskId: key.needsReview ? null : (log.taskId ?? null),
                taskTitle: key.needsReview
                    ? (log.description || 'Imported entry')
                    : (log.taskTitle ?? 'Untasked time'),
                sources: [],
                sourceSet: new Set<TimeLogSource>(),
                dailyMinutes: emptyDays(),
                totalMinutes: 0,
                entryIds: [],
                needsReview: key.needsReview,
            };
            group.rows.set(rowKey, row);
        }

        row.sourceSet.add(log.source);
        row.dailyMinutes[index] += minutes;
        row.totalMinutes += minutes;
        row.entryIds.push(log.id);

        group.dailyMinutes[index] += minutes;
        group.totalMinutes += minutes;

        totals.dailyMinutes[index] += minutes;
        totals.totalMinutes += minutes;

        if (key.isInternal) {
            totals.internalMinutes += minutes;
        } else if (log.countsTowardBudget) {
            group.budgetMinutes += minutes;
            totals.budgetMinutes += minutes;
        } else {
            group.nonBudgetMinutes += minutes;
            totals.nonBudgetMinutes += minutes;
        }

        if (key.needsReview) {
            totals.unmappedCount += 1;
            exceptions.push({
                kind: 'unmapped_import',
                timeLogId: log.id,
                date: log.date,
                minutes,
                userId: log.userId,
                description: log.description,
            });
        }
    }

    const clients: LedgerClientGroup[] = [...groups.values()]
        .map(group => ({
            clientId: group.clientId,
            clientName: group.clientName,
            isInternal: group.isInternal,
            needsReview: group.needsReview,
            dailyMinutes: group.dailyMinutes,
            totalMinutes: group.totalMinutes,
            budgetMinutes: group.budgetMinutes,
            nonBudgetMinutes: group.nonBudgetMinutes,
            rows: [...group.rows.values()]
                .map(({ sourceSet, ...row }) => ({ ...row, sources: [...sourceSet] }))
                .sort((left, right) => left.taskTitle.localeCompare(right.taskTitle)),
        }))
        // Review first (it is actionable), then clients A-Z, then internal.
        .sort((left, right) => {
            const rank = (group: LedgerClientGroup) =>
                group.needsReview ? 0 : group.isInternal ? 2 : 1;
            const byRank = rank(left) - rank(right);
            return byRank !== 0 ? byRank : left.clientName.localeCompare(right.clientName);
        });

    return { weekStart, days, clients, totals, exceptions };
}
