import { TASK_STAGES, type TaskStage } from '../types.ts';

/** True when the value is one of the migration 103 roadmap columns. */
export function isTaskStage(value: unknown): value is TaskStage {
    return typeof value === 'string' && (TASK_STAGES as readonly string[]).includes(value);
}

/**
 * Earliest roadmap phase in the list.
 * TASK_STAGES is ordered earliest first: onboarding, then month 1–3, then backlog.
 * Unknown values are ignored. No usable phase stays backlog.
 */
export function earliestTaskStage(phases: readonly (string | null | undefined)[]): TaskStage {
    let best: TaskStage = 'backlog';
    let bestIndex = TASK_STAGES.indexOf(best);
    for (const phase of phases) {
        if (!isTaskStage(phase)) continue;
        const index = TASK_STAGES.indexOf(phase);
        if (index < bestIndex) {
            best = phase;
            bestIndex = index;
        }
    }
    return best;
}
