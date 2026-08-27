import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./import-tasks-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./import-tasks-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp import handler must be implemented: ${String(error)}`);
    }
}

const task = {
    title: 'Imported task',
    basecampTodoId: 77,
    basecampProjectId: 202,
    priority: 'medium' as const,
};

function request(overrides: Record<string, unknown> = {}) {
    return new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: 'client-a',
            organizationId: 'org-a',
            tasks: [task],
            ...overrides,
        }),
    });
}

const authorized = {
    ok: true as const,
    userId: 'user-1',
    actorName: 'User One',
    organizationId: 'org-a',
    clientId: 'client-a',
    role: 'member' as const,
};

const externalSource = (projects: Array<string | number> = ['202']) => ({
    findMembership: async () => ({ organizationIsInternal: false }),
    listConfiguredProjectIds: async () => projects,
});

async function responseBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('import rejects a known foreign client before project, provider, or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Forbidden' });
});

test('import rejects unauthenticated callers before project, provider, or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 401);
    assert.deepEqual(await responseBody(response), { error: 'Unauthorized' });
});

test('import rejects a mismatched caller organization before project or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async (_clientId, assertedOrganizationId) => {
            assert.equal(assertedOrganizationId, 'org-attacker');
            return { ok: false, status: 403, error: 'Client does not belong to organization' };
        },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => false,
        getTodo: async () => null,
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ organizationId: 'org-attacker' }));

    assert.equal(response.status, 403);
});

test('import rejects an unauthorized Basecamp project before provider and writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(['303']),
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Project is not authorized' });
});

test('import rejects todo IDs that do not belong to the authorized project before creating the writer', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async (projectId, todoId) => {
            assert.deepEqual([projectId, todoId], ['202', '77']);
            return null;
        },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Basecamp todo is not authorized' });
});

test('authorized import writes the canonical client organization after provider provenance checks', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    let insertedRows: Array<Record<string, unknown>> = [];
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => ({
            id: 77,
            title: 'Canonical provider title',
            due_on: '2026-08-29',
            completed: false,
            description: 'Canonical provider description',
            assignees: [],
            app_url: 'https://3.basecamp.test/task/77',
        }),
        createWriter: () => ({
            insertTasks: async rows => { insertedRows = rows; return null; },
            logActivity: async () => {},
        }),
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 1, errors: [] });
    assert.equal(insertedRows.length, 1);
    assert.equal(insertedRows[0].organization_id, 'org-a');
    assert.equal(insertedRows[0].client_id, 'client-a');
    assert.equal(insertedRows[0].basecamp_project_id, 202);
    assert.equal(insertedRows[0].basecamp_todo_id, 77);
    assert.equal(insertedRows[0].title, 'Canonical provider title');
    assert.equal(insertedRows[0].description, 'Canonical provider description');
    assert.equal(insertedRows[0].due_date, '2026-08-29');
    assert.equal(insertedRows[0].priority, 'medium');
});

// ---------------------------------------------------------------------------
// `buildBasecampTaskRows` is shared by the bulk import screen and the
// timesheet picker's import-and-link. Mirroring completion and carrying
// assignees are OPTIONS on the builder, defaulting off — but BOTH callers now
// opt in. A to-do finished in Basecamp that arrives here outstanding shows as
// open work, skews task counts, and never reaches the client's feed as
// completed at all.
// ---------------------------------------------------------------------------

const completedProviderTodo = {
    id: 77,
    title: 'XERF landing page',
    description: 'Revisions',
    due_on: null,
    completed: true,
    completion: { created_at: '2026-08-14T17:20:00.000Z' },
    assignees: [{ id: 5001 }],
};

test('the builder leaves completion alone unless asked', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => completedProviderTodo,
        now: '2026-08-26T00:00:00.000Z',
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    const row = built.rows[0];
    assert.equal(row.status, 'todo');
    assert.equal(row.completed_at, null);
    assert.deepEqual(row.assignee_ids, []);
    assert.deepEqual(row.status_history, [
        { status: 'todo', at: '2026-08-26T00:00:00.000Z', by: 'user-1' },
    ]);
});

test('opting in mirrors completion and maps assignees back to org members', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => completedProviderTodo,
        now: '2026-08-26T00:00:00.000Z',
        options: {
            mirrorCompletion: true,
            resolveAssignees: async personIds => {
                assert.deepEqual(personIds, [5001]);
                return new Map([[5001, 'user-abel']]);
            },
        },
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    const row = built.rows[0];
    assert.equal(row.status, 'done');
    assert.equal(row.completed_at, '2026-08-14T17:20:00.000Z');
    assert.deepEqual(row.assignee_ids, ['user-abel']);
});

test('a completed to-do with no completion date falls back to the import moment', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => ({ ...completedProviderTodo, completion: null }),
        now: '2026-08-26T00:00:00.000Z',
        options: { mirrorCompletion: true },
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.rows[0].completed_at, '2026-08-26T00:00:00.000Z');
});

test('the row builder refuses a to-do the provider does not confirm', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => ({ ...completedProviderTodo, title: '   ' }),
        now: '2026-08-26T00:00:00.000Z',
    });

    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.status, 403);
});

/**
 * The bulk import screen's own wiring, not the builder's defaults.
 *
 * Its to-dos used to land as `todo` with `completed_at` null however finished
 * they were in Basecamp, so a backfilled project arrived looking entirely
 * outstanding and the client's feed showed one "tasks imported" line for the
 * lot of it.
 */
test('the bulk importer mirrors completion and announces it on the day it happened', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    let insertedRows: Array<Record<string, unknown>> = [];
    const completions: unknown[] = [];
    const assigneeLookups: Array<{ organizationId: string; personIds: number[] }> = [];

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => completedProviderTodo as never,
        resolveAssignees: async (organizationId, personIds) => {
            assigneeLookups.push({ organizationId, personIds });
            return new Map([[5001, 'user-abel']]);
        },
        createWriter: () => ({
            insertTasks: async rows => { insertedRows = rows; return null; },
            logActivity: async () => {},
            logCompletions: async payload => { completions.push(...payload.completions); },
        }),
        now: () => '2026-08-26T00:00:00.000Z',
    });

    const response = await post(new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            organizationId: 'org-a',
            clientId: 'client-a',
            tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        }),
    }));

    assert.equal(response.status, 200);
    // The SERVER-derived organization, never the request body's.
    assert.deepEqual(assigneeLookups, [{ organizationId: 'org-a', personIds: [5001] }]);
    assert.equal(insertedRows[0].status, 'done');
    assert.equal(insertedRows[0].completed_at, '2026-08-14T17:20:00.000Z');
    assert.deepEqual(insertedRows[0].assignee_ids, ['user-abel']);
    assert.deepEqual(completions, [
        { title: 'XERF landing page', completedAt: '2026-08-14T17:20:00.000Z' },
    ]);
});

test('a chunk that failed to insert announces no completions', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const completions: unknown[] = [];

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => completedProviderTodo as never,
        resolveAssignees: async () => new Map([[5001, 'user-abel']]),
        createWriter: () => ({
            insertTasks: async () => 'insert failed',
            logActivity: async () => {},
            logCompletions: async payload => { completions.push(...payload.completions); },
        }),
        now: () => '2026-08-26T00:00:00.000Z',
    });

    const response = await post(new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            organizationId: 'org-a',
            clientId: 'client-a',
            tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        }),
    }));

    // Asserted so this cannot pass vacuously: a 500 would also record no
    // completions, and would say nothing about the insert-failure path.
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 0, errors: ['insert failed'] });

    // Announcing work that was never imported would put a completion in the
    // client's feed for a task that does not exist.
    assert.deepEqual(completions, []);
});
