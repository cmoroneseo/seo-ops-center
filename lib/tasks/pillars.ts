/**
 * Pillar tasks are ordinary parent tasks (`tasks.parent_task_id`). A pillar
 * such as "SEO Setup" holds the short chores as subtasks.
 *
 * Time: new timer, manual, and completion rows are stored on the pillar.
 * `resolve_time_tracking_task_id` (migration 101) rewrites the insert, and the
 * timer RPC resolves before it claims the assignee. Recurring successors also
 * use `parent_task_id`, but they copy `recurrence` and the parent title, so
 * they keep their own time. Service-role imports are not rewritten
 * (`auth.uid()` is null). Hours already stored on a subtask are not moved;
 * the pillar total adds them on read.
 *
 * Campaign Desk is unchanged. It attributes each `time_logs` row to the
 * stored `task_id` and only schedules tasks that have a `start_date`. Pillar
 * subtasks are created without a start date, so they are not separate forecast
 * blocks. New SEO PM time lands on the pillar id.
 *
 * Plan: grouping creates one checklist row linked to the pillar and removes
 * the source rows. Subtasks do not get plan rows. Creating tasks separately
 * still promotes each item on its own.
 *
 * Already-linked rows nest the existing tasks under a new pillar. Those tasks
 * keep their ids, history, and Basecamp to-do ids. The plan still collapses to
 * one row on the pillar.
 */

import { itemsEligibleForTaskGeneration } from '../marketing-plan-logic';
import { isInRoadmap, type RoadmapPhase } from '../marketing-plan-roadmap';
import type { MarketingPlanItem, TaskPriority } from '../types';

export const SEO_SETUP_PILLAR_TITLE = 'SEO Setup';

/** 15 minutes. A missing estimate counts as a short chore. */
export const PILLAR_SHORT_HOURS = 0.25;

export const PILLAR_TIME_BEHAVIOR =
    'Time is tracked on this task. A timer or manual entry started on a subtask is stored here, and hours already logged on a subtask still count in this total.';

export const PILLAR_SUBTASK_HINT =
    'Subtasks stay under this task. They do not each need a plan row, and time is tracked on the parent.';

export const PILLAR_GROUP_NOTE =
    'Grouping replaces these checklist rows with one item linked to the pillar. Each selected chore becomes a subtask.';

export const PILLAR_NEST_NOTE =
    'Each selected task stays, including its history and Basecamp link. The plan keeps one row on the pillar, and time is tracked on that task.';

export interface TimeTrackingTask {
    id: string;
    parentTaskId?: string | null;
    recurrence?: unknown;
    title?: string;
}

/**
 * Where a new time entry belongs.
 * A recurring successor points at the completed task with the same title and
 * must keep its own row.
 */
export function timeTrackingTaskId(
    task: TimeTrackingTask,
    parent?: { title: string } | null,
): string {
    if (!task.parentTaskId || task.recurrence) return task.id;
    if (parent && task.title != null && parent.title === task.title) return task.id;
    return task.parentTaskId;
}

export function rollupLoggedHours(
    entries: ReadonlyArray<{ taskId?: string | null; hours?: number | null }>,
    pillarId: string,
    childIds: readonly string[],
): number {
    const ids = new Set([pillarId, ...childIds]);
    return entries.reduce((sum, entry) => {
        if (!entry.taskId || !ids.has(entry.taskId)) return sum;
        const hours = entry.hours ?? 0;
        return sum + (Number.isFinite(hours) ? hours : 0);
    }, 0);
}

export function isShortChore(estimatedHours: number | null | undefined): boolean {
    if (estimatedHours == null || Number.isNaN(estimatedHours)) return true;
    return estimatedHours >= 0 && estimatedHours <= PILLAR_SHORT_HOURS;
}

export interface PillarSuggestion {
    title: string;
    reason: string;
}

/** Optional hint when the current selection is a same-owner setup bundle. */
export function suggestPillarGroup(items: ReadonlyArray<{
    stepKey: string;
    assigneeId?: string | null;
    estimatedHours?: number | null;
}>): PillarSuggestion | null {
    if (items.length < 2) return null;
    if (!items.every(item => item.stepKey === 'setup')) return null;
    if (!items.every(item => isShortChore(item.estimatedHours))) return null;
    const owners = new Set(items.map(item => item.assigneeId ?? ''));
    if (owners.size !== 1) return null;
    return {
        title: SEO_SETUP_PILLAR_TITLE,
        reason: 'These are short setup chores with the same owner. Group them under one SEO Setup task so the plan stays quiet and time is tracked on that task.',
    };
}

export function defaultPillarTitle(
    items: ReadonlyArray<{ stepKey: string }>,
    scopeLabel: string,
): string {
    if (items.length > 0 && items.every(item => item.stepKey === 'setup')) return SEO_SETUP_PILLAR_TITLE;
    const label = scopeLabel.trim();
    return label || SEO_SETUP_PILLAR_TITLE;
}

export interface PillarSubtaskDraft {
    title: string;
    description?: string;
}

export interface PillarPlan {
    title: string;
    description: string;
    stepKey: string;
    priority: TaskPriority;
    assigneeIds?: string[];
    estimatedHours?: number;
    roadmapPhase: RoadmapPhase;
    subtasks: PillarSubtaskDraft[];
    retireItemIds: string[];
}

const PRIORITY_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, urgent: 3 };

type PillarSource = MarketingPlanItem & { estimatedHours?: number | null };

export function planPillarFromItems(items: readonly PillarSource[], title: string): PillarPlan | null {
    const eligibleIds = new Set(itemsEligibleForTaskGeneration([...items]).map(item => item.id));
    const eligible = items.filter(item => eligibleIds.has(item.id));
    const trimmed = title.trim();
    if (eligible.length < 2 || !trimmed) return null;

    const stepKey = dominantStepKey(eligible);
    const owners = new Set(eligible.map(item => item.assigneeId ?? ''));
    const sharedOwner = owners.size === 1 ? [...owners][0] : '';
    const estimates = eligible
        .map(item => item.estimatedHours)
        .filter((hours): hours is number => typeof hours === 'number' && Number.isFinite(hours) && hours > 0);

    return {
        title: trimmed.slice(0, 200),
        description: `Grouped checklist. Time is tracked on this task. ${eligible.length} subtasks sit under it and do not each need a plan row.`,
        stepKey,
        priority: highestPriority(eligible),
        ...(sharedOwner ? { assigneeIds: [sharedOwner] } : {}),
        ...(estimates.length > 0 ? { estimatedHours: estimates.reduce((sum, hours) => sum + hours, 0) } : {}),
        roadmapPhase: pillarRoadmapPhase(eligible),
        subtasks: eligible.map(item => ({
            title: item.title.trim(),
            ...(item.description?.trim() ? { description: item.description.trim() } : {}),
        })).filter(item => item.title),
        retireItemIds: eligible.map(item => item.id),
    };
}

function dominantStepKey(items: readonly { stepKey: string }[]): string {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.stepKey, (counts.get(item.stepKey) ?? 0) + 1);
    let best = items[0]?.stepKey ?? 'setup';
    let bestCount = -1;
    for (const [key, count] of counts) {
        if (count > bestCount) {
            best = key;
            bestCount = count;
        }
    }
    return best;
}

function highestPriority(items: readonly { priority: string }[]): TaskPriority {
    let best: TaskPriority = 'medium';
    let rank = -1;
    for (const item of items) {
        if (!(item.priority in PRIORITY_RANK)) continue;
        const next = PRIORITY_RANK[item.priority];
        if (next > rank) {
            rank = next;
            best = item.priority as TaskPriority;
        }
    }
    return best;
}

function pillarRoadmapPhase(items: readonly { roadmapPhase?: RoadmapPhase | null }[]): RoadmapPhase {
    const phases = items.map(item => item.roadmapPhase ?? 'backlog');
    const unique = new Set(phases);
    if (unique.size === 1) return phases[0];
    if (phases.includes('onboarding')) return 'onboarding';
    return 'backlog';
}

export interface PillarNestCandidate {
    /** Checklist row to retire. Absent when the task is not on the plan. */
    planItemId?: string;
    taskId: string;
    organizationId: string;
    clientId: string;
    title: string;
    stepKey: string;
    priority: TaskPriority;
    assigneeId?: string | null;
    estimatedHours?: number | null;
    roadmapPhase?: RoadmapPhase | null;
    parentTaskId?: string | null;
    recurrence?: unknown;
    basecampTodoId?: string | number | null;
}

export interface NestPillarPlan {
    title: string;
    description: string;
    stepKey: string;
    priority: TaskPriority;
    assigneeIds?: string[];
    estimatedHours?: number;
    roadmapPhase: RoadmapPhase;
    /** Existing tasks to reparent. New subtask copies are not part of this plan. */
    childTaskIds: string[];
    retireItemIds: string[];
    preservedBasecampTodoIds: string[];
}

function linkedBasecampId(value: string | number | null | undefined): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

/** A linked checklist row whose task can become a subtask. */
export function nestCandidateFromPlanItem(item: MarketingPlanItem): PillarNestCandidate | null {
    if (!item.taskId || !isInRoadmap(item)) return null;
    const task = item.linkedTask;
    if (task?.parentTaskId || task?.recurrence) return null;
    const title = item.title.trim();
    if (!title) return null;
    return {
        planItemId: item.id,
        taskId: item.taskId,
        organizationId: item.organizationId,
        clientId: item.clientId,
        title,
        stepKey: item.stepKey,
        priority: item.priority,
        assigneeId: item.assigneeId ?? task?.assigneeIds?.[0] ?? null,
        estimatedHours: task?.estimatedHours ?? null,
        roadmapPhase: item.roadmapPhase ?? 'backlog',
        parentTaskId: task?.parentTaskId ?? null,
        recurrence: task?.recurrence,
        basecampTodoId: task?.basecampTodoId ?? null,
    };
}

export function itemsEligibleForPillarNest(items: readonly MarketingPlanItem[]): MarketingPlanItem[] {
    return items.filter(item => nestCandidateFromPlanItem(item) != null);
}

/**
 * Short setup chores start checked. A longer setup deliverable, such as the
 * SEO roadmap, stays listed so it can be included and starts unchecked.
 */
export function defaultNestSelection(items: readonly MarketingPlanItem[]): string[] {
    const eligible = itemsEligibleForPillarNest(items);
    const shortSetup = eligible.filter(item =>
        item.stepKey === 'setup' && isShortChore(item.linkedTask?.estimatedHours),
    );
    if (shortSetup.length >= 2) return shortSetup.map(item => item.id);
    return eligible.map(item => item.id);
}

export function planNestUnderPillar(
    candidates: readonly PillarNestCandidate[],
    title: string,
): NestPillarPlan | null {
    const trimmed = title.trim();
    const clients = new Set(candidates.map(item => `${item.organizationId}\0${item.clientId}`));
    if (!trimmed || candidates.length === 0 || clients.size !== 1) return null;

    const eligible = candidates.filter(item =>
        item.taskId && item.title.trim() && !item.parentTaskId && !item.recurrence,
    );
    const byTask = new Map<string, PillarNestCandidate>();
    for (const item of eligible) {
        if (!byTask.has(item.taskId)) byTask.set(item.taskId, item);
    }
    if (byTask.size < 2) return null;

    const unique = [...byTask.values()];
    const owners = new Set(unique.map(item => item.assigneeId ?? ''));
    const sharedOwner = owners.size === 1 ? [...owners][0] : '';
    const estimates = unique
        .map(item => item.estimatedHours)
        .filter((hours): hours is number => typeof hours === 'number' && Number.isFinite(hours) && hours > 0);
    const preserved = unique
        .map(item => linkedBasecampId(item.basecampTodoId))
        .filter((id): id is string => id != null);

    return {
        title: trimmed.slice(0, 200),
        description: `Grouped existing tasks. Time is tracked on this task. ${unique.length} tasks stay as subtasks and keep their history and Basecamp links.`,
        stepKey: dominantStepKey(unique),
        priority: highestPriority(unique),
        ...(sharedOwner ? { assigneeIds: [sharedOwner] } : {}),
        ...(estimates.length > 0 ? { estimatedHours: estimates.reduce((sum, hours) => sum + hours, 0) } : {}),
        roadmapPhase: pillarRoadmapPhase(unique),
        childTaskIds: unique.map(item => item.taskId),
        retireItemIds: eligible.flatMap(item => item.planItemId ? [item.planItemId] : []),
        preservedBasecampTodoIds: preserved,
    };
}
