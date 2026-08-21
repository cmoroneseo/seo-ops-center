import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./timesheet-post-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./timesheet-post-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp timesheet POST handler must be implemented: ${String(error)}`);
    }
}

function request(body: Record<string, unknown>) {
    return new Request('https://seo-ops.test/api/integrations/basecamp/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const clientAuthorization = {
    ok: true as const,
    userId: 'manager-1',
    actorName: 'Manager One',
    organizationId: 'org-a',
    clientId: 'client-a',
    timeLogId: 'log-a',
    organizationIsInternal: false,
    role: 'admin' as const,
    canManageIntegrations: true,
};

const baseLog = {
    id: 'log-a',
    organizationId: 'org-a',
    clientId: 'client-a',
    userId: 'user-1',
    taskId: 'task-a',
    date: '2026-08-20',
    hours: 1,
    description: 'Client work',
    status: 'logged',
    basecampEntryId: null,
    basecampRecordingId: null,
    selectedBasecampProjectId: null,
    configuredProjectId: '202',
    syncEnabled: true,
    timesheetEnabled: true,
    cachedRecordingId: null,
    taskBasecampTodoId: '77',
    taskBasecampProjectId: '202',
    personId: 9,
};

const externalSource = () => ({
    findMembership: async () => ({ organizationIsInternal: false }),
    listConfiguredProjectIds: async () => ['202'],
});

const verifyEntry = async (_projectId: string, entryId: string) => ({
    entryId,
    recordingId: '77',
});
const resolveRecording = async (_projectId: string, candidate: string | null) => candidate ?? '66';

test('timesheet POST rejects unauthenticated and untrusted internal direct calls before store or provider work', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    for (const denial of [
        { ok: false as const, status: 401, error: 'Unauthorized' },
        { ok: false as const, status: 403, error: 'Internal Basecamp time requires a trusted internal organization manager' },
    ]) {
        const post = createBasecampTimesheetPost({
            authorizeTimeLog: async () => denial,
            createStore: () => { throw new Error('store must not be created'); },
            createAccessSource: () => { throw new Error('access source must not be created'); },
            verifyEntry: async () => { throw new Error('provider must not run'); },
            resolveRecording: async () => { throw new Error('provider must not run'); },
            performAuthorized: async () => { throw new Error('provider work must not run'); },
        });

        const response = await post(request({ action: 'sync', timeLogId: 'log-victim' }));

        assert.equal(response.status, denial.status);
    }
});

test('timesheet POST derives client project and task recording from canonical server state', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    let authorizedContext: Record<string, unknown> | null = null;
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({ getTimeLog: async () => baseLog }),
        createAccessSource: () => externalSource(),
        verifyEntry,
        resolveRecording,
        performAuthorized: async (_body, context) => {
            authorizedContext = context as unknown as Record<string, unknown>;
            return Response.json({ success: true });
        },
    });

    const response = await post(request({
        action: 'sync',
        timeLogId: 'log-a',
        projectId: '999',
        recordingId: '888',
    }));

    assert.equal(response.status, 200);
    assert.equal(authorizedContext?.projectId, '202');
    assert.equal(authorizedContext?.recordingId, '77');
});

test('timesheet POST rejects a client task whose provider link does not match client config', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({ ...baseLog, taskBasecampProjectId: '303' }),
        }),
        createAccessSource: () => { throw new Error('access source must not run'); },
        verifyEntry: async () => { throw new Error('provider must not run'); },
        resolveRecording: async () => { throw new Error('provider must not run'); },
        performAuthorized: async () => { throw new Error('provider work must not run'); },
    });

    const response = await post(request({ action: 'sync', timeLogId: 'log-a' }));

    assert.equal(response.status, 409);
});

test('trusted internal timesheet POST authorizes the selected project through the shared catalog guard', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    const internalAuthorization = {
        ...clientAuthorization,
        clientId: null,
        organizationIsInternal: true,
    };
    let projectId: string | null = null;
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => internalAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({
                ...baseLog,
                clientId: null,
                taskId: null,
                selectedBasecampProjectId: '303',
                configuredProjectId: null,
                syncEnabled: false,
                timesheetEnabled: false,
                taskBasecampTodoId: null,
                taskBasecampProjectId: null,
            }),
        }),
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: true }),
            listConfiguredProjectIds: async () => { throw new Error('allowlist must not run'); },
        }),
        verifyEntry,
        resolveRecording,
        performAuthorized: async (_body, context) => {
            projectId = context.projectId;
            return Response.json({ success: true });
        },
    });

    const response = await post(request({ action: 'sync', timeLogId: 'log-a', projectId: '999' }));

    assert.equal(response.status, 200);
    assert.equal(projectId, '303');
});

test('timesheet removal requires the caller entry ID to match the canonical time log link', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({ ...baseLog, basecampEntryId: '66' }),
        }),
        createAccessSource: () => externalSource(),
        verifyEntry: async () => { throw new Error('entry lookup must not run'); },
        resolveRecording: async () => { throw new Error('recording lookup must not run'); },
        performAuthorized: async () => { throw new Error('provider work must not run'); },
    });

    const response = await post(request({ action: 'remove', timeLogId: 'log-a', entryId: '99' }));

    assert.equal(response.status, 409);
});

test('timesheet removal re-authorizes the canonical project before provider deletion', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    let projectId: string | null = null;
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({
                ...baseLog,
                basecampEntryId: '66',
                basecampRecordingId: '77',
            }),
        }),
        createAccessSource: () => externalSource(),
        verifyEntry: async (projectId, entryId) => {
            assert.deepEqual([projectId, entryId], ['202', '66']);
            return { entryId: '66', recordingId: '77' };
        },
        resolveRecording: async () => { throw new Error('recording lookup must not run'); },
        performAuthorized: async (_body, context) => {
            projectId = context.projectId;
            return Response.json({ success: true });
        },
    });

    const response = await post(request({ action: 'remove', timeLogId: 'log-a', entryId: '66' }));

    assert.equal(response.status, 200);
    assert.equal(projectId, '202');
});

test('timesheet refuses an entry absent from the authorized project before flat account mutation', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({
                ...baseLog,
                basecampEntryId: '66',
                basecampRecordingId: '77',
            }),
        }),
        createAccessSource: () => externalSource(),
        verifyEntry: async () => null,
        resolveRecording: async () => { throw new Error('recording lookup must not run'); },
        performAuthorized: async () => { throw new Error('flat mutation must not run'); },
    });

    const response = await post(request({ action: 'sync', timeLogId: 'log-a' }));

    assert.equal(response.status, 409);
});

test('timesheet refuses provider-found legacy entries without a protected recording tuple', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    for (const action of ['sync', 'remove'] as const) {
        let mutationCalls = 0;
        const post = createBasecampTimesheetPost({
            authorizeTimeLog: async () => clientAuthorization,
            createStore: () => ({
                getTimeLog: async () => ({
                    ...baseLog,
                    basecampEntryId: '66',
                    basecampRecordingId: null,
                }),
            }),
            createAccessSource: () => externalSource(),
            verifyEntry: async () => ({ entryId: '66', recordingId: '77' }),
            resolveRecording: async () => { throw new Error('recording lookup must not run'); },
            performAuthorized: async () => {
                mutationCalls += 1;
                return Response.json({ success: true });
            },
        });

        const response = await post(request({ action, timeLogId: 'log-a', entryId: '66' }));

        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), {
            error: 'Legacy Basecamp entry requires operator provenance audit',
        });
        assert.equal(mutationCalls, 0);
    }
});

test('timesheet refuses a provider entry whose recording differs from the protected tuple', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({
            getTimeLog: async () => ({
                ...baseLog,
                basecampEntryId: '66',
                basecampRecordingId: '77',
            }),
        }),
        createAccessSource: () => externalSource(),
        verifyEntry: async () => ({ entryId: '66', recordingId: '88' }),
        resolveRecording: async () => { throw new Error('recording lookup must not run'); },
        performAuthorized: async () => { throw new Error('flat mutation must not run'); },
    });

    const response = await post(request({ action: 'sync', timeLogId: 'log-a' }));

    assert.equal(response.status, 409);
});

test('timesheet verifies a recording under the authorized project before create', async () => {
    const { createBasecampTimesheetPost } = await loadRouteModule();
    let recordingId: string | null = null;
    let resolved = false;
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: async () => clientAuthorization,
        createStore: () => ({ getTimeLog: async () => baseLog }),
        createAccessSource: () => externalSource(),
        verifyEntry: async () => { throw new Error('entry lookup must not run'); },
        resolveRecording: async (projectId, candidate) => {
            resolved = true;
            assert.deepEqual([projectId, candidate], ['202', '77']);
            return '77';
        },
        performAuthorized: async (_body, context) => {
            recordingId = context.recordingId;
            return Response.json({ success: true });
        },
    });

    const response = await post(request({ action: 'sync', timeLogId: 'log-a' }));

    assert.equal(response.status, 200);
    assert.equal(resolved, true);
    assert.equal(recordingId, '77');
});

test('a lost create response is adopted on retry instead of duplicating the provider entry', async () => {
    const { selectAdoptableTimesheetEntry } = await loadRouteModule();

    const adopted = selectAdoptableTimesheetEntry(
        [
            { id: 41, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: { id: 77, type: 'Todo' } },
            { id: 42, date: '2026-08-20', hours: '2.0', description: 'Client work', parent: { id: 77, type: 'Todo' } },
        ],
        { recordingId: '77', date: '2026-08-20', hours: 1, description: 'Client work' },
        [],
    );

    assert.equal(adopted, '41');
});

test('adoption never steals a provider entry that another local time log already claims', async () => {
    const { selectAdoptableTimesheetEntry } = await loadRouteModule();

    const adopted = selectAdoptableTimesheetEntry(
        [{ id: 41, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: { id: 77, type: 'Todo' } }],
        { recordingId: '77', date: '2026-08-20', hours: 1, description: 'Client work' },
        ['41'],
    );

    assert.equal(adopted, null);
});

test('adoption refuses entries outside the authorized recording or with different tracked work', async () => {
    const { selectAdoptableTimesheetEntry } = await loadRouteModule();
    const target = { recordingId: '77', date: '2026-08-20', hours: 1, description: 'Client work' };

    for (const candidate of [
        { id: 41, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: { id: 88, type: 'Todo' } },
        { id: 42, date: '2026-08-21', hours: '1.0', description: 'Client work', parent: { id: 77, type: 'Todo' } },
        { id: 43, date: '2026-08-20', hours: '1.5', description: 'Client work', parent: { id: 77, type: 'Todo' } },
        { id: 44, date: '2026-08-20', hours: '1.0', description: 'Different work', parent: { id: 77, type: 'Todo' } },
        { id: 45, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: null },
    ]) {
        assert.equal(selectAdoptableTimesheetEntry([candidate], target, []), null);
    }
});

test('adoption matches an empty provider description against an empty local description', async () => {
    const { selectAdoptableTimesheetEntry } = await loadRouteModule();

    const adopted = selectAdoptableTimesheetEntry(
        [{ id: 41, date: '2026-08-20', hours: '0.25', description: '', parent: { id: 66, type: 'Timesheet' } }],
        { recordingId: '66', date: '2026-08-20', hours: 0.25, description: null },
        [],
    );

    assert.equal(adopted, '41');
});

test('repeated lost responses adopt the oldest unclaimed duplicate rather than creating another', async () => {
    const { selectAdoptableTimesheetEntry } = await loadRouteModule();

    const adopted = selectAdoptableTimesheetEntry(
        [
            { id: 52, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: { id: 77, type: 'Todo' } },
            { id: 41, date: '2026-08-20', hours: '1.0', description: 'Client work', parent: { id: 77, type: 'Todo' } },
        ],
        { recordingId: '77', date: '2026-08-20', hours: 1, description: 'Client work' },
        ['52'],
    );

    assert.equal(adopted, '41');
});
