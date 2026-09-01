import test from 'node:test';
import assert from 'node:assert/strict';
import {
    convertPlannerEventToTask,
    type EventTaskConversionDependencies,
    type EventTaskConversionInput,
} from './event-task-conversion.ts';

const input: EventTaskConversionInput = {
    event: {
        id: 'event-1',
        organizationId: 'org-1',
        userId: 'user-1',
        title: 'SEO Content Optimization',
        startsAt: '2026-08-31T17:30:00.000Z',
        endsAt: '2026-08-31T20:30:00.000Z',
    },
    task: {
        organizationId: 'org-1',
        clientId: 'client-1',
        title: 'SEO Content Optimization',
        dueDate: '2026-08-31',
        createdBy: 'user-1',
    },
    clientName: 'Ecoworkz',
    syncTaskToBasecamp: true,
    logEventTime: true,
    countsTowardBudget: true,
    syncTimeToBasecamp: true,
    timeZone: 'America/Los_Angeles',
};

function dependencies(overrides: Partial<EventTaskConversionDependencies> = {}) {
    const calls = {
        linked: [] as Array<{ eventId: string; clientId: string; taskId: string }>,
        timeLogs: [] as Array<Record<string, unknown>>,
        reconciledTimeLogs: [] as Array<{ id: string; patch: Record<string, unknown> }>,
        syncedTimeLogs: [] as string[],
    };
    const deps: EventTaskConversionDependencies = {
        createTask: async () => ({
            success: true,
            data: { id: 'task-1', title: 'SEO Content Optimization' },
            basecampSync: { success: true },
        }),
        linkEvent: async (eventId, patch) => {
            calls.linked.push({ eventId, ...patch });
            return true;
        },
        findEventTimeLog: async () => null,
        reconcileEventTimeLog: async (id, patch) => {
            calls.reconciledTimeLogs.push({ id, patch });
            return { success: true, data: { id } };
        },
        syncTimeLog: async id => {
            calls.syncedTimeLogs.push(id);
            return { success: true };
        },
        createTimeLog: async log => {
            calls.timeLogs.push(log);
            return {
                success: true,
                data: { id: 'log-1' },
                basecampSync: { success: true },
            };
        },
        ...overrides,
    };
    return { calls, deps };
}

test('conversion links the Ecoworkz task and logs the exact event block once', async () => {
    // Catches losing the task/event relation or logging a generic duration/date.
    const { calls, deps } = dependencies();

    const result = await convertPlannerEventToTask(input, deps);

    assert.deepEqual(result, {
        status: 'complete',
        taskId: 'task-1',
        taskBasecampSynced: true,
        eventLinked: true,
        timeLogId: 'log-1',
        timeLogged: true,
        timeAlreadyLogged: false,
        timeBasecampSynced: true,
    });
    assert.deepEqual(calls.linked, [{
        eventId: 'event-1',
        clientId: 'client-1',
        taskId: 'task-1',
    }]);
    assert.deepEqual(calls.timeLogs, [{
        organizationId: 'org-1',
        userId: 'user-1',
        clientId: 'client-1',
        taskId: 'task-1',
        plannerEventId: 'event-1',
        date: '2026-08-31',
        hours: 3,
        description: 'SEO Content Optimization',
        billable: true,
        countsTowardBudget: true,
        plannedStartsAt: '2026-08-31T17:30:00.000Z',
        plannedMinutes: 180,
    }]);
});

test('conversion reattaches and syncs existing event time instead of duplicating it', async () => {
    // Catches a Personal/unassigned attempt leaving the existing time detached from the new client task.
    let createCalls = 0;
    const { calls, deps } = dependencies({
        findEventTimeLog: async () => ({ id: 'existing-log' }),
        createTimeLog: async () => {
            createCalls += 1;
            return { success: true, data: { id: 'unexpected' } };
        },
    });

    const result = await convertPlannerEventToTask(input, deps);

    assert.equal(createCalls, 0);
    assert.equal(result.timeLogId, 'existing-log');
    assert.equal(result.timeLogged, false);
    assert.equal(result.timeAlreadyLogged, true);
    assert.deepEqual(calls.reconciledTimeLogs, [{
        id: 'existing-log',
        patch: {
            clientId: 'client-1',
            taskId: 'task-1',
            date: '2026-08-31',
            hours: 3,
            description: 'SEO Content Optimization',
            billable: true,
            countsTowardBudget: true,
            plannedStartsAt: '2026-08-31T17:30:00.000Z',
            plannedMinutes: 180,
        },
    }]);
    assert.deepEqual(calls.syncedTimeLogs, ['existing-log']);
    assert.equal(result.timeBasecampSynced, true);
});

test('a Basecamp failure preserves the created task and reports a partial result', async () => {
    // Catches the modal claiming full success or discarding the SEO PM task.
    const { deps } = dependencies({
        createTask: async () => ({
            success: true,
            data: { id: 'task-1', title: 'SEO Content Optimization' },
            basecampSync: { success: false, error: 'Basecamp unavailable' },
        }),
    });

    const result = await convertPlannerEventToTask(input, deps);

    assert.equal(result.status, 'partial');
    assert.equal(result.taskId, 'task-1');
    assert.equal(result.taskBasecampSynced, false);
    assert.equal(result.taskBasecampError, 'Basecamp unavailable');
    assert.equal(result.timeLogged, true);
});

test('event conversion requires a client before creating any task', async () => {
    // Catches a regression back to unassigned tasks that cannot sync to Basecamp.
    let taskCalls = 0;
    const { deps } = dependencies({
        createTask: async () => {
            taskCalls += 1;
            return { success: false, error: 'unexpected' };
        },
    });

    const result = await convertPlannerEventToTask({
        ...input,
        task: { ...input.task, clientId: undefined },
    }, deps);

    assert.equal(taskCalls, 0);
    assert.deepEqual(result, {
        status: 'failed',
        error: 'Select a client before creating this task.',
    });
});
