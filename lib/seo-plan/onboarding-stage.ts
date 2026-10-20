import { nextStagePositions } from './stage-add';

/**
 * Stage writes for "Add onboarding to SEO Plan".
 *
 * Import already places a new onboarding-list to-do in Onboarding. This is
 * the same placement for tasks imported before that, and for the click that
 * still links the checklist. A task already in Onboarding is left alone,
 * including its position, so a second click does not reshuffle the column.
 * A direct subtask of one of those tasks follows the parent. Its own
 * position stays, because that order is among siblings, not the column.
 */

export interface OnboardingStageTask {
    id: string;
    stage: string | null;
    parentTaskId: string | null;
    position: number | null;
}

export interface OnboardingStageWrite {
    id: string;
    /** Set on a top-level row. Omitted on a subtask. */
    position?: number;
}

export function maxTopLevelOnboardingPosition(tasks: readonly OnboardingStageTask[]): number | null {
    let max: number | null = null;
    for (const task of tasks) {
        if (task.parentTaskId) continue;
        if (task.stage !== 'onboarding') continue;
        if (typeof task.position !== 'number' || !Number.isFinite(task.position)) continue;
        max = max == null ? task.position : Math.max(max, task.position);
    }
    return max;
}

export function onboardingStageWrites(input: {
    tasks: readonly OnboardingStageTask[];
    /** Top-level tasks this add is responsible for. */
    includedIds: ReadonlySet<string>;
    maxPosition: number | null;
}): OnboardingStageWrite[] {
    const parents = input.tasks.filter(task => input.includedIds.has(task.id) && !task.parentTaskId);
    const moving = parents.filter(task => task.stage !== 'onboarding');
    moving.sort((left, right) => {
        const leftPosition = typeof left.position === 'number' && Number.isFinite(left.position)
            ? left.position
            : Number.POSITIVE_INFINITY;
        const rightPosition = typeof right.position === 'number' && Number.isFinite(right.position)
            ? right.position
            : Number.POSITIVE_INFINITY;
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
        if (left.id !== right.id) return left.id < right.id ? -1 : 1;
        return 0;
    });
    const positions = nextStagePositions(input.maxPosition, moving.length);
    const writes: OnboardingStageWrite[] = moving.map((task, index) => ({
        id: task.id,
        position: positions[index],
    }));

    const parentIds = new Set(parents.map(task => task.id));
    const children = input.tasks
        .filter(task => task.parentTaskId && parentIds.has(task.parentTaskId) && task.stage !== 'onboarding')
        .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    for (const child of children) writes.push({ id: child.id });
    return writes;
}
