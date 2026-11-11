import { TASK_STATUS_LABELS } from '../copy/labels';
import { tasksPartOf } from '../tasks/part-of';

/**
 * Filters for the work-plan board.
 * They run on tasks the page already loaded for one client.
 * Nothing here reads another client or another organization.
 * The address bar is the saved view. There is no saved-view table.
 */

export const PLAN_FILTER_QUERY_KEYS = [
    'planQ',
    'planStatus',
    'planPriority',
    'planAssignee',
    'planStage',
    'planPart',
] as const;

export const PLAN_FILTER_EMPTY = 'No tasks match these filters.';
export const PLAN_FILTER_SECTION_META = 'No matching tasks';
export const PLAN_PART_OF_EMPTY = 'No tasks are part of this.';

const QUERY_MAX = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PLAN_FILTER_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type PlanFilterStatus = (typeof PLAN_FILTER_STATUSES)[number];

export const PLAN_FILTER_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type PlanFilterPriority = (typeof PLAN_FILTER_PRIORITIES)[number];

export const PLAN_FILTER_STAGES = [
    'foundation',
    'growth',
    'scale',
    'backlog',
    'onboarding',
    'this_month',
] as const;
export type PlanFilterStage = (typeof PLAN_FILTER_STAGES)[number];

export type PlanFilterBoard = 'phases' | 'months';

export const PLAN_QUICK_VIEWS = [
    { id: 'mine', label: 'My tasks' },
    { id: 'not-started', label: TASK_STATUS_LABELS.todo },
    { id: 'in-progress', label: TASK_STATUS_LABELS.in_progress },
    { id: 'done', label: TASK_STATUS_LABELS.done },
] as const;

export type PlanQuickView = (typeof PLAN_QUICK_VIEWS)[number]['id'];

export const PLAN_FILTER_STATUS_OPTIONS: { value: PlanFilterStatus; label: string }[] = [
    { value: 'todo', label: TASK_STATUS_LABELS.todo },
    { value: 'in_progress', label: TASK_STATUS_LABELS.in_progress },
    { value: 'done', label: TASK_STATUS_LABELS.done },
];

export const PLAN_FILTER_PRIORITY_OPTIONS: { value: PlanFilterPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

export interface PlanBoardFilters {
    status: PlanFilterStatus | '';
    priority: PlanFilterPriority | '';
    /** A person id, or `none` for nobody assigned. */
    assignee: string;
    stage: PlanFilterStage | '';
    /** Roadmap row id. The screen calls this Part of. */
    partOf: string;
}

export interface PlanFilterUrlState extends PlanBoardFilters {
    query: string;
}

export const EMPTY_PLAN_FILTERS: PlanBoardFilters = {
    status: '',
    priority: '',
    assignee: '',
    stage: '',
    partOf: '',
};

export interface PlanFilterTask {
    id: string;
    title: string;
    status: string;
    stage: string | null;
    parentTaskId: string | null;
    initiativeId?: string | null;
    assigneeIds?: readonly string[];
    priority?: string | null;
}

const STATUS_SET = new Set<string>(PLAN_FILTER_STATUSES);
const PRIORITY_SET = new Set<string>(PLAN_FILTER_PRIORITIES);
const STAGE_SET = new Set<string>(PLAN_FILTER_STAGES);

export function planStageOptions(board: PlanFilterBoard): { value: PlanFilterStage; label: string }[] {
    if (board === 'phases') {
        return [
            { value: 'foundation', label: 'Foundation' },
            { value: 'growth', label: 'Growth' },
            { value: 'scale', label: 'Scale' },
            { value: 'backlog', label: 'Later' },
        ];
    }
    return [
        { value: 'onboarding', label: 'Onboarding' },
        { value: 'this_month', label: 'This month' },
        { value: 'backlog', label: 'Backlog' },
    ];
}

export function planFilterCountLabel(count: number): string {
    return count === 1 ? '1 filter' : `${count} filters`;
}

export function planSectionFilterEmpty(title: string): string {
    return `No tasks in ${title} match these filters.`;
}

export function knownStage(stage: string, board: PlanFilterBoard): boolean {
    return planStageOptions(board).some(option => option.value === stage);
}

export function activePlanFilterCount(
    state: PlanFilterUrlState,
    board: PlanFilterBoard,
    partOfKnown = true,
): number {
    let count = 0;
    if (state.query.trim()) count += 1;
    if (state.status) count += 1;
    if (state.priority) count += 1;
    if (state.assignee) count += 1;
    if (state.stage && knownStage(state.stage, board)) count += 1;
    if (state.partOf && partOfKnown) count += 1;
    return count;
}

/** Words for an empty board. A title-only search keeps the sentence the board already uses. */
export function planFilterEmptyCopy(state: PlanFilterUrlState): string {
    const query = state.query.trim();
    const narrowed = Boolean(state.status || state.priority || state.assignee || state.stage || state.partOf);
    if (query && !narrowed) return `No tasks match "${query}".`;
    if (
        state.partOf
        && !query
        && !state.status
        && !state.priority
        && !state.assignee
        && !state.stage
    ) {
        return PLAN_PART_OF_EMPTY;
    }
    return PLAN_FILTER_EMPTY;
}

export function readPlanFilters(search: string): { filters: PlanBoardFilters; query: string } {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const status = params.get('planStatus') ?? '';
    const priority = params.get('planPriority') ?? '';
    const assignee = params.get('planAssignee') ?? '';
    const stage = params.get('planStage') ?? '';
    const partOf = params.get('planPart') ?? '';
    return {
        query: (params.get('planQ') ?? '').trim().slice(0, QUERY_MAX),
        filters: {
            status: STATUS_SET.has(status) ? status as PlanFilterStatus : '',
            priority: PRIORITY_SET.has(priority) ? priority as PlanFilterPriority : '',
            assignee: assignee === 'none' || UUID.test(assignee) ? assignee : '',
            stage: STAGE_SET.has(stage) ? stage as PlanFilterStage : '',
            partOf: UUID.test(partOf) ? partOf : '',
        },
    };
}

/** Replace the plan filter params and keep every other query param. */
export function hrefWithPlanFilters(href: string, state: PlanFilterUrlState): string {
    const url = new URL(href, 'https://seo-ops-center.local');
    const set = (key: string, value: string) => {
        const trimmed = value.trim();
        if (trimmed) url.searchParams.set(key, key === 'planQ' ? trimmed.slice(0, QUERY_MAX) : trimmed);
        else url.searchParams.delete(key);
    };
    set('planQ', state.query);
    set('planStatus', state.status);
    set('planPriority', state.priority);
    set('planAssignee', state.assignee);
    set('planStage', state.stage);
    set('planPart', state.partOf);
    return `${url.pathname}${url.search}${url.hash}`;
}

export function filtersForPreset(
    view: PlanQuickView,
    viewerId: string | null | undefined,
): PlanBoardFilters | null {
    if (view === 'mine') {
        if (!viewerId) return null;
        return { ...EMPTY_PLAN_FILTERS, assignee: viewerId };
    }
    if (view === 'not-started') return { ...EMPTY_PLAN_FILTERS, status: 'todo' };
    if (view === 'in-progress') return { ...EMPTY_PLAN_FILTERS, status: 'in_progress' };
    if (view === 'done') return { ...EMPTY_PLAN_FILTERS, status: 'done' };
    return null;
}

/** A quick view is pressed only when the filters are exactly that preset. */
export function matchingPlanPreset(
    state: PlanFilterUrlState,
    viewerId: string | null | undefined,
): PlanQuickView | '' {
    if (state.query.trim() || state.priority || state.stage || state.partOf) return '';
    if (state.status === 'todo' && !state.assignee) return 'not-started';
    if (state.status === 'in_progress' && !state.assignee) return 'in-progress';
    if (state.status === 'done' && !state.assignee) return 'done';
    if (!state.status && state.assignee && viewerId && state.assignee === viewerId) return 'mine';
    return '';
}

function storedStatus(status: string): PlanFilterStatus {
    if (status === 'in_progress' || status === 'done') return status;
    return 'todo';
}

function phaseStageOf(task: { stage: string | null }): 'foundation' | 'growth' | 'scale' | 'backlog' {
    if (task.stage === 'foundation' || task.stage === 'growth' || task.stage === 'scale' || task.stage === 'backlog') {
        return task.stage;
    }
    return 'foundation';
}

function rowMatches(task: PlanFilterTask, filters: PlanBoardFilters): boolean {
    if (filters.status && storedStatus(task.status) !== filters.status) return false;
    if (filters.priority && task.priority !== filters.priority) return false;
    const assignees = task.assigneeIds ?? [];
    if (filters.assignee === 'none' && assignees.length > 0) return false;
    if (filters.assignee && filters.assignee !== 'none' && !assignees.includes(filters.assignee)) return false;
    return true;
}

function hasRowFilters(filters: PlanBoardFilters): boolean {
    return Boolean(filters.status || filters.priority || filters.assignee);
}

/**
 * Keep tasks that match every set filter.
 * Part of keeps the main task and the tasks nested under it.
 * A nested task that matches keeps its main task so it still has a place.
 * A nested task that does not match stays hidden.
 * Title search is separate: the board grouping already does that.
 */
export function filterPlanTasks<T extends PlanFilterTask>(
    tasks: readonly T[],
    filters: PlanBoardFilters,
): T[] {
    const part = filters.partOf ? tasksPartOf(tasks, filters.partOf) : [...tasks];
    if (!hasRowFilters(filters)) return part;

    const byId = new Map(part.map(task => [task.id, task]));
    const direct = new Set<string>();
    for (const task of part) {
        if (rowMatches(task, filters)) direct.add(task.id);
    }
    const keep = new Set<string>(direct);
    for (const id of direct) {
        let parentId = byId.get(id)?.parentTaskId ?? null;
        const seen = new Set<string>();
        while (parentId && byId.has(parentId) && !seen.has(parentId)) {
            seen.add(parentId);
            keep.add(parentId);
            parentId = byId.get(parentId)?.parentTaskId ?? null;
        }
    }
    return part.filter(task => {
        if (!keep.has(task.id)) return false;
        if (!task.parentTaskId) return true;
        return direct.has(task.id);
    });
}

/**
 * Stage keeps the matching column's tasks and leaves the other columns on screen
 * so a task can still be dragged there. A task dropped into another stage
 * no longer matches, so the next pass hides it.
 * On Foundation, Growth, and Scale, Later means a task stored as backlog.
 * Those tasks stay in the Foundation column, which is where the board already shows them.
 */
function rowIsLate(task: { status?: string; dueDate?: string | null }, today: string): boolean {
    if (!task.status || task.status === 'done') return false;
    const due = task.dueDate?.slice(0, 10) ?? '';
    const now = today.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(now)) return false;
    return due < now;
}

export function hideSectionsOutsideStage<T extends {
    id: string;
    groups: readonly {
        task: { stage: string | null; status?: string; dueDate?: string | null };
        children?: readonly { status?: string; dueDate?: string | null }[];
    }[];
    count: number;
    open: number;
    late: number;
    done: number;
    meta: string;
}>(sections: readonly T[], stage: string, board: PlanFilterBoard, today?: string): T[] {
    if (!stage || !knownStage(stage, board)) return [...sections];
    if (board === 'months') {
        return sections.map(section => {
            if (section.id === stage) return section;
            return { ...section, groups: [], count: 0, open: 0, late: 0, done: 0 } as T;
        });
    }
    return sections.map(section => {
        const groups = section.groups.filter(group => phaseStageOf(group.task) === stage);
        if (groups.length === section.groups.length) return section;
        const rows = groups.flatMap(group => [group.task, ...(group.children ?? [])]);
        const counted = rows.length > 0 && rows.every(row => typeof row.status === 'string');
        const done = rows.filter(row => row.status === 'done').length;
        const open = rows.length - done;
        const late = counted && today ? rows.filter(row => rowIsLate(row, today)).length : section.late;
        const lateNote = late > 0 ? ` · ${late} late` : '';
        return {
            ...section,
            groups,
            count: counted ? rows.length : groups.length,
            open: counted ? open : section.open,
            late,
            done: counted ? done : section.done,
            meta: counted ? `${open} open${lateNote} · ${done} done` : section.meta,
        } as T;
    });
}

/** Empty columns say the filters hid their tasks, instead of saying the plan has none. */
export function describeFilteredSections<T extends {
    groups: readonly unknown[];
    title: string;
    empty: string;
    meta: string;
}>(sections: readonly T[], filtering: boolean): T[] {
    if (!filtering) return [...sections];
    return sections.map(section => {
        if (section.groups.length > 0) return section;
        return {
            ...section,
            meta: PLAN_FILTER_SECTION_META,
            empty: planSectionFilterEmpty(section.title),
        };
    });
}
