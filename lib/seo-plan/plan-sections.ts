import { compareStageListTasks, groupTasksByStage, type StageListGroup, type StageListTask } from './stage-list';
import { calendarDay, dueDay, formatDueDay } from './this-month';

/**
 * The three sections of the SEO Plan.
 * Membership comes from onboarding stage, due date, and completion date.
 * Order inside a section is manual position, with completed rows after open ones.
 */
export type PlanSectionId = 'onboarding' | 'this_month' | 'backlog';

export const PLAN_SECTION_ORDER: readonly PlanSectionId[] = ['onboarding', 'this_month', 'backlog'];

export interface PlanGroup {
    task: StageListTask;
    /** Children rendered in this section. Month rules can hide the rest. */
    children: StageListTask[];
    childCount: number;
    childDone: number;
    /** Children with a live URL. Counted across every child, including hidden ones. */
    urlCount: number;
    /** Children not rendered because the month window hides them. */
    hiddenChildren: number;
    /** Every child in the time rollup, including ones the month window hides. */
    rollupChildIds: string[];
    expandChildren: boolean;
    parentBreadcrumb?: string;
}

export interface PlanSectionModel {
    id: PlanSectionId;
    title: string;
    /** Tasks in the section, including nested children that are rendered or folded. */
    count: number;
    open: number;
    late: number;
    done: number;
    meta: string;
    /** All-done onboarding shrinks to one muted line until it is opened. */
    collapsedComplete: boolean;
    /** Backlog starts collapsed. Search opens it when a row matches. */
    defaultCollapsed: boolean;
    empty: string;
    groups: PlanGroup[];
}

export interface PlanMonthContext {
    /** Selected month, YYYY-MM. */
    month: string;
    /** Today in the org timezone, YYYY-MM-DD. */
    today: string;
    query?: string;
    timeZone?: string;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isPlanMonth(value: string): boolean {
    return MONTH_KEY.test(value);
}

export function monthKeyFromDay(day: string): string {
    return day.slice(0, 7);
}

export function shiftPlanMonth(month: string, delta: number): string {
    const [year, monthIndex] = month.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, monthIndex - 1 + delta, 1));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function endOfPlanMonth(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    const last = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    return `${month}-${String(last).padStart(2, '0')}`;
}

export function planMonthName(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleString('en-US', {
        month: 'long',
        timeZone: 'UTC',
    });
}

export function planMonthTitle(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

/** `Oct 1–31`. */
export function planMonthSpan(month: string): string {
    const end = endOfPlanMonth(month);
    const short = formatDueDay(`${month}-01`).split(' ')[0] ?? month;
    return `${short} 1–${Number(end.slice(8))}`;
}

export function planMonthShort(month: string): string {
    return formatDueDay(`${month}-01`).split(' ')[0] ?? month;
}

export function completionDay(value: string | null | undefined, timeZone?: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return dueDay(value);
    return calendarDay(parsed, timeZone);
}

export function isPlanDone(status: string): boolean {
    return status === 'done';
}

export function isPlanOpen(status: string): boolean {
    return !isPlanDone(status);
}

/** Open, and the due day is before today. Due today is not late. */
export function isPlanLate(task: StageListTask, today: string): boolean {
    const due = dueDay(task.dueDate);
    const now = dueDay(today);
    if (!isPlanOpen(task.status) || !due || !now) return false;
    return due < now;
}

export function lateDayCount(due: string, today: string): number {
    const start = Date.parse(`${due}T00:00:00Z`);
    const end = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.round((end - start) / 86400000));
}

export function formatPlanDue(task: StageListTask, today: string, timeZone?: string): {
    text: string;
    late: boolean;
    done: boolean;
    undated: boolean;
} {
    if (isPlanDone(task.status)) {
        const day = completionDay(task.completedAt, timeZone) ?? dueDay(task.dueDate);
        return { text: day ? `Done ${formatDueDay(day)}` : 'Done', late: false, done: true, undated: false };
    }
    const due = dueDay(task.dueDate);
    if (!due) return { text: 'No date', late: false, done: false, undated: true };
    if (isPlanLate(task, today)) {
        const days = lateDayCount(due, today);
        return { text: `${formatDueDay(due)} ${days}d late`, late: true, done: false, undated: false };
    }
    return { text: formatDueDay(due), late: false, done: false, undated: false };
}

export function formatPlanHours(hours: number): string {
    if (!Number.isFinite(hours) || hours <= 0) return '0h';
    const minutes = Math.round(hours * 60);
    if (minutes < 60) return `${minutes}m`;
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded}h`;
}

export function planHourRollup(
    taskId: string,
    childIds: readonly string[],
    hoursByTask: Readonly<Record<string, number>>,
): { own: number; children: number; total: number; tooltip: string } {
    const own = hoursByTask[taskId] ?? 0;
    const children = childIds.reduce((sum, id) => sum + (hoursByTask[id] ?? 0), 0);
    return {
        own,
        children,
        total: own + children,
        tooltip: `${formatPlanHours(own)} on pillar + ${formatPlanHours(children)} across subtasks`,
    };
}

function horizonMonth(month: string, today: string): string {
    const current = monthKeyFromDay(today);
    return month > current ? month : current;
}

function openDueInSelectedMonth(task: StageListTask, month: string, today: string): boolean {
    if (!isPlanOpen(task.status)) return false;
    const due = dueDay(task.dueDate);
    if (!due || monthKeyFromDay(due) !== month) return false;
    return month >= monthKeyFromDay(today);
}

function lateCarryOver(task: StageListTask, month: string, today: string): boolean {
    if (month !== monthKeyFromDay(today) || !isPlanOpen(task.status)) return false;
    const due = dueDay(task.dueDate);
    return Boolean(due && due < `${month}-01`);
}

function completedInMonth(task: StageListTask, month: string, timeZone?: string): boolean {
    if (!isPlanDone(task.status)) return false;
    const day = completionDay(task.completedAt, timeZone);
    return Boolean(day && monthKeyFromDay(day) === month);
}

function qualifiesForMonth(task: StageListTask, month: string, today: string, timeZone?: string): boolean {
    return openDueInSelectedMonth(task, month, today)
        || lateCarryOver(task, month, today)
        || completedInMonth(task, month, timeZone);
}

function belongsInBacklog(task: StageListTask, month: string, today: string): boolean {
    if (!isPlanOpen(task.status) || task.stage === 'onboarding') return false;
    const due = dueDay(task.dueDate);
    if (!due) return true;
    return due > endOfPlanMonth(horizonMonth(month, today));
}

function onboardingTask(task: StageListTask): boolean {
    return task.stage === 'onboarding';
}

function searchWords(query: string): string[] {
    return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function titleMatches(task: StageListTask, words: readonly string[]): boolean {
    if (words.length === 0) return false;
    const title = task.title.toLocaleLowerCase();
    return words.every(word => title.includes(word));
}

function trailingRow(task: StageListTask, section: PlanSectionId, month: string, timeZone?: string): boolean {
    if (section === 'onboarding') return isPlanDone(task.status);
    if (section === 'this_month') return completedInMonth(task, month, timeZone);
    return false;
}

function byPosition(section: PlanSectionId, month: string, timeZone?: string) {
    return (a: StageListTask, b: StageListTask) => {
        const aTrailing = trailingRow(a, section, month, timeZone);
        const bTrailing = trailingRow(b, section, month, timeZone);
        if (aTrailing !== bTrailing) return aTrailing ? 1 : -1;
        return compareStageListTasks(a, b);
    };
}

interface Draft {
    section: PlanSectionId;
    group: PlanGroup;
}

function visibleChildren(
    group: StageListGroup,
    section: PlanSectionId,
    month: string,
    today: string,
    timeZone: string | undefined,
    words: readonly string[],
    searching: boolean,
): { children: StageListTask[]; hidden: number; expand: boolean } {
    const pool = group.children.filter(child => !onboardingTask(child) || section === 'onboarding');
    if (searching) {
        const parentHit = titleMatches(group.task, words);
        const matches = pool.filter(child => titleMatches(child, words));
        const children = !parentHit ? matches : pool;
        return {
            children: [...children].sort(byPosition(section, month, timeZone)),
            hidden: 0,
            expand: matches.length > 0,
        };
    }
    if (section === 'onboarding') {
        return {
            children: [...pool].sort(byPosition(section, month, timeZone)),
            hidden: 0,
            expand: false,
        };
    }
    const qualifying = pool.filter(child => (
        section === 'this_month'
            ? qualifiesForMonth(child, month, today, timeZone)
            : belongsInBacklog(child, month, today)
    ));
    return {
        children: [...qualifying].sort(byPosition(section, month, timeZone)),
        hidden: pool.length - qualifying.length,
        expand: false,
    };
}

function placeGroup(
    group: StageListGroup,
    month: string,
    today: string,
    timeZone: string | undefined,
): PlanSectionId | null {
    if (onboardingTask(group.task)) return 'onboarding';
    const children = group.children.filter(child => !onboardingTask(child));
    const selfMonth = qualifiesForMonth(group.task, month, today, timeZone);
    const childMonth = children.some(child => qualifiesForMonth(child, month, today, timeZone));
    if (selfMonth || childMonth) return 'this_month';
    const selfBacklog = belongsInBacklog(group.task, month, today);
    const openChildren = children.filter(child => isPlanOpen(child.status));
    const childrenAreBacklog = openChildren.length > 0 && openChildren.every(child => belongsInBacklog(child, month, today));
    if (selfBacklog || childrenAreBacklog) return 'backlog';
    return null;
}

function fallbackSearchSection(group: StageListGroup, month: string, today: string): PlanSectionId {
    if (onboardingTask(group.task)) return 'onboarding';
    if (belongsInBacklog(group.task, month, today)) return 'backlog';
    if (group.children.some(child => belongsInBacklog(child, month, today)) && !group.children.some(child => !onboardingTask(child) && !belongsInBacklog(child, month, today) && !isPlanDone(child.status))) {
        return 'backlog';
    }
    return 'this_month';
}

function countTasks(groups: readonly PlanGroup[], today: string): { count: number; open: number; late: number; done: number } {
    const rows = groups.flatMap(group => [group.task, ...group.children]);
    let open = 0;
    let late = 0;
    let done = 0;
    for (const task of rows) {
        if (isPlanDone(task.status)) done += 1;
        else {
            open += 1;
            if (isPlanLate(task, today)) late += 1;
        }
    }
    return { count: rows.length, open, late, done };
}

function metaFor(
    id: PlanSectionId,
    counts: { count: number; open: number; late: number; done: number },
    month: string,
    today: string,
): string {
    const late = counts.late > 0 ? ` · ${counts.late} late` : '';
    if (id === 'onboarding') {
        return `${counts.open} open${late} · ${counts.done}/${counts.count} done`;
    }
    if (id === 'backlog') {
        return `${counts.count} · no date or due after ${planMonthShort(horizonMonth(month, today))}`;
    }
    return `${planMonthSpan(month)} · ${counts.open} open${late} · ${counts.done} done`;
}

export function planEmptyCopy(id: PlanSectionId, month: string, today: string, query: string): string {
    const words = query.trim();
    const name = planMonthName(month);
    if (words) {
        if (id === 'backlog') return `No Backlog tasks match "${words}".`;
        if (id === 'this_month') return `No tasks match "${words}" in ${name}.`;
        return `No onboarding tasks match "${words}".`;
    }
    if (id === 'onboarding') {
        return 'No onboarding tasks. Paste your onboarding checklist into "Add task" and set the chip to Onboarding.';
    }
    if (id === 'backlog') return 'Backlog is empty.';
    if (month < monthKeyFromDay(today)) return `Nothing was due or completed in ${name}.`;
    return `Nothing due in ${name}. Add a task above, or give a Backlog task a date.`;
}

export function planSearchMissCopy(query: string): string {
    return `No tasks match "${query.trim()}".`;
}

function sectionTitle(id: PlanSectionId, month: string, today: string): string {
    if (id === 'onboarding') return 'Onboarding';
    if (id === 'backlog') return 'Backlog';
    return month === monthKeyFromDay(today) ? 'This month' : planMonthTitle(month);
}

/**
 * Group a client's tasks into Onboarding, This month, and Backlog.
 * Empty sections are always returned, in that order.
 * Search ignores the month window and opens a pillar when a subtask matches.
 */
export function groupTasksByPlanMonth(tasks: readonly StageListTask[], context: PlanMonthContext): PlanSectionModel[] {
    const month = isPlanMonth(context.month) ? context.month : monthKeyFromDay(context.today);
    const today = dueDay(context.today) ?? context.today;
    const timeZone = context.timeZone;
    const words = searchWords(context.query ?? '');
    const searching = words.length > 0;
    const tree = groupTasksByStage(tasks, '');
    const drafts: Draft[] = [];

    for (const section of tree) {
        for (const group of section.groups) {
            const onboardingChildren = onboardingTask(group.task)
                ? []
                : group.children.filter(onboardingTask);
            for (const child of onboardingChildren) {
                const solo: StageListGroup = {
                    task: child,
                    children: [],
                    childCount: 0,
                    childDone: 0,
                    expandChildren: false,
                    parentBreadcrumb: 'Under another task',
                };
                if (searching && !titleMatches(child, words)) continue;
                drafts.push({
                    section: 'onboarding',
                    group: {
                        task: child,
                        children: [],
                        childCount: 0,
                        childDone: 0,
                        urlCount: 0,
                        hiddenChildren: 0,
                        rollupChildIds: [],
                        expandChildren: false,
                        parentBreadcrumb: solo.parentBreadcrumb,
                    },
                });
            }

            const remaining: StageListGroup = onboardingChildren.length === 0
                ? group
                : { ...group, children: group.children.filter(child => !onboardingTask(child)) };
            if (remaining.children.length === 0 && onboardingChildren.length > 0 && !onboardingTask(group.task)) {
                // The parent is placed on its own below.
            }
            const placed = placeGroup(remaining, month, today, timeZone);
            const parentHit = searching && titleMatches(group.task, words);
            const childHit = searching && remaining.children.some(child => titleMatches(child, words));
            if (searching && !parentHit && !childHit) continue;
            const sectionId = placed ?? (searching ? fallbackSearchSection(remaining, month, today) : null);
            if (!sectionId) continue;
            const shown = visibleChildren(remaining, sectionId, month, today, timeZone, words, searching);
            drafts.push({
                section: sectionId,
                group: {
                    task: group.task,
                    children: shown.children,
                    // Full live set, including a chore this section does not render.
                    childCount: group.childCount,
                    childDone: group.childDone,
                    urlCount: remaining.children.filter(child => Boolean(child.publishedUrl?.trim())).length,
                    hiddenChildren: shown.hidden,
                    rollupChildIds: remaining.children.map(child => child.id),
                    expandChildren: shown.expand,
                    parentBreadcrumb: group.parentBreadcrumb,
                },
            });
        }
    }

    return PLAN_SECTION_ORDER.map(id => {
        const groups = drafts
            .filter(draft => draft.section === id)
            .map(draft => draft.group)
            .sort((a, b) => byPosition(id, month, timeZone)(a.task, b.task));
        const counts = countTasks(groups, today);
        const collapsedComplete = id === 'onboarding' && counts.count > 0 && counts.open === 0 && !searching;
        return {
            id,
            title: sectionTitle(id, month, today),
            ...counts,
            meta: id === 'onboarding' && collapsedComplete
                ? `Complete · ${counts.done}/${counts.count}`
                : metaFor(id, counts, month, today),
            collapsedComplete,
            defaultCollapsed: id === 'backlog' ? !(searching && groups.length > 0) : collapsedComplete,
            empty: planEmptyCopy(id, month, today, context.query ?? ''),
            groups,
        };
    });
}
