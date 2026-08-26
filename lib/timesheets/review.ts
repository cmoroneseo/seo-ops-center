import { isUnmappedImport, minutesFromHours, type LedgerLog } from './ledger.ts';

/**
 * Client-month approval maths.
 *
 * The invariant this module exists to protect: **an approved snapshot is a
 * record of what was approved, not a view over current data.** Nothing here
 * ever writes back into a snapshot; drift is reported by comparing the frozen
 * snapshot against the live ledger, and the resolution is a manager decision
 * (reopen), never a silent recalculation.
 */

export interface ApprovalEntry {
    timeLogId: string;
    includedMinutes: number;
}

export interface ApprovalMemberTotals {
    userId: string;
    totalMinutes: number;
    eligibleMinutes: number;
    nonBudgetMinutes: number;
}

export type ApprovalBlocker = 'unmapped_entries';

export interface ClientMonthSnapshot {
    clientId: string;
    /** 'YYYY-MM' */
    month: string;
    /** The client's contracted SEO minutes for the month. */
    budgetMinutes: number;
    /** Client time that consumes the SEO budget. */
    eligibleMinutes: number;
    /** Tracked client time that must not eat the budget (meetings, etc.). */
    nonBudgetMinutes: number;
    remainingMinutes: number;
    overBudget: boolean;
    requiresNote: boolean;
    unmappedCount: number;
    blockers: ApprovalBlocker[];
    canApprove: boolean;
    members: ApprovalMemberTotals[];
    entries: ApprovalEntry[];
}

export interface ClientMonthOptions {
    clientId: string;
    /** 'YYYY-MM' */
    month: string;
    budgetMinutes: number;
}

export type PostApprovalChangeKind = 'minutes_changed' | 'removed' | 'added';

export interface PostApprovalChange {
    kind: PostApprovalChangeKind;
    timeLogId: string;
    approvedMinutes: number;
    currentMinutes: number;
}

/** The 'YYYY-MM' bucket a local calendar date belongs to. */
export function monthOf(date: string): string {
    return date.slice(0, 7);
}

/** In scope for this client month at all — mapped or not. */
function inClientMonth(log: LedgerLog, options: ClientMonthOptions): boolean {
    return log.clientId === options.clientId && monthOf(log.date) === options.month;
}

/**
 * Approvable time. A running timer is not final, a voided row no longer exists
 * at the provider, and an unmapped row has no trustworthy attribution — none of
 * the three may be silently folded into an approved total.
 *
 * `pending_review` is deliberately not approvable: it is submitted time waiting
 * on a manager, and it blocks the month instead (see `isBlockingUnmapped`).
 */
function isApprovable(log: LedgerLog): boolean {
    return log.status === 'logged'
        && log.importStatus === 'mapped'
        && !log.voidedAt;
}

/**
 * Live, unapproved import time in the month.
 *
 * Both `needs_context` and `pending_review` block: neither has been accepted by
 * a manager, so approving the month around them would freeze a snapshot that
 * the queue is about to contradict — turning the exceptional drift flag into a
 * routine one. Matches the ledger's review bucket exactly.
 */
function isBlockingUnmapped(log: LedgerLog): boolean {
    return isUnmappedImport(log) && !log.voidedAt && log.status === 'logged';
}

export function buildClientMonthSnapshot(
    logs: LedgerLog[],
    options: ClientMonthOptions,
): ClientMonthSnapshot {
    const scoped = logs.filter(log => inClientMonth(log, options));

    const entries: ApprovalEntry[] = [];
    const memberTotals = new Map<string, ApprovalMemberTotals>();
    let eligibleMinutes = 0;
    let nonBudgetMinutes = 0;
    let unmappedCount = 0;

    for (const log of scoped) {
        if (isBlockingUnmapped(log)) {
            unmappedCount += 1;
            continue;
        }
        if (!isApprovable(log)) continue;

        const minutes = minutesFromHours(log.hours);
        entries.push({ timeLogId: log.id, includedMinutes: minutes });

        let member = memberTotals.get(log.userId);
        if (!member) {
            member = {
                userId: log.userId,
                totalMinutes: 0,
                eligibleMinutes: 0,
                nonBudgetMinutes: 0,
            };
            memberTotals.set(log.userId, member);
        }
        member.totalMinutes += minutes;

        if (log.countsTowardBudget) {
            eligibleMinutes += minutes;
            member.eligibleMinutes += minutes;
        } else {
            nonBudgetMinutes += minutes;
            member.nonBudgetMinutes += minutes;
        }
    }

    const remainingMinutes = options.budgetMinutes - eligibleMinutes;
    const overBudget = remainingMinutes < 0;
    const blockers: ApprovalBlocker[] = unmappedCount > 0 ? ['unmapped_entries'] : [];

    return {
        clientId: options.clientId,
        month: options.month,
        budgetMinutes: options.budgetMinutes,
        eligibleMinutes,
        nonBudgetMinutes,
        remainingMinutes,
        overBudget,
        // Going over contracted hours is allowed, but it has to be explained.
        requiresNote: overBudget,
        unmappedCount,
        blockers,
        canApprove: blockers.length === 0,
        members: [...memberTotals.values()].sort((left, right) =>
            left.userId.localeCompare(right.userId)),
        entries,
    };
}

/**
 * Compare a frozen snapshot against the current ledger.
 *
 * Returns what changed since approval. It never mutates `snapshot` — callers
 * surface these as flags on the approval, and only a manager reopening the
 * month produces a new snapshot.
 */
export function detectPostApprovalChanges(
    snapshot: ClientMonthSnapshot,
    logs: LedgerLog[],
): PostApprovalChange[] {
    const scope: ClientMonthOptions = {
        clientId: snapshot.clientId,
        month: snapshot.month,
        budgetMinutes: snapshot.budgetMinutes,
    };
    const current = new Map<string, number>();
    for (const log of logs) {
        if (!inClientMonth(log, scope) || !isApprovable(log)) continue;
        current.set(log.id, minutesFromHours(log.hours));
    }

    const changes: PostApprovalChange[] = [];
    const approved = new Set<string>();

    for (const entry of snapshot.entries) {
        approved.add(entry.timeLogId);
        const currentMinutes = current.get(entry.timeLogId);
        if (currentMinutes === undefined) {
            changes.push({
                kind: 'removed',
                timeLogId: entry.timeLogId,
                approvedMinutes: entry.includedMinutes,
                currentMinutes: 0,
            });
        } else if (currentMinutes !== entry.includedMinutes) {
            changes.push({
                kind: 'minutes_changed',
                timeLogId: entry.timeLogId,
                approvedMinutes: entry.includedMinutes,
                currentMinutes,
            });
        }
    }

    for (const [timeLogId, currentMinutes] of current) {
        if (approved.has(timeLogId)) continue;
        changes.push({ kind: 'added', timeLogId, approvedMinutes: 0, currentMinutes });
    }

    return changes;
}
