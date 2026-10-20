import { sumBudgetHoursByClient, sumTrackedHoursByClient } from '../time-budget-logic';
import type { StageListTask } from './stage-list';
import { groupTasksByStage } from './stage-list';
import { completionDay, isPlanDone, isPlanMonth, planMonthName, planMonthShort, planMonthTitle } from './plan-sections';
import { calendarDay, STAGE_LIST_TIME_ZONE } from './this-month';

/**
 * One finalized time log the footer can sum.
 * `date` is `time_logs.date` (a calendar day) or an ISO timestamp.
 * A running timer is `in_progress` and is not finalized.
 */
export interface DoneThisMonthLog {
    clientId?: string;
    hours: number;
    countsTowardBudget: boolean;
    date: string;
    status?: string;
}

export interface DoneThisMonthUrl {
    id: string;
    url: string;
}

export interface DoneThisMonthReport {
    completed: StageListTask[];
    completedCount: number;
    urls: DoneThisMonthUrl[];
    urlCount: number;
    missingUrlCount: number;
    billableHours: number;
    totalHours: number;
    hoursTitle: string;
    monthTitle: string;
    monthShort: string;
    /** Set when nothing was completed in the month. */
    emptyCopy: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A leaf is a task nothing else nests under.
 * Nesting is the plan's one level (`displayParent` via `groupTasksByStage`).
 * A pillar counts only when it has no children, so a parent and its subtasks
 * are never both counted.
 */
export function planLeafTasks(tasks: readonly StageListTask[]): StageListTask[] {
    const leaves: StageListTask[] = [];
    for (const section of groupTasksByStage(tasks, '')) {
        for (const group of section.groups) {
            if (group.children.length === 0) leaves.push(group.task);
            else leaves.push(...group.children);
        }
    }
    return leaves;
}

/** Calendar month of a log date. A bare day is already a calendar date. A timestamp uses the org timezone. */
export function logMonthKey(date: string, timeZone = STAGE_LIST_TIME_ZONE): string | null {
    const trimmed = date.trim();
    if (DAY.test(trimmed)) return trimmed.slice(0, 7);
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return calendarDay(parsed, timeZone).slice(0, 7);
}

function finalizedLog(status: string | undefined): boolean {
    return status == null || status === 'logged';
}

export function liveUrlOf(task: StageListTask): string | null {
    const url = task.publishedUrl?.trim() ?? '';
    return url.length > 0 ? url : null;
}

function byCompletion(a: StageListTask, b: StageListTask): number {
    const aAt = a.completedAt ?? '';
    const bAt = b.completedAt ?? '';
    if (aAt !== bAt) return aAt < bAt ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
}

/** Leaf tasks marked done whose completion instant falls in `month` in the org timezone. */
export function completedLeavesInMonth(
    tasks: readonly StageListTask[],
    month: string,
    timeZone = STAGE_LIST_TIME_ZONE,
): StageListTask[] {
    return planLeafTasks(tasks).filter(task => {
        if (!isPlanDone(task.status)) return false;
        const day = completionDay(task.completedAt, timeZone);
        return Boolean(day && day.slice(0, 7) === month);
    }).sort(byCompletion);
}

function readClientHours(map: Record<string, number>, clientId?: string): number {
    if (clientId) return map[clientId] ?? 0;
    return Object.values(map).reduce((sum, hours) => Math.round((sum + hours) * 100) / 100, 0);
}

/**
 * Billable hours are finalized logs in M with `countsTowardBudget`.
 * The total is every finalized client log in M, billable or not.
 * Both sums go through the existing budget helpers. The running timer is
 * excluded because it is not finalized. Logs are the client's, including
 * tasks that are not on screen this month.
 */
export function footerHours(
    logs: readonly DoneThisMonthLog[],
    month: string,
    timeZone = STAGE_LIST_TIME_ZONE,
    clientId?: string,
): { billable: number; total: number } {
    const rows = logs.flatMap(log => {
        if (!finalizedLog(log.status)) return [];
        if (!log.clientId) return [];
        if (clientId && log.clientId !== clientId) return [];
        if (logMonthKey(log.date, timeZone) !== month) return [];
        const hours = typeof log.hours === 'number' && Number.isFinite(log.hours) ? log.hours : 0;
        return [{ clientId: log.clientId, hours, countsTowardBudget: log.countsTowardBudget === true }];
    });
    return {
        billable: readClientHours(sumBudgetHoursByClient(rows), clientId),
        total: readClientHours(sumTrackedHoursByClient(rows), clientId),
    };
}

/** One decimal, including zeros: `4.5h`, `0.0h`, `5.0h`. */
export function formatFooterHours(hours: number): string {
    if (!Number.isFinite(hours)) return '0.0h';
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded.toFixed(1)}h`;
}

export function footerHoursTitle(billable: number, total: number): string {
    const nonBillable = Math.round((total - billable) * 10) / 10;
    const other = nonBillable > 0 ? nonBillable : 0;
    return `${formatFooterHours(billable)} billable · ${formatFooterHours(total)} total logged (${formatFooterHours(other)} non-billable)`;
}

export function doneThisMonth(input: {
    tasks: readonly StageListTask[];
    logs?: readonly DoneThisMonthLog[];
    month: string;
    timeZone?: string;
    clientId?: string;
}): DoneThisMonthReport {
    const timeZone = input.timeZone ?? STAGE_LIST_TIME_ZONE;
    const completed = completedLeavesInMonth(input.tasks, input.month, timeZone);
    const urls: DoneThisMonthUrl[] = [];
    let missingUrlCount = 0;
    for (const task of completed) {
        const url = liveUrlOf(task);
        if (url) urls.push({ id: task.id, url });
        else missingUrlCount += 1;
    }
    const hours = footerHours(input.logs ?? [], input.month, timeZone, input.clientId);
    const monthName = isPlanMonth(input.month) ? planMonthName(input.month) : input.month;
    return {
        completed,
        completedCount: completed.length,
        urls,
        urlCount: urls.length,
        missingUrlCount,
        billableHours: hours.billable,
        totalHours: hours.total,
        hoursTitle: footerHoursTitle(hours.billable, hours.total),
        monthTitle: isPlanMonth(input.month) ? planMonthTitle(input.month) : input.month,
        monthShort: isPlanMonth(input.month) ? planMonthShort(input.month) : input.month,
        emptyCopy: completed.length === 0 ? `Nothing completed in ${monthName} yet.` : null,
    };
}
