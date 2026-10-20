import { isTaskStage } from '../tasks/stage';
import type { TaskStage } from '../types';
import { groupTasksByStage, type StageListTask } from './stage-list';
import { applyStageReorder, type StageReorderMove } from './stage-reorder';
import {
    endOfPlanMonth,
    groupTasksByPlanMonth,
    isPlanMonth,
    type PlanSectionId,
} from './plan-sections';
import { dueDay } from './this-month';

/**
 * What a drag should write.
 * `dueDate` is omitted when the due date stays as it is. `null` clears it.
 * The stage move still goes through the existing reorder (position and parent).
 * A due-date write does not push to Basecamp; that push rule is a later change.
 */
export interface PlanDragEffect {
    move: StageReorderMove;
    dueDate?: string | null;
}

export interface PlanDropTarget {
    tasks: readonly StageListTask[];
    dragId: string;
    section: PlanSectionId;
    /** Insert before this row. Null appends to the section. */
    beforeTaskId: string | null;
    /** Set when the drop reorders subtasks inside a pillar. */
    parentTaskId: string | null;
    /** Selected month, YYYY-MM. */
    month: string;
    /** Today, YYYY-MM-DD, in the org timezone. */
    today: string;
}

function storedStage(task: StageListTask): TaskStage {
    return isTaskStage(task.stage) ? task.stage : 'backlog';
}

function indexBefore(siblings: readonly StageListTask[], dragId: string, beforeTaskId: string | null): number {
    const without = siblings.filter(task => task.id !== dragId);
    if (!beforeTaskId) return without.length;
    const at = without.findIndex(task => task.id === beforeTaskId);
    return at < 0 ? without.length : at;
}

function tops(tasks: readonly StageListTask[], stage: TaskStage): StageListTask[] {
    return groupTasksByStage(tasks, '')
        .find(section => section.stage === stage)
        ?.groups.map(group => group.task) ?? [];
}

function childrenOf(tasks: readonly StageListTask[], parentId: string): StageListTask[] {
    for (const section of groupTasksByStage(tasks, '')) {
        const group = section.groups.find(item => item.task.id === parentId);
        if (group) return group.children;
    }
    return [];
}

function isPillar(tasks: readonly StageListTask[], taskId: string): boolean {
    return groupTasksByStage(tasks, '').some(section => section.groups.some(group => (
        group.task.id === taskId && group.childCount > 0
    )));
}

function isSubtask(tasks: readonly StageListTask[], taskId: string): boolean {
    return groupTasksByStage(tasks, '').some(section => section.groups.some(group => (
        group.children.some(child => child.id === taskId)
    )));
}

function sectionOf(tasks: readonly StageListTask[], taskId: string, month: string, today: string): PlanSectionId | null {
    for (const section of groupTasksByPlanMonth(tasks, { month, today })) {
        if (section.groups.some(group => group.task.id === taskId)) return section.id;
    }
    return null;
}

/**
 * Due date a row takes on when it is dropped into a section.
 * Undefined means leave the current due date alone.
 * This month sets the last day of M only when the row has no due date in M.
 * Backlog clears the due date. Onboarding does not change it.
 */
export function dueDateForSectionDrop(
    task: StageListTask,
    section: PlanSectionId,
    month: string,
): string | null | undefined {
    if (!isPlanMonth(month)) return undefined;
    if (section === 'onboarding') return undefined;
    if (section === 'backlog') return null;
    const due = dueDay(task.dueDate);
    if (due && due.slice(0, 7) === month) return undefined;
    return endOfPlanMonth(month);
}

/**
 * Translate a drop into a stage reorder plus the due-date change, if any.
 * Reordering inside a section, or inside a pillar, does not change the due date.
 * Dropping a row into another section updates the field that places it there.
 * Leaving Onboarding stores stage `backlog`. Entering it stores `onboarding`.
 */
export function effectOfPlanDrop(input: PlanDropTarget): PlanDragEffect | null {
    const dragged = input.tasks.find(task => task.id === input.dragId);
    if (!dragged || !isPlanMonth(input.month)) return null;

    if (input.parentTaskId) {
        if (isPillar(input.tasks, dragged.id)) return null;
        const parent = input.tasks.find(task => task.id === input.parentTaskId);
        if (!parent) return null;
        const move: StageReorderMove = {
            taskId: dragged.id,
            stage: storedStage(parent),
            parentTaskId: parent.id,
            index: indexBefore(childrenOf(input.tasks, parent.id), dragged.id, input.beforeTaskId),
        };
        const plan = applyStageReorder(input.tasks, move);
        if (!plan.ok || plan.writes.length === 0) return null;
        return { move };
    }

    const destination: TaskStage = input.section === 'onboarding' ? 'onboarding' : 'backlog';
    const move: StageReorderMove = {
        taskId: dragged.id,
        stage: destination,
        parentTaskId: null,
        index: indexBefore(tops(input.tasks, destination), dragged.id, input.beforeTaskId),
    };
    const sameSection = !isSubtask(input.tasks, dragged.id) && sectionOf(input.tasks, dragged.id, input.month, input.today) === input.section;
    const dueDate = sameSection ? undefined : dueDateForSectionDrop(dragged, input.section, input.month);
    const plan = applyStageReorder(input.tasks, move);
    if (!plan.ok) return null;
    const currentDue = dueDay(dragged.dueDate);
    const dueChanges = dueDate !== undefined && (currentDue ?? null) !== dueDate;
    if (plan.writes.length === 0 && !dueChanges) return null;
    return dueDate === undefined ? { move } : { move, dueDate };
}
