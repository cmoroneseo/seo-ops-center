export type CompletionMode = 'log_scheduled' | 'tracked' | 'stop_timer' | 'complete_only';

export interface CompletionReconciliationInput {
    scheduledMinutes?: number | null;
    trackedHours: number;
    hasOpenAttempt: boolean;
}

export interface CompletionReconciliation {
    scheduledMinutes: number;
    trackedMinutes: number;
    varianceMinutes: number;
    recommendedAdditionalMinutes: number;
    mode: CompletionMode;
}

/** Decide the least-surprising completion action from the available evidence. */
export function completionReconciliation(
    input: CompletionReconciliationInput,
): CompletionReconciliation {
    const scheduledMinutes = Math.max(0, Math.round(input.scheduledMinutes ?? 0));
    const trackedMinutes = Math.max(0, Math.round(input.trackedHours * 60));
    const varianceMinutes = trackedMinutes - scheduledMinutes;

    if (input.hasOpenAttempt) {
        return {
            scheduledMinutes,
            trackedMinutes,
            varianceMinutes,
            recommendedAdditionalMinutes: 0,
            mode: 'stop_timer',
        };
    }
    if (trackedMinutes > 0) {
        return {
            scheduledMinutes,
            trackedMinutes,
            varianceMinutes,
            recommendedAdditionalMinutes: 0,
            mode: 'tracked',
        };
    }
    if (scheduledMinutes > 0) {
        return {
            scheduledMinutes,
            trackedMinutes,
            varianceMinutes,
            recommendedAdditionalMinutes: scheduledMinutes,
            mode: 'log_scheduled',
        };
    }
    return {
        scheduledMinutes,
        trackedMinutes,
        varianceMinutes,
        recommendedAdditionalMinutes: 0,
        mode: 'complete_only',
    };
}

export function formatCompletionDuration(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    if (hours === 0) return `${remainder}m`;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export interface CompleteTaskInput {
    taskId: string;
    additionalMinutes: number;
    operationId: string;
}

interface CompletionDependencies<TaskResult> {
    logTime(input: CompleteTaskInput): Promise<{
        success: boolean;
        timeLogId?: string;
        error?: string;
    }>;
    markDone(taskId: string): Promise<{
        success: boolean;
        task?: TaskResult;
        error?: string;
    }>;
}

export type CompleteTaskResult<TaskResult> =
    | { success: true; timeLogId?: string; task: TaskResult }
    | { success: false; timeLogId?: string; error: string };

/** Save optional time first so a failed log can never silently complete a task. */
export async function completeTaskWithReconciliation<TaskResult>(
    input: CompleteTaskInput,
    deps: CompletionDependencies<TaskResult>,
): Promise<CompleteTaskResult<TaskResult>> {
    let timeLogId: string | undefined;
    if (input.additionalMinutes > 0) {
        const logged = await deps.logTime(input);
        if (!logged.success) {
            return { success: false, error: logged.error ?? 'Time could not be saved' };
        }
        timeLogId = logged.timeLogId;
    }

    const completed = await deps.markDone(input.taskId);
    if (!completed.success || !completed.task) {
        return {
            success: false,
            ...(timeLogId ? { timeLogId } : {}),
            error: completed.error ?? 'Task could not be completed',
        };
    }
    return {
        success: true,
        ...(timeLogId ? { timeLogId } : {}),
        task: completed.task,
    };
}
