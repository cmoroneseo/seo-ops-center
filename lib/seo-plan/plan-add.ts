import { monthBounds } from '../sync/months';
import { stageAddLineRole, stageAddTitlesError, type StageAddLine } from './stage-add-lines';
import { STAGE_LIST_TIME_ZONE, calendarDay, formatDueDay } from './this-month';

/**
 * Where a new plan task lands.
 * `month` is the end of the selected month (or the current month until the
 * month control exists). `backlog` has no date. `onboarding` sets stage.
 */
export const PLAN_ADD_CHIPS = ['month', 'backlog', 'onboarding'] as const;
export type PlanAddChip = (typeof PLAN_ADD_CHIPS)[number];

/** The chip returns here after a successful add. */
export const PLAN_ADD_CHIP_DEFAULT: PlanAddChip = 'month';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function cyclePlanAddChip(chip: PlanAddChip): PlanAddChip {
    const index = PLAN_ADD_CHIPS.indexOf(chip);
    return PLAN_ADD_CHIPS[(index + 1) % PLAN_ADD_CHIPS.length] ?? PLAN_ADD_CHIP_DEFAULT;
}

/** Last calendar day of YYYY-MM, or null when the month is not real. */
export function endOfMonthDay(month: string): string | null {
    if (!MONTH.test(month)) return null;
    try {
        return monthBounds(month).end;
    } catch {
        return null;
    }
}

/**
 * The month the due chip uses.
 * A YYYY-MM prop wins. Otherwise the month is the current calendar month in
 * the org timezone (Pacific, until an organization stores its own zone).
 */
export function resolvePlanAddMonth(
    month: string | undefined,
    now: Date,
    timeZone = STAGE_LIST_TIME_ZONE,
): string {
    if (month && endOfMonthDay(month)) return month;
    try {
        const day = calendarDay(now, timeZone);
        if (MONTH.test(day.slice(0, 7))) return day.slice(0, 7);
    } catch {
        // An unknown zone falls through to Pacific.
    }
    return calendarDay(now, STAGE_LIST_TIME_ZONE).slice(0, 7);
}

export interface PlanAddDestination {
    chip: PlanAddChip;
    stage: 'onboarding' | 'backlog';
    dueDate: string | null;
    /** Chip text. "Due Oct 31", "Backlog no date", or "Onboarding". */
    label: string;
    /** Preview meta fragment, after the pillar and subtask counts. */
    meta: string;
}

export function planAddDestination(chip: PlanAddChip, month: string): PlanAddDestination {
    if (chip === 'onboarding') {
        return { chip, stage: 'onboarding', dueDate: null, label: 'Onboarding', meta: 'Onboarding' };
    }
    if (chip === 'backlog') {
        return { chip, stage: 'backlog', dueDate: null, label: 'Backlog no date', meta: 'Backlog no date' };
    }
    const dueDate = endOfMonthDay(month);
    const short = dueDate ? formatDueDay(dueDate) : month;
    return { chip: 'month', stage: 'backlog', dueDate, label: `Due ${short}`, meta: `due ${short}` };
}

/** Header of the paste preview. Over the line or title cap, the button stays disabled. */
export function planAddPreviewTitle(lines: readonly { title: string }[]): { title: string; canSubmit: boolean } {
    const error = stageAddTitlesError(lines.map(line => line.title));
    if (error && error !== 'Enter a title.') return { title: error, canSubmit: false };
    const count = lines.length;
    return { title: `Add ${count} ${count === 1 ? 'task' : 'tasks'}`, canSubmit: count > 0 };
}

/** "1 pillar · 3 subtasks · due Oct 31". Counts are omitted when there is no pillar. */
export function planAddPreviewMeta(lines: readonly StageAddLine[], destinationMeta: string): string {
    let pillars = 0;
    let subtasks = 0;
    lines.forEach((line, index) => {
        if (stageAddLineRole(lines, index) === 'pillar') pillars += 1;
        if (line.depth === 1) subtasks += 1;
    });
    const parts: string[] = [];
    if (pillars > 0) parts.push(`${pillars} ${pillars === 1 ? 'pillar' : 'pillars'}`);
    if (subtasks > 0) parts.push(`${subtasks} ${subtasks === 1 ? 'subtask' : 'subtasks'}`);
    parts.push(destinationMeta);
    return parts.join(' · ');
}
