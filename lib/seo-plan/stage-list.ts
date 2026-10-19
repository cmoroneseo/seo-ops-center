import { timeTrackingTaskId, type TimeTrackingTask } from '../tasks/pillars';
import { isTaskStage } from '../tasks/stage';
import { TASK_STAGES, type TaskStage } from '../types';

/**
 * One client task in the stage list.
 * `recurring` marks a successor that keeps its own row. Stage and position are
 * display fields only; this module never writes them.
 */
export interface StageListTask {
    id: string;
    title: string;
    status: string;
    stage: string | null;
    position: number | null;
    parentTaskId: string | null;
    createdAt: string | null;
    category: string | null;
    basecamp: boolean;
    recurring: boolean;
    /** Absent when the row was loaded before the live URL column was selected. */
    publishedUrl?: string | null;
}

export interface StageListGroup {
    task: StageListTask;
    /** Children to render. A parent-title hit keeps every child; a subtask-only hit keeps matches. */
    children: StageListTask[];
    childCount: number;
    childDone: number;
    /** Open the children on first paint. Set when a subtask title matched. */
    expandChildren: boolean;
    /** Set when a subtask cannot be nested because its parent task is not loaded. */
    parentBreadcrumb?: string;
}

export interface StageListSection {
    stage: TaskStage;
    label: string;
    /** Top-level rows in this stage. Nested subtasks are counted on the pillar. */
    count: number;
    groups: StageListGroup[];
}

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
    onboarding: 'Onboarding',
    backlog: 'Backlog',
};

function finitePosition(value: number | null): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Position, then created_at, then id. Missing positions sort last. */
export function compareStageListTasks(a: StageListTask, b: StageListTask): number {
    const aPosition = finitePosition(a.position);
    const bPosition = finitePosition(b.position);
    if (aPosition != null && bPosition != null && aPosition !== bPosition) return aPosition - bPosition;
    if ((aPosition != null) !== (bPosition != null)) return aPosition != null ? -1 : 1;
    const aCreated = a.createdAt ?? '';
    const bCreated = b.createdAt ?? '';
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return 0;
}

function searchWords(query: string): string[] {
    return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function titleMatches(task: StageListTask, words: readonly string[]): boolean {
    if (words.length === 0) return false;
    const title = task.title.toLocaleLowerCase();
    return words.every(word => title.includes(word));
}

function tracking(task: StageListTask): TimeTrackingTask {
    return {
        id: task.id,
        title: task.title,
        parentTaskId: task.parentTaskId,
        recurrence: task.recurring ? { freq: 'weekly' } : undefined,
    };
}

function stageOf(task: StageListTask): TaskStage {
    return isTaskStage(task.stage) ? task.stage : 'backlog';
}

function doneStatus(status: string): boolean {
    return status === 'done' || status === 'approved';
}

/**
 * Parent a row should render under.
 * Recurring successors stay on their own row. A deeper chore nests under the
 * pillar, one level, so it never sits beside that pillar as a peer.
 */
function displayParent(
    task: StageListTask,
    byId: ReadonlyMap<string, StageListTask>,
): StageListTask | 'missing' | undefined {
    const direct = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
    if (timeTrackingTaskId(tracking(task), direct ?? null) === task.id) return undefined;
    if (!task.parentTaskId) return undefined;
    if (!direct) return 'missing';

    let current: StageListTask = direct;
    for (let guard = 0; guard < 8; guard += 1) {
        const parentOfCurrent = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
        if (timeTrackingTaskId(tracking(current), parentOfCurrent ?? null) === current.id) return current;
        if (!current.parentTaskId || !parentOfCurrent) return 'missing';
        current = parentOfCurrent;
    }
    return 'missing';
}

function uniqueTasks(tasks: readonly StageListTask[]): StageListTask[] {
    const byId = new Map<string, StageListTask>();
    for (const task of tasks) {
        if (!task.id || byId.has(task.id)) continue;
        byId.set(task.id, task);
    }
    return [...byId.values()];
}

/**
 * Group a client's tasks into the roadmap sections.
 * Empty sections are always returned, in TASK_STAGES order.
 * Subtasks render under their pillar. Search matches pillar titles and
 * subtask titles; a subtask-only hit keeps the parent and opens the matches.
 */
export function groupTasksByStage(tasks: readonly StageListTask[], query: string): StageListSection[] {
    const unique = uniqueTasks(tasks);
    const byId = new Map(unique.map(task => [task.id, task]));
    const words = searchWords(query);
    const searching = words.length > 0;

    const childrenByParent = new Map<string, StageListTask[]>();
    for (const task of unique) {
        const parent = displayParent(task, byId);
        if (!parent || parent === 'missing') continue;
        const list = childrenByParent.get(parent.id) ?? [];
        list.push(task);
        childrenByParent.set(parent.id, list);
    }
    for (const list of childrenByParent.values()) list.sort(compareStageListTasks);

    const groups: StageListGroup[] = [];
    const tops = unique.filter(task => {
        const parent = displayParent(task, byId);
        if (parent && parent !== 'missing') return false;
        if (!searching) return true;
        if (titleMatches(task, words)) return true;
        if (parent === 'missing') return false;
        return (childrenByParent.get(task.id) ?? []).some(child => titleMatches(child, words));
    });
    tops.sort(compareStageListTasks);

    for (const task of tops) {
        const parent = displayParent(task, byId);
        if (parent === 'missing') {
            groups.push({
                task,
                children: [],
                childCount: 0,
                childDone: 0,
                expandChildren: false,
                parentBreadcrumb: 'Under another task',
            });
            continue;
        }
        const allChildren = childrenByParent.get(task.id) ?? [];
        const matchingChildren = searching ? allChildren.filter(child => titleMatches(child, words)) : [];
        const parentHit = searching && titleMatches(task, words);
        const children = !searching || parentHit ? allChildren : matchingChildren;
        groups.push({
            task,
            children,
            childCount: allChildren.length,
            childDone: allChildren.filter(child => doneStatus(child.status)).length,
            expandChildren: searching && children.length > 0 && (matchingChildren.length > 0 || !parentHit),
        });
    }

    const byStage = new Map<TaskStage, StageListGroup[]>(TASK_STAGES.map(stage => [stage, []]));
    for (const group of groups) byStage.get(stageOf(group.task))!.push(group);

    return TASK_STAGES.map(stage => {
        const sectionGroups = byStage.get(stage) ?? [];
        return {
            stage,
            label: TASK_STAGE_LABELS[stage],
            count: sectionGroups.length,
            groups: sectionGroups,
        };
    });
}

export function stageListTitleParts(title: string, query: string): { text: string; match: boolean }[] {
    const words = searchWords(query);
    if (words.length === 0 || title.length === 0) return [{ text: title, match: false }];
    const lower = title.toLocaleLowerCase();
    const ranges: { start: number; end: number }[] = [];
    for (const word of words) {
        let from = 0;
        while (from < lower.length) {
            const index = lower.indexOf(word, from);
            if (index < 0) break;
            ranges.push({ start: index, end: index + word.length });
            from = index + word.length;
        }
    }
    ranges.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: { start: number; end: number }[] = [];
    for (const range of ranges) {
        const last = merged[merged.length - 1];
        if (!last || range.start > last.end) merged.push({ ...range });
        else last.end = Math.max(last.end, range.end);
    }
    if (merged.length === 0) return [{ text: title, match: false }];
    const parts: { text: string; match: boolean }[] = [];
    let cursor = 0;
    for (const range of merged) {
        if (range.start > cursor) parts.push({ text: title.slice(cursor, range.start), match: false });
        parts.push({ text: title.slice(range.start, range.end), match: true });
        cursor = range.end;
    }
    if (cursor < title.length) parts.push({ text: title.slice(cursor), match: false });
    return parts;
}

/** Map a tasks-table row. Drops rows that have no id. Recurrence stays a boolean. */
export function stageListTaskFromRow(row: unknown): StageListTask | null {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (typeof record.id !== 'string' || record.id === '' || typeof record.title !== 'string') return null;
    const position = typeof record.position === 'number' && Number.isFinite(record.position) ? record.position : null;
    const basecampId = record.basecamp_todo_id;
    return {
        id: record.id,
        title: record.title,
        status: typeof record.status === 'string' && record.status ? record.status : 'todo',
        stage: typeof record.stage === 'string' ? record.stage : null,
        position,
        parentTaskId: typeof record.parent_task_id === 'string' && record.parent_task_id ? record.parent_task_id : null,
        createdAt: typeof record.created_at === 'string' ? record.created_at : null,
        category: typeof record.category === 'string' && record.category ? record.category : null,
        basecamp: typeof basecampId === 'number' || (typeof basecampId === 'string' && basecampId !== ''),
        recurring: record.recurrence != null,
        ...('published_url' in record ? {
            publishedUrl: typeof record.published_url === 'string' && record.published_url.trim()
                ? record.published_url.trim()
                : null,
        } : {}),
    };
}

/** Accept the stage-list JSON. Unknown fields and malformed rows are dropped. */
export function parseStageListTasks(value: unknown): StageListTask[] {
    if (!Array.isArray(value)) return [];
    const tasks: StageListTask[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        if (typeof record.id !== 'string' || record.id === '' || typeof record.title !== 'string') continue;
        tasks.push({
            id: record.id,
            title: record.title,
            status: typeof record.status === 'string' && record.status ? record.status : 'todo',
            stage: typeof record.stage === 'string' ? record.stage : null,
            position: typeof record.position === 'number' && Number.isFinite(record.position) ? record.position : null,
            parentTaskId: typeof record.parentTaskId === 'string' && record.parentTaskId ? record.parentTaskId : null,
            createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
            category: typeof record.category === 'string' && record.category ? record.category : null,
            basecamp: record.basecamp === true,
            recurring: record.recurring === true,
            ...('publishedUrl' in record ? {
                publishedUrl: typeof record.publishedUrl === 'string' && record.publishedUrl.trim()
                    ? record.publishedUrl.trim()
                    : null,
            } : {}),
        });
    }
    return tasks;
}
