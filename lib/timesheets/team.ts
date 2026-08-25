import { buildWeeklyLedger, weekDays, type LedgerException, type LedgerLog } from './ledger.ts';

/**
 * Manager read model: people and exceptions.
 *
 * Deliberately *not* a capacity report. The questions this answers are "who
 * worked on what, and what needs a human decision" — not "is everyone 80%
 * utilized". Utilization metrics would invite the wrong conversation about a
 * two-person team.
 */

export interface TeamMemberIdentity {
    userId: string;
    displayName: string;
}

export interface TeamMemberRow extends TeamMemberIdentity {
    dailyMinutes: number[];
    totalMinutes: number;
    budgetMinutes: number;
    nonBudgetMinutes: number;
    internalMinutes: number;
    unmappedCount: number;
}

export interface TeamSummary {
    weekStart: string;
    days: string[];
    members: TeamMemberRow[];
    totals: {
        totalMinutes: number;
        budgetMinutes: number;
        nonBudgetMinutes: number;
        internalMinutes: number;
        unmappedCount: number;
    };
    exceptions: LedgerException[];
}

function emptyRow(identity: TeamMemberIdentity, days: number): TeamMemberRow {
    return {
        ...identity,
        dailyMinutes: Array.from({ length: days }, () => 0),
        totalMinutes: 0,
        budgetMinutes: 0,
        nonBudgetMinutes: 0,
        internalMinutes: 0,
        unmappedCount: 0,
    };
}

export function buildTeamSummary(
    logs: LedgerLog[],
    weekStart: string,
    members: TeamMemberIdentity[],
): TeamSummary {
    const days = weekDays(weekStart);

    const rows = new Map<string, TeamMemberRow>(
        members.map(member => [member.userId, emptyRow(member, days.length)]),
    );

    // Reuse the grid's own aggregation per member, so a team row can never
    // disagree with the same person's My Timesheet view.
    for (const [userId, row] of rows) {
        const ledger = buildWeeklyLedger(logs, weekStart, { userId });
        row.dailyMinutes = ledger.totals.dailyMinutes;
        row.totalMinutes = ledger.totals.totalMinutes;
        row.budgetMinutes = ledger.totals.budgetMinutes;
        row.nonBudgetMinutes = ledger.totals.nonBudgetMinutes;
        row.internalMinutes = ledger.totals.internalMinutes;
        row.unmappedCount = ledger.totals.unmappedCount;
    }

    // The whole-team ledger also catches unmapped imports that have no member
    // resolved yet — exactly the rows a manager most needs to see.
    const teamLedger = buildWeeklyLedger(logs, weekStart);

    return {
        weekStart,
        days,
        members: [...rows.values()].sort((left, right) =>
            left.displayName.localeCompare(right.displayName)),
        totals: {
            totalMinutes: teamLedger.totals.totalMinutes,
            budgetMinutes: teamLedger.totals.budgetMinutes,
            nonBudgetMinutes: teamLedger.totals.nonBudgetMinutes,
            internalMinutes: teamLedger.totals.internalMinutes,
            unmappedCount: teamLedger.totals.unmappedCount,
        },
        exceptions: teamLedger.exceptions,
    };
}
