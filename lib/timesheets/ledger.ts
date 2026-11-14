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
    /** Set when one confirmed timer was stored as a row per local date. */
    operationId?: string;
    /** Active seconds on this dated row, before hours were rounded. */
    elapsedSeconds?: number;
    /** When a paused bot timer last stopped a stretch. */
    pausedAt?: string;
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
    /** Bot timer paused in SEO Ops. Not confirmed time and not sent to Basecamp. */
    paused: boolean;
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

export type LedgerExceptionKind = 'unmapped_import' | 'bot_timer_cap' | 'bot_timer_paused';

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
    /** Clock for the stale-paused hint. Tests pass a fixed instant. */
    now?: Date;
}

const DAYS_IN_WEEK = 7;
export const INTERNAL_GROUP_LABEL = 'Internal';
export const REVIEW_GROUP_LABEL = 'Needs review';
export const BOT_TIMER_REVIEW_LABEL = 'Bot timer review';
export const PAUSED_BOT_TIMER_LABEL = 'Paused bot timers';
/** Matches the sweep. A paused bot timer older than this is marked for review and is not closed. */
export const PAUSED_BOT_TIMER_STALE_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Snap any local date to the Monday that opens its week.
 *
 * This was the only part of the app opening its week on Sunday. `AgencyWidgets`
 * already did its own Monday arithmetic (`getDay() === 0 ? 6 : getDay() - 1`),
 * so the two disagreed about which week a Sunday's work belonged to.
 *
 * Safe to change because nothing persists a weekly key: weeks are computed on
 * read, and `timesheet_client_approvals` snapshots client *months*, whose totals
 * are unaffected. Only which days group together in the grid moves.
 */
export function weekStartFor(date: string): string {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new RangeError(`Invalid ledger date: ${date}`);
    // getDay(): 0 = Sunday, which closes the week that opened six days earlier.
    return addDays(date, -((parsed.getDay() + 6) % 7));
}

/** The seven local dates of a week, Monday-first. */
export function weekDays(weekStart: string): string[] {
    return Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDays(weekStart, index));
}

function emptyDays(): number[] {
    return Array.from({ length: DAYS_IN_WEEK }, () => 0);
}

/**
 * A row that no longer reflects real, resolved, finalized work.
 * `needs_review` is a bot timer stopped because it passed BOT_TIMER_MAX_SECONDS.
 * It is visible and it is not confirmed client time until the owner accepts it.
 * `paused` is a bot timer waiting for more work. It is visible and it is not
 * budget time until stop.
 */
function isLedgerEligible(log: LedgerLog): boolean {
    return (log.status === 'logged' || log.status === 'needs_review' || log.status === 'paused')
        && log.importStatus !== 'voided'
        && !log.voidedAt;
}

/**
 * Unresolved imports get their own bucket. We deliberately do not fall back to
 * whatever client/task the payload hinted at — a wrong attribution is worse
 * than a visible exception.
 *
 * `pending_review` is submitted, not approved: the member has supplied context
 * but no manager has accepted it, so it is not yet countable time. Rendering it
 * as ordinary client time would tell a manager the month is settled while the
 * queue behind it is still open. Only `mapped` counts.
 */
export function isUnmappedImport(log: Pick<LedgerLog, 'importStatus'>): boolean {
    return log.importStatus === 'needs_context' || log.importStatus === 'pending_review';
}

interface GroupKey {
    clientId: string | null;
    clientName: string;
    isInternal: boolean;
    needsReview: boolean;
    paused: boolean;
}

function groupKeyFor(log: LedgerLog): GroupKey {
    if (log.status === 'paused') {
        return {
            clientId: null,
            clientName: PAUSED_BOT_TIMER_LABEL,
            isInternal: false,
            needsReview: true,
            paused: true,
        };
    }
    if (log.status === 'needs_review') {
        return {
            clientId: null,
            clientName: BOT_TIMER_REVIEW_LABEL,
            isInternal: false,
            needsReview: true,
            paused: false,
        };
    }
    if (isUnmappedImport(log)) {
        return {
            clientId: null,
            clientName: REVIEW_GROUP_LABEL,
            isInternal: false,
            needsReview: true,
            paused: false,
        };
    }
    if (!log.clientId) {
        return {
            clientId: null,
            clientName: INTERNAL_GROUP_LABEL,
            isInternal: true,
            needsReview: false,
            paused: false,
        };
    }
    return {
        clientId: log.clientId,
        clientName: log.clientName ?? 'Unnamed client',
        isInternal: false,
        needsReview: false,
        paused: false,
    };
}

function groupIdentity(key: GroupKey): string {
    if (key.needsReview) return `review:${key.clientName}`;
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
    const nowMs = (options.now ?? new Date()).getTime();

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
        // A capped bot timer is already on a task. Keep that task so the owner
        // can see which piece of work ran long.
        const importReview = key.clientName === REVIEW_GROUP_LABEL;
        const rowKey = importReview
            ? `${identity}:entry:${log.id}`
            : `${identity}:${log.taskId ?? 'untasked'}`;
        let row = group.rows.get(rowKey);
        if (!row) {
            row = {
                key: rowKey,
                taskId: importReview ? null : (log.taskId ?? null),
                taskTitle: importReview
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

        // Paused bot time is visible on its own row. It is not confirmed yet,
        // so it stays out of the week footer until stop finalizes the entry.
        if (!key.paused) {
            totals.dailyMinutes[index] += minutes;
            totals.totalMinutes += minutes;
        }

        // Unapproved import time is not client time yet. It shows in the week's
        // totals and in its own bucket, but it must never be reported as
        // consuming — or as being exempt from — an SEO budget.
        if (!key.needsReview) {
            if (key.isInternal) {
                totals.internalMinutes += minutes;
            } else if (log.countsTowardBudget) {
                group.budgetMinutes += minutes;
                totals.budgetMinutes += minutes;
            } else {
                group.nonBudgetMinutes += minutes;
                totals.nonBudgetMinutes += minutes;
            }
        }

        if (importReview) {
            totals.unmappedCount += 1;
            exceptions.push({
                kind: 'unmapped_import',
                timeLogId: log.id,
                date: log.date,
                minutes,
                userId: log.userId,
                description: log.description,
            });
        } else if (log.status === 'needs_review') {
            exceptions.push({
                kind: 'bot_timer_cap',
                timeLogId: log.id,
                date: log.date,
                minutes,
                userId: log.userId,
                description: log.description,
            });
        } else if (log.status === 'paused') {
            const pausedMs = log.pausedAt ? Date.parse(log.pausedAt) : Number.NaN;
            const stale = Number.isFinite(pausedMs) && nowMs - pausedMs >= PAUSED_BOT_TIMER_STALE_MS;
            exceptions.push({
                kind: 'bot_timer_paused',
                timeLogId: log.id,
                date: log.date,
                minutes,
                userId: log.userId,
                description: stale
                    ? 'Paused for more than 7 days. Review it. It was not closed.'
                    : log.description,
            });
        }
    }

    const clients: LedgerClientGroup[] = [...groups.values()]
        .map(group => ({
            clientId: group.clientId,
            clientName: group.clientName,
            isInternal: group.isInternal,
            needsReview: group.needsReview,
            paused: group.paused,
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
