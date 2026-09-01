export interface EventTaskConversionInput {
    event: {
        id: string;
        organizationId: string;
        userId: string;
        title: string;
        startsAt: string;
        endsAt: string;
    };
    task: {
        organizationId: string;
        clientId?: string;
        title: string;
        dueDate?: string;
        createdBy?: string;
        [key: string]: unknown;
    };
    clientName: string;
    syncTaskToBasecamp: boolean;
    logEventTime: boolean;
    countsTowardBudget: boolean;
    syncTimeToBasecamp: boolean;
    timeZone: string;
}

interface CreatedTask {
    id: string;
    title: string;
}

interface BasecampSyncResult {
    success: boolean;
    error?: string;
}

interface CreatedTimeLog {
    id: string;
}

export interface EventTaskConversionDependencies {
    createTask(input: EventTaskConversionInput['task'] & {
        syncToBasecamp: boolean;
        waitForBasecampSync: boolean;
    }): Promise<{
        success: boolean;
        data?: CreatedTask;
        error?: string;
        basecampSync?: BasecampSyncResult;
    }>;
    linkEvent(
        eventId: string,
        patch: { clientId: string; taskId: string },
    ): Promise<boolean>;
    findEventTimeLog(eventId: string): Promise<CreatedTimeLog | null>;
    reconcileEventTimeLog(
        timeLogId: string,
        input: Record<string, unknown>,
    ): Promise<{
        success: boolean;
        data?: CreatedTimeLog;
        error?: string;
    }>;
    syncTimeLog(timeLogId: string): Promise<BasecampSyncResult>;
    createTimeLog(
        input: Record<string, unknown>,
        options: { syncToBasecamp: boolean; waitForBasecampSync: boolean },
    ): Promise<{
        success: boolean;
        data?: CreatedTimeLog;
        error?: string;
        basecampSync?: BasecampSyncResult;
    }>;
}

export type EventTaskConversionResult = {
    status: 'failed';
    error: string;
} | {
    status: 'complete' | 'partial';
    taskId: string;
    taskBasecampSynced: boolean;
    taskBasecampError?: string;
    eventLinked: boolean;
    timeLogId?: string;
    timeLogged: boolean;
    timeAlreadyLogged: boolean;
    timeBasecampSynced: boolean;
    timeError?: string;
};

function dateInTimeZone(instant: string, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => (
        parts.find(part => part.type === type)?.value ?? ''
    );
    return `${value('year')}-${value('month')}-${value('day')}`;
}

export async function convertPlannerEventToTask(
    input: EventTaskConversionInput,
    dependencies: EventTaskConversionDependencies,
): Promise<EventTaskConversionResult> {
    const clientId = input.task.clientId;
    if (!clientId) {
        return { status: 'failed', error: 'Select a client before creating this task.' };
    }

    const created = await dependencies.createTask({
        ...input.task,
        syncToBasecamp: input.syncTaskToBasecamp,
        waitForBasecampSync: input.syncTaskToBasecamp,
    });
    if (!created.success || !created.data) {
        return { status: 'failed', error: created.error ?? 'Failed to create task.' };
    }

    const taskBasecampSynced = !input.syncTaskToBasecamp || created.basecampSync?.success === true;
    const eventLinked = await dependencies.linkEvent(input.event.id, {
        clientId,
        taskId: created.data.id,
    });

    let timeLogId: string | undefined;
    let timeLogged = false;
    let timeAlreadyLogged = false;
    let timeBasecampSynced = !input.syncTimeToBasecamp;
    let timeError: string | undefined;

    if (input.logEventTime) {
        const plannedMinutes = Math.max(1, Math.round(
            (new Date(input.event.endsAt).getTime() - new Date(input.event.startsAt).getTime()) / 60_000,
        ));
        const timeLogPatch = {
            clientId,
            taskId: created.data.id,
            date: dateInTimeZone(input.event.startsAt, input.timeZone),
            hours: Math.round((plannedMinutes / 60) * 100) / 100,
            description: input.event.title,
            billable: true,
            countsTowardBudget: input.countsTowardBudget,
            plannedStartsAt: input.event.startsAt,
            plannedMinutes,
        };
        const existing = await dependencies.findEventTimeLog(input.event.id);
        if (existing) {
            timeLogId = existing.id;
            const reconciled = await dependencies.reconcileEventTimeLog(existing.id, timeLogPatch);
            if (reconciled.success) {
                timeAlreadyLogged = true;
                if (input.syncTimeToBasecamp) {
                    const synced = await dependencies.syncTimeLog(existing.id);
                    timeBasecampSynced = synced.success;
                    if (!synced.success) timeError = synced.error ?? 'Failed to sync event time.';
                }
            } else {
                timeError = reconciled.error ?? 'Failed to link the existing event time.';
            }
        } else {
            const logged = await dependencies.createTimeLog({
                organizationId: input.event.organizationId,
                userId: input.event.userId,
                plannerEventId: input.event.id,
                ...timeLogPatch,
            }, {
                syncToBasecamp: input.syncTimeToBasecamp,
                waitForBasecampSync: input.syncTimeToBasecamp,
            });
            if (logged.success && logged.data) {
                timeLogId = logged.data.id;
                timeLogged = true;
                timeBasecampSynced = !input.syncTimeToBasecamp || logged.basecampSync?.success === true;
                if (!timeBasecampSynced) timeError = logged.basecampSync?.error;
            } else {
                timeError = logged.error ?? 'Failed to log event time.';
            }
        }
    }

    const partial = !eventLinked
        || !taskBasecampSynced
        || Boolean(timeError)
        || (input.logEventTime && !timeLogged && !timeAlreadyLogged);

    return {
        status: partial ? 'partial' : 'complete',
        taskId: created.data.id,
        taskBasecampSynced,
        ...(created.basecampSync?.error ? { taskBasecampError: created.basecampSync.error } : {}),
        eventLinked,
        ...(timeLogId ? { timeLogId } : {}),
        timeLogged,
        timeAlreadyLogged,
        timeBasecampSynced,
        ...(timeError ? { timeError } : {}),
    };
}
