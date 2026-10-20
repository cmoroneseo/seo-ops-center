import { timeTrackingTaskId } from './pillars';

/**
 * One subtask progress figure for the task panel, task cards, and the SEO plan.
 *
 * A live subtask is a chore nested under the pillar: a deeper chore counts on
 * that pillar, and a recurring successor stays its own task. Deleted, archived,
 * and hidden rows are not live. Folding done rows, and hiding a chore because
 * it sits in another month, are display filters — they still count.
 */
export interface ProgressTask {
    id: string;
    title?: string;
    status?: string | null;
    parentTaskId?: string | null;
    recurring?: boolean;
    /** Deleted, archived, or hidden. Not a live subtask. */
    excluded?: boolean;
}

export type SubtaskProgressState = 'loading' | 'unavailable' | 'empty' | 'ready';

export interface SubtaskProgress {
    state: SubtaskProgressState;
    done: number;
    total: number;
    /** `3/4` when there is something to count. Null otherwise — never `0/N` while loading. */
    label: string | null;
    ids: string[];
}

const LOADING: SubtaskProgress = { state: 'loading', done: 0, total: 0, label: null, ids: [] };
const UNAVAILABLE: SubtaskProgress = { state: 'unavailable', done: 0, total: 0, label: null, ids: [] };

export type ListedSubtasks = {
    subtasks?: { id: string; title: string; completed: boolean }[] | null;
    subtasksState?: 'loading' | 'ready' | 'unavailable';
};

function tracking(task: ProgressTask) {
    return {
        id: task.id,
        title: task.title,
        parentTaskId: task.parentTaskId,
        recurrence: task.recurring ? { freq: 'weekly' as const } : undefined,
    };
}

/** Pillar this row renders under. Null is a top-level task. `'missing'` has no loaded parent. */
export function nestingParentId(
    task: ProgressTask,
    byId: ReadonlyMap<string, ProgressTask>,
): string | 'missing' | null {
    const direct = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
    if (timeTrackingTaskId(tracking(task), direct ?? null) === task.id) return null;
    if (!task.parentTaskId) return null;
    if (!direct) return 'missing';

    let current: ProgressTask = direct;
    for (let guard = 0; guard < 8; guard += 1) {
        const parentOfCurrent = current.parentTaskId ? byId.get(current.parentTaskId) : undefined;
        if (timeTrackingTaskId(tracking(current), parentOfCurrent ?? null) === current.id) return current.id;
        if (!current.parentTaskId || !parentOfCurrent) return 'missing';
        current = parentOfCurrent;
    }
    return 'missing';
}

function deduped(tasks: readonly ProgressTask[]): ProgressTask[] {
    const byId = new Map<string, ProgressTask>();
    for (const task of tasks) {
        if (!task.id || task.excluded || byId.has(task.id)) continue;
        byId.set(task.id, task);
    }
    return [...byId.values()];
}

/** Live subtasks of one pillar, from the same rows the plan nests. */
export function liveSubtasks(parentId: string, tasks: readonly ProgressTask[]): ProgressTask[] {
    const unique = deduped(tasks);
    const byId = new Map(unique.map(task => [task.id, task]));
    return unique.filter(task => nestingParentId(task, byId) === parentId);
}

/**
 * Progress for a child list that is already the pillar's live subtasks.
 * `null` is still loading and must not render as `0/N`.
 */
export function progressOf(children: readonly ProgressTask[] | null | undefined): SubtaskProgress {
    if (children == null) return LOADING;
    const live = deduped(children);
    if (live.length === 0) return { state: 'empty', done: 0, total: 0, label: null, ids: [] };
    const done = live.filter(child => child.status === 'done').length;
    return {
        state: 'ready',
        done,
        total: live.length,
        label: `${done}/${live.length}`,
        ids: live.map(child => child.id),
    };
}

/** Progress for one pillar from a full task tree. `null` means the tree has not loaded. */
export function subtaskProgress(
    parentId: string,
    tasks: readonly ProgressTask[] | null | undefined,
): SubtaskProgress {
    if (tasks == null) return LOADING;
    return progressOf(liveSubtasks(parentId, tasks));
}

/** Card and overview progress. An unknown list is loading, not zero done. */
export function listedSubtaskProgress(task: ListedSubtasks): SubtaskProgress {
    if (task.subtasks === null || task.subtasksState === 'loading') return LOADING;
    if (task.subtasksState === 'unavailable') return UNAVAILABLE;
    return progressOf((task.subtasks ?? []).map(subtask => ({
        id: subtask.id,
        title: subtask.title,
        status: subtask.completed ? 'done' : 'todo',
        parentTaskId: null,
    })));
}

export function subtaskSnapshots(
    parentId: string,
    tasks: readonly ProgressTask[] | null | undefined,
): { id: string; title: string; completed: boolean }[] {
    if (tasks == null) return [];
    return liveSubtasks(parentId, tasks).map(task => ({
        id: task.id,
        title: task.title ?? '',
        completed: task.status === 'done',
    }));
}

/** Replace one subtask's status and return the next tree. The caller reconciles with the saved row. */
export function withSubtaskStatus<T extends ProgressTask>(
    tasks: readonly T[],
    subtaskId: string,
    status: string,
): T[] {
    return tasks.map(task => task.id === subtaskId ? { ...task, status } : task);
}

/** A row is not a live subtask when it was deleted, archived, or hidden. */
export function taskExcluded(record: object): boolean {
    const row = record as Record<string, unknown>;
    if (row.excluded === true || row.hidden === true) return true;
    if (row.archived_at != null && row.archived_at !== '') return true;
    if (row.deleted_at != null && row.deleted_at !== '') return true;
    return false;
}

type SnapshotParent = ProgressTask & {
    subtasks: { id: string; title: string; completed: boolean }[];
    subtasksState?: 'loading' | 'ready' | 'unavailable';
    recurrence?: unknown;
};

/**
 * Stamp each parent with the live subtask snapshots from one tree.
 * `null` means the child read failed: the parents stay, and the counter is unavailable rather than 0/N.
 */
export function attachSubtaskSnapshots<T extends SnapshotParent>(
    parents: readonly T[],
    others: readonly ProgressTask[] | null,
): T[] {
    if (others == null) {
        return parents.map(parent => ({ ...parent, subtasks: [], subtasksState: 'unavailable' as const }));
    }
    const tree: ProgressTask[] = [
        ...parents.map(parent => ({
            id: parent.id,
            title: parent.title,
            status: parent.status,
            parentTaskId: parent.parentTaskId,
            recurring: Boolean(parent.recurrence) || parent.recurring,
        })),
        ...others,
    ];
    return parents.map(parent => ({
        ...parent,
        subtasks: subtaskSnapshots(parent.id, tree),
        subtasksState: 'ready' as const,
    }));
}
