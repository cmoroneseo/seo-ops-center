import { isPendingStageTaskId } from './stage-add';
import { groupTasksByStage, type StageListTask } from './stage-list';
import { isTaskStage } from '../tasks/stage';
import { TASK_STAGES, type TaskStage } from '../types';

/**
 * Where a dragged task should land.
 * `index` is the slot among the destination siblings after this task is removed.
 * A parent means nest under that pillar. No parent means a top-level row in `stage`.
 */
export interface StageReorderMove {
    taskId: string;
    stage: TaskStage;
    parentTaskId: string | null;
    index: number;
}

/** One row the atomic rewrite must persist. Positions are 1-based inside the sibling group. */
export interface StageReorderWrite {
    id: string;
    stage: TaskStage;
    position: number;
    parentTaskId: string | null;
}

export type StageReorderPlan =
    | { ok: true; tasks: StageListTask[]; writes: StageReorderWrite[] }
    | { ok: false; error: string };

export const STAGE_REORDER_NOT_FOUND = 'Not found';
export const STAGE_REORDER_ONE_LEVEL = 'Tasks can only nest one level deep';
export const STAGE_REORDER_PILLAR = 'A pillar moves with its subtasks and cannot be nested';
export const STAGE_REORDER_RECURRING = 'That task cannot be nested';
export const STAGE_REORDER_SELF = 'A task cannot be nested under itself';
export const STAGE_REORDER_STAGE = 'Choose a stage.';

export type StageMoveDirection = 'up' | 'down' | 'previous-stage' | 'next-stage' | 'unnest';

export type StageDropHint =
    | { type: 'nest'; taskId: string }
    | { type: 'insert'; stage: TaskStage; parentTaskId: string | null; beforeTaskId: string | null };

interface Placement {
    stage: TaskStage;
    parentTaskId: string | null;
    index: number;
    siblings: StageListTask[];
}

interface Model {
    byId: Map<string, StageListTask>;
    pillars: Set<string>;
    place(id: string): Placement | null;
    children(parentId: string): StageListTask[];
    tops(stage: TaskStage): StageListTask[];
}

function stageOf(task: StageListTask): TaskStage {
    return isTaskStage(task.stage) ? task.stage : 'backlog';
}

function finitePosition(value: number | null): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Saved rows only. Optimistic ids are not part of the sibling order the server can write. */
function persistedTasks(tasks: readonly StageListTask[]): StageListTask[] {
    const seen = new Set<string>();
    const list: StageListTask[] = [];
    for (const task of tasks) {
        if (!task.id || seen.has(task.id) || isPendingStageTaskId(task.id)) continue;
        seen.add(task.id);
        list.push(task);
    }
    return list;
}

/**
 * A structural child is a real subtask. Recurring successors point at the
 * completed task and keep their own row, so they do not make it a pillar.
 */
function structuralChild(task: StageListTask, parent: StageListTask | undefined): boolean {
    if (!task.parentTaskId || task.recurring) return false;
    if (parent && task.title === parent.title) return false;
    return true;
}

function readModel(tasks: readonly StageListTask[]): Model {
    const list = persistedTasks(tasks);
    const byId = new Map(list.map(task => [task.id, task]));
    const sections = groupTasksByStage(list, '');
    const childrenByParent = new Map<string, StageListTask[]>();
    const topsByStage = new Map<TaskStage, StageListTask[]>(TASK_STAGES.map(stage => [stage, []]));
    const parentOf = new Map<string, string>();
    const pillars = new Set<string>();

    for (const section of sections) {
        for (const group of section.groups) {
            topsByStage.get(section.stage)!.push(group.task);
            if (group.childCount > 0) pillars.add(group.task.id);
            childrenByParent.set(group.task.id, group.children);
            for (const child of group.children) parentOf.set(child.id, group.task.id);
        }
    }

    for (const task of list) {
        const parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
        if (structuralChild(task, parent)) pillars.add(task.parentTaskId!);
    }

    return {
        byId,
        pillars,
        children(parentId: string) {
            return childrenByParent.get(parentId) ?? [];
        },
        tops(stage: TaskStage) {
            return topsByStage.get(stage) ?? [];
        },
        place(id: string) {
            const task = byId.get(id);
            if (!task) return null;
            const parentTaskId = parentOf.get(id) ?? null;
            if (parentTaskId) {
                const siblings = childrenByParent.get(parentTaskId) ?? [];
                return {
                    stage: stageOf(byId.get(parentTaskId) ?? task),
                    parentTaskId,
                    index: siblings.findIndex(sibling => sibling.id === id),
                    siblings,
                };
            }
            const stage = stageOf(task);
            const siblings = topsByStage.get(stage) ?? [];
            return {
                stage,
                parentTaskId: null,
                index: siblings.findIndex(sibling => sibling.id === id),
                siblings,
            };
        },
    };
}

function clampIndex(index: number, length: number): number {
    if (!Number.isFinite(index)) return length;
    const slot = Math.trunc(index);
    if (slot < 0) return 0;
    if (slot > length) return length;
    return slot;
}

function changed(task: StageListTask, next: { stage: TaskStage; position: number; parentTaskId: string | null }): boolean {
    return stageOf(task) !== next.stage
        || finitePosition(task.position) !== next.position
        || (task.parentTaskId ?? null) !== next.parentTaskId;
}

/**
 * Apply a move to the in-memory list and return the rows that must be rewritten.
 * Sibling positions are packed to 1..n. A pillar's subtasks take its stage.
 * Nesting stays one level: a pillar cannot become a subtask, and a subtask
 * cannot become a parent.
 */
export function applyStageReorder(tasks: readonly StageListTask[], move: StageReorderMove): StageReorderPlan {
    const model = readModel(tasks);
    const dragged = model.byId.get(move.taskId);
    const source = model.place(move.taskId);
    if (!dragged || !source) return { ok: false, error: STAGE_REORDER_NOT_FOUND };

    let destParentId: string | null = null;
    let destStage: TaskStage;
    if (move.parentTaskId) {
        const parent = model.byId.get(move.parentTaskId);
        const parentPlace = model.place(move.parentTaskId);
        if (!parent || !parentPlace) return { ok: false, error: STAGE_REORDER_NOT_FOUND };
        if (parent.id === dragged.id) return { ok: false, error: STAGE_REORDER_SELF };
        if (parentPlace.parentTaskId) return { ok: false, error: STAGE_REORDER_ONE_LEVEL };
        if (model.pillars.has(dragged.id)) return { ok: false, error: STAGE_REORDER_PILLAR };
        if (dragged.recurring) return { ok: false, error: STAGE_REORDER_RECURRING };
        destParentId = parent.id;
        destStage = parentPlace.stage;
    } else {
        if (!isTaskStage(move.stage)) return { ok: false, error: STAGE_REORDER_STAGE };
        destStage = move.stage;
    }

    const sameGroup = source.parentTaskId === destParentId && (destParentId != null || source.stage === destStage);
    const destSiblings = (destParentId ? model.children(destParentId) : model.tops(destStage))
        .filter(task => task.id !== dragged.id);
    const nextDest = [...destSiblings];
    nextDest.splice(clampIndex(move.index, destSiblings.length), 0, dragged);

    const updates = new Map<string, { stage: TaskStage; position: number; parentTaskId: string | null }>();
    nextDest.forEach((task, index) => {
        const isDragged = task.id === dragged.id;
        updates.set(task.id, {
            stage: isDragged ? destStage : stageOf(task),
            position: index + 1,
            parentTaskId: isDragged
                ? (destParentId ?? (source.parentTaskId ? null : (task.parentTaskId ?? null)))
                : (task.parentTaskId ?? null),
        });
    });

    if (!sameGroup) {
        const remaining = source.siblings.filter(task => task.id !== dragged.id);
        remaining.forEach((task, index) => {
            updates.set(task.id, {
                stage: stageOf(task),
                position: index + 1,
                parentTaskId: task.parentTaskId ?? null,
            });
        });
    }

    if (!destParentId && model.pillars.has(dragged.id) && destStage !== source.stage) {
        model.children(dragged.id).forEach((child, index) => {
            updates.set(child.id, {
                stage: destStage,
                position: finitePosition(child.position) ?? index + 1,
                parentTaskId: child.parentTaskId ?? dragged.id,
            });
        });
    }

    const writes: StageReorderWrite[] = [];
    for (const [id, next] of updates) {
        const task = model.byId.get(id);
        if (!task || !changed(task, next)) continue;
        writes.push({ id, stage: next.stage, position: next.position, parentTaskId: next.parentTaskId });
    }
    if (writes.length === 0) return { ok: true, tasks: [...tasks], writes: [] };

    const byWrite = new Map(writes.map(write => [write.id, write]));
    return {
        ok: true,
        writes,
        tasks: tasks.map(task => {
            const write = byWrite.get(task.id);
            if (!write) return task;
            return { ...task, stage: write.stage, position: write.position, parentTaskId: write.parentTaskId };
        }),
    };
}

/** Put the earlier snapshot back on the rows this move changed. Other rows stay. */
export function restoreStageTasks(
    current: readonly StageListTask[],
    previous: readonly StageListTask[],
    ids: readonly string[],
): StageListTask[] {
    const wanted = new Set(ids);
    const prior = new Map(previous.flatMap(task => wanted.has(task.id) ? [[task.id, task] as const] : []));
    return current.map(task => prior.get(task.id) ?? task);
}

/** Saved rows replace the optimistic copies. Ids the server did not return stay as they are. */
export function mergeStageTasks(current: readonly StageListTask[], updated: readonly StageListTask[]): StageListTask[] {
    const byId = new Map(updated.map(task => [task.id, task]));
    return current.map(task => {
        const next = byId.get(task.id);
        if (!next) return task;
        if (next.publishedUrl === undefined && task.publishedUrl) return { ...next, publishedUrl: task.publishedUrl };
        return next;
    });
}

function insertIndex(siblings: readonly StageListTask[], dragId: string, beforeTaskId: string | null, place: 'before' | 'after'): number {
    const without = siblings.filter(task => task.id !== dragId);
    if (!beforeTaskId) return without.length;
    const at = without.findIndex(task => task.id === beforeTaskId);
    if (at < 0) return without.length;
    return place === 'before' ? at : at + 1;
}

/**
 * Pointer target for a drag.
 * The middle of a pillar header nests a task that has no subtasks.
 * The edges of that header, and every other row, reorder.
 * A pillar never nests. Dropping a subtask on a stage makes it a top-level task.
 */
export function describeStageDrop(input: {
    tasks: readonly StageListTask[];
    dragId: string;
    overTaskId: string | null;
    overStage: TaskStage | null;
    overParentId: string | null;
    pointerFraction: number | null;
}): { move: StageReorderMove; hint: StageDropHint } | null {
    const model = readModel(input.tasks);
    const drag = model.place(input.dragId);
    if (!drag) return null;
    const dragIsPillar = model.pillars.has(input.dragId);
    const fraction = input.pointerFraction == null || !Number.isFinite(input.pointerFraction)
        ? 0.5
        : Math.min(1, Math.max(0, input.pointerFraction));

    let move: StageReorderMove | null = null;
    let hint: StageDropHint | null = null;

    if (input.overTaskId) {
        const over = model.place(input.overTaskId);
        if (!over) return null;
        if (over.parentTaskId) {
            if (dragIsPillar) return null;
            const place = fraction < 0.5 ? 'before' : 'after';
            move = {
                taskId: input.dragId,
                stage: over.stage,
                parentTaskId: over.parentTaskId,
                index: insertIndex(over.siblings, input.dragId, input.overTaskId, place),
            };
            hint = {
                type: 'insert',
                stage: over.stage,
                parentTaskId: over.parentTaskId,
                beforeTaskId: place === 'before' ? input.overTaskId : nextId(over.siblings, input.overTaskId),
            };
        } else {
            const overIsPillar = model.pillars.has(input.overTaskId);
            if (!dragIsPillar && overIsPillar && input.overTaskId !== input.dragId && fraction >= 0.25 && fraction <= 0.75) {
                const children = model.children(input.overTaskId).filter(task => task.id !== input.dragId);
                move = {
                    taskId: input.dragId,
                    stage: over.stage,
                    parentTaskId: input.overTaskId,
                    index: children.length,
                };
                hint = { type: 'nest', taskId: input.overTaskId };
            } else {
                const place = fraction < 0.5 ? 'before' : 'after';
                move = {
                    taskId: input.dragId,
                    stage: over.stage,
                    parentTaskId: null,
                    index: insertIndex(over.siblings, input.dragId, input.overTaskId, place),
                };
                hint = {
                    type: 'insert',
                    stage: over.stage,
                    parentTaskId: null,
                    beforeTaskId: place === 'before' ? input.overTaskId : nextId(over.siblings, input.overTaskId),
                };
            }
        }
    } else if (input.overParentId) {
        if (dragIsPillar) return null;
        const parent = model.place(input.overParentId);
        if (!parent || parent.parentTaskId) return null;
        const children = model.children(input.overParentId).filter(task => task.id !== input.dragId);
        move = {
            taskId: input.dragId,
            stage: parent.stage,
            parentTaskId: input.overParentId,
            index: children.length,
        };
        hint = { type: 'insert', stage: parent.stage, parentTaskId: input.overParentId, beforeTaskId: null };
    } else if (input.overStage && isTaskStage(input.overStage)) {
        const siblings = model.tops(input.overStage);
        move = {
            taskId: input.dragId,
            stage: input.overStage,
            parentTaskId: null,
            index: siblings.filter(task => task.id !== input.dragId).length,
        };
        hint = { type: 'insert', stage: input.overStage, parentTaskId: null, beforeTaskId: null };
    }

    if (!move || !hint) return null;
    const plan = applyStageReorder(input.tasks, move);
    if (!plan.ok || plan.writes.length === 0) return null;
    return { move, hint };
}

function nextId(siblings: readonly StageListTask[], id: string): string | null {
    const index = siblings.findIndex(task => task.id === id);
    if (index < 0) return null;
    return siblings[index + 1]?.id ?? null;
}

/** Keyboard moves use the same placement rules as a drag. */
export function stageMoveBy(
    tasks: readonly StageListTask[],
    taskId: string,
    direction: StageMoveDirection,
): StageReorderMove | null {
    const model = readModel(tasks);
    const place = model.place(taskId);
    if (!place || place.index < 0) return null;

    if (direction === 'up' || direction === 'down') {
        const next = place.index + (direction === 'up' ? -1 : 1);
        if (next < 0 || next >= place.siblings.length) return null;
        return {
            taskId,
            stage: place.stage,
            parentTaskId: place.parentTaskId,
            index: direction === 'up' ? place.index - 1 : place.index + 1,
        };
    }

    if (direction === 'unnest') {
        if (!place.parentTaskId) return null;
        const parent = model.place(place.parentTaskId);
        if (!parent) return null;
        return {
            taskId,
            stage: parent.stage,
            parentTaskId: null,
            index: parent.index + 1,
        };
    }

    if (place.parentTaskId) return null;
    const at = TASK_STAGES.indexOf(place.stage);
    const dest = TASK_STAGES[at + (direction === 'next-stage' ? 1 : -1)];
    if (!dest) return null;
    return {
        taskId,
        stage: dest,
        parentTaskId: null,
        index: model.tops(dest).length,
    };
}
