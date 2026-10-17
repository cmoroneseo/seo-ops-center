import type { StageListTask } from './stage-list';

export const PENDING_STAGE_TASK_PREFIX = 'pending:';

export function isPendingStageTaskId(id: string): boolean {
    return id.startsWith(PENDING_STAGE_TASK_PREFIX);
}

export function pendingStageTaskId(): string {
    return `${PENDING_STAGE_TASK_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Positions appended after the current end.
 * An empty group starts at 1. The database default is 0, so a new row still
 * sorts after any task that has not been placed yet.
 */
export function nextStagePositions(maxPosition: number | null, count: number): number[] {
    if (count < 1) return [];
    const start = maxPosition == null || !Number.isFinite(maxPosition) ? 1 : maxPosition + 1;
    return Array.from({ length: count }, (_, index) => start + index);
}

/**
 * The position a new row should follow.
 * Top-level tasks share a stage. Subtasks follow every sibling in the pillar,
 * including siblings whose own stage column differs, so the new row renders last.
 */
export function endPosition(
    tasks: readonly Pick<StageListTask, 'stage' | 'position' | 'parentTaskId'>[],
    stage: string,
    parentTaskId: string | null,
): number | null {
    let max: number | null = null;
    for (const task of tasks) {
        if ((task.parentTaskId ?? null) !== parentTaskId) continue;
        if (parentTaskId == null && task.stage !== stage) continue;
        if (typeof task.position !== 'number' || !Number.isFinite(task.position)) continue;
        max = max == null ? task.position : Math.max(max, task.position);
    }
    return max;
}

export function pendingStageTasks(input: {
    titles: readonly string[];
    stage: string;
    parentTaskId: string | null;
    ids: readonly string[];
    createdAt: string;
    positions: readonly number[];
    publishedUrls?: readonly (string | null)[];
}): StageListTask[] {
    return input.titles.map((title, index) => ({
        id: input.ids[index] ?? `${PENDING_STAGE_TASK_PREFIX}${index}`,
        title,
        status: 'todo',
        stage: input.stage,
        position: input.positions[index] ?? null,
        parentTaskId: input.parentTaskId,
        createdAt: input.createdAt,
        category: null,
        basecamp: false,
        recurring: false,
        ...(input.publishedUrls?.[index] ? { publishedUrl: input.publishedUrls[index] } : {}),
    }));
}

export function appendStageTasks(current: readonly StageListTask[], added: readonly StageListTask[]): StageListTask[] {
    return [...current, ...added];
}

export function rollbackStageTasks(current: readonly StageListTask[], pendingIds: readonly string[]): StageListTask[] {
    const drop = new Set(pendingIds);
    return current.filter(task => !drop.has(task.id));
}

/** Drop the optimistic rows and keep the saved tasks. A row already loaded is not duplicated. */
export function commitStageTasks(
    current: readonly StageListTask[],
    pendingIds: readonly string[],
    created: readonly StageListTask[],
): StageListTask[] {
    const drop = new Set(pendingIds);
    const kept = current.filter(task => !drop.has(task.id));
    const seen = new Set(kept.map(task => task.id));
    return [...kept, ...created.filter(task => task.id.length > 0 && !seen.has(task.id))];
}
