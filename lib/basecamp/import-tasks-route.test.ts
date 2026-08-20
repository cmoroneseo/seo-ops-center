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
            title: 'Imported task',
            due_on: null,
            completed: false,
            description: '',
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
});
