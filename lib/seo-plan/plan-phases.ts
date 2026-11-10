import { INITIATIVE_PHASES } from '../campaign-workspace/initiatives';
import { MARKETING_PLAN_STEPS } from '../marketing-plan-template';
import { isTaskStage } from '../tasks/stage';
import type { MarketingPlanStep, TaskStage } from '../types';
import { isPlanDone, isPlanLate, type PlanGroup } from './plan-sections';
import { compareStageListTasks, groupTasksByStage, type StageListTask } from './stage-list';

/**
 * Stages on a new work plan.
 * The slugs are the campaign initiative phases. Display copy is plain
 * language for a client. An existing plan that was not marked keeps the
 * month board. Nothing here rewrites saved tasks.
 */
export const PLAN_PHASES = INITIATIVE_PHASES;

export type PlanPhase = (typeof PLAN_PHASES)[number];

export type BoardStage = TaskStage | PlanPhase;

export type PlanBoard = 'phases' | 'months';

export const PHASE_STAGE_COPY: Record<PlanPhase, { title: string; description: string }> = {
    foundation: {
        title: 'Foundation',
        description: 'Fixing the basics so Google can find and trust the site.',
    },
    growth: {
        title: 'Growth',
        description: 'Adding the pages people are searching for, so the site can start to show up.',
    },
    scale: {
        title: 'Scale',
        description: 'Doing more of what already works, so more of the right people find the site.',
    },
};

export const PHASE_BOARD_EMPTY = 'This plan has no tasks yet. Type a task under the stage it belongs to.';

export const PHASE_ADD_PLACEHOLDER = 'Add a task';

export function phaseAddLabel(phase: PlanPhase): string {
    return `Add a task to ${PHASE_STAGE_COPY[phase].title}`;
}

export function isPlanPhase(value: unknown): value is PlanPhase {
    return typeof value === 'string' && (PLAN_PHASES as readonly string[]).includes(value);
}

export function isBoardStage(value: unknown): value is BoardStage {
    return isTaskStage(value) || isPlanPhase(value);
}

/** Checklist categories, plus the marker that this plan uses phase stages. */
export function phasePlanSteps(): Array<MarketingPlanStep & { workBoard: 'phases' }> {
    return MARKETING_PLAN_STEPS.map(step => ({ ...step, workBoard: 'phases' as const }));
}

/**
 * Month board unless the plan was created with the phase marker.
 * Older plans do not have the marker, so they keep Onboarding, This month,
 * and Backlog. Missing or unexpected steps stay on the month board.
 */
export function planBoardFromSteps(steps: unknown): PlanBoard {
    if (!Array.isArray(steps)) return 'months';
    for (const step of steps) {
        if (!step || typeof step !== 'object') continue;
        if ((step as { workBoard?: unknown }).workBoard === 'phases') return 'phases';
    }
    return 'months';
}

export interface NewPlanStage {
    id: PlanPhase;
    title: string;
    description: string;
}

/** The three stages setup shows. No tasks. */
export function stagesForNewPlan(): { board: 'phases'; stages: NewPlanStage[]; tasks: readonly [] } {
    return {
        board: 'phases',
        stages: PLAN_PHASES.map(id => ({
            id,
            title: PHASE_STAGE_COPY[id].title,
            description: PHASE_STAGE_COPY[id].description,
        })),
        tasks: [],
    };
}

export interface PhaseBoardSection {
    id: PlanPhase;
    title: string;
    description: string;
    count: number;
    open: number;
    late: number;
    done: number;
    meta: string;
    collapsedComplete: boolean;
    defaultCollapsed: boolean;
    empty: string;
    groups: PlanGroup[];
}

function toPlanGroup(group: {
    task: StageListTask;
    children: StageListTask[];
    childCount: number;
    childDone: number;
    expandChildren: boolean;
    parentBreadcrumb?: string;
}): PlanGroup {
    return {
        task: group.task,
        children: group.children,
        childCount: group.childCount,
        childDone: group.childDone,
        urlCount: group.children.filter(child => Boolean(child.publishedUrl?.trim())).length,
        hiddenChildren: 0,
        rollupChildIds: group.children.map(child => child.id),
        expandChildren: group.expandChildren,
        parentBreadcrumb: group.parentBreadcrumb,
    };
}

function sectionCounts(groups: readonly PlanGroup[], today: string): { count: number; open: number; late: number; done: number } {
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

/**
 * Group tasks into Foundation, Growth, and Scale.
 * Empty stages are always returned, in that order.
 * A task whose stage is not a phase is shown under Foundation and is not rewritten.
 */
export function groupTasksByPhase(
    tasks: readonly StageListTask[],
    query: string,
    today: string,
): PhaseBoardSection[] {
    const tree = groupTasksByStage(tasks, query);
    const buckets = new Map<PlanPhase, PlanGroup[]>(PLAN_PHASES.map(phase => [phase, []]));
    for (const section of tree) {
        for (const group of section.groups) {
            const phase = isPlanPhase(group.task.stage) ? group.task.stage : 'foundation';
            buckets.get(phase)!.push(toPlanGroup(group));
        }
    }
    const words = query.trim();
    return PLAN_PHASES.map(id => {
        const copy = PHASE_STAGE_COPY[id];
        const groups = [...(buckets.get(id) ?? [])].sort((a, b) => compareStageListTasks(a.task, b.task));
        const counts = sectionCounts(groups, today);
        const late = counts.late > 0 ? ` · ${counts.late} late` : '';
        const meta = counts.count === 0
            ? 'Nothing here yet'
            : `${counts.open} open${late} · ${counts.done} done`;
        return {
            id,
            title: copy.title,
            description: copy.description,
            ...counts,
            meta,
            collapsedComplete: false,
            defaultCollapsed: false,
            empty: words ? `No tasks in ${copy.title} match "${words}".` : `Nothing in ${copy.title} yet.`,
            groups,
        };
    });
}
