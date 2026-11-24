import type { PartOfChoice } from '../tasks/part-of';
import { NO_PROJECT_GROUP, projectGroupId } from './project-groups';
import { isPendingStageTaskId } from './stage-add';
import { groupTaskTrees, type StageListTask } from './stage-list';

export interface StageReorderMove {
    taskId: string;
    parentTaskId: string | null;
    index: number;
    projectGroup?: string;
    projects?: readonly Pick<PartOfChoice, 'id'>[];
}

export interface StageReorderWrite {
    id: string;
    position: number;
    parentTaskId: string | null;
}

export type StageReorderPlan =
    | { ok: true; tasks: StageListTask[]; writes: StageReorderWrite[] }
    | { ok: false; error: string };

export const STAGE_REORDER_NOT_FOUND = 'Not found';
export type StageMoveDirection = 'up' | 'down' | 'unnest';

export function applyStageReorder(tasks: readonly StageListTask[], move: StageReorderMove): StageReorderPlan {
    const rows = tasks.filter(task => !isPendingStageTaskId(task.id) && !task.excluded);
    const groups = groupTaskTrees(rows, '');
    const source = groups.find(group => group.task.id === move.taskId || group.children.some(task => task.id === move.taskId));
    const dragged = rows.find(task => task.id === move.taskId);
    if (!source || !dragged) return { ok: false, error: STAGE_REORDER_NOT_FOUND };

    const draggedId = dragged.id;
    const sourceParent = source.task.id === dragged.id ? null : source.task.id;
    const target = move.parentTaskId ? groups.find(group => group.task.id === move.parentTaskId) : undefined;
    if (move.parentTaskId && (!target || target.parentBreadcrumb || move.parentTaskId === dragged.id
        || dragged.recurring || dragged.title === target.task.title
        || rows.some(task => task.parentTaskId === dragged.id && !task.recurring && task.title !== dragged.title))) {
        return { ok: false, error: 'Tasks can only nest one level deep' };
    }

    const project = (task: StageListTask) => move.projects
        ? projectGroupId(task, move.projects)
        : task.initiativeId ?? NO_PROJECT_GROUP;
    const destinationProject = project(target?.task ?? dragged);
    if (move.projectGroup && (move.projectGroup !== destinationProject
        || project(source.task) !== destinationProject || sourceParent !== move.parentTaskId)) {
        return { ok: false, error: 'Choose a task in this project.' };
    }
    const topRows = (key: string) => groups.map(group => group.task).filter(task => project(task) === key);
    const destination = target?.children ?? topRows(destinationProject);
    const siblings = destination.filter(task => task.id !== dragged.id);
    const slot = Math.max(0, Math.min(Math.trunc(move.index), siblings.length));
    if (sourceParent === move.parentTaskId && destination.findIndex(task => task.id === dragged.id) === slot) {
        return { ok: true, tasks: [...tasks], writes: [] };
    }
    siblings.splice(slot, 0, dragged);

    const writes: StageReorderWrite[] = [];
    function pack(list: StageListTask[], moving: boolean) {
        list.forEach((task, index) => {
            const position = index + 1;
            const parentTaskId = moving && task.id === draggedId
                ? move.parentTaskId ?? (sourceParent ? null : task.parentTaskId)
                : task.parentTaskId;
            if (task.position !== position || task.parentTaskId !== parentTaskId) {
                writes.push({ id: task.id, position, parentTaskId });
            }
        });
    }
    pack(siblings, true);
    if (sourceParent !== move.parentTaskId) {
        const previous = sourceParent ? source.children : topRows(project(source.task));
        pack(previous.filter(task => task.id !== dragged.id), false);
    }
    const byId = new Map(writes.map(write => [write.id, write]));
    return {
        ok: true,
        writes,
        tasks: tasks.map(task => {
            const write = byId.get(task.id);
            return write ? { ...task, position: write.position, parentTaskId: write.parentTaskId,
                ...(write.parentTaskId && task.initiativeId ? { initiativeId: null } : {}) } : task;
        }),
    };
}

/** Keyboard moves use the same project and parent ordering as pointer moves. */
export function stageMoveBy(
    tasks: readonly StageListTask[],
    taskId: string,
    direction: StageMoveDirection,
    projects?: readonly Pick<PartOfChoice, 'id'>[],
): StageReorderMove | null {
    const groups = groupTaskTrees(tasks.filter(task => !isPendingStageTaskId(task.id)), '');
    const group = groups.find(group => group.task.id === taskId || group.children.some(task => task.id === taskId));
    if (!group) return null;
    const project = (task: StageListTask) => projects ? projectGroupId(task, projects) : task.initiativeId ?? NO_PROJECT_GROUP;
    const tops = groups.map(group => group.task).filter(task => project(task) === project(group.task));
    const child = group.task.id !== taskId;
    if (direction === 'unnest') {
        if (!child) return null;
        const task = group.children.find(task => task.id === taskId)!;
        const destination = groups.map(group => group.task).filter(row => project(row) === project(task));
        const parentIndex = destination.findIndex(row => row.id === group.task.id);
        return { taskId, parentTaskId: null, index: parentIndex < 0 ? destination.length : parentIndex + 1 };
    }
    const siblings = child ? group.children : tops;
    const index = siblings.findIndex(task => task.id === taskId) + (direction === 'up' ? -1 : 1);
    if (index < 0 || index >= siblings.length) return null;
    return { taskId, parentTaskId: child ? group.task.id : null, index, projectGroup: project(group.task), projects };
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
        return { ...task, ...next };
    });
}
