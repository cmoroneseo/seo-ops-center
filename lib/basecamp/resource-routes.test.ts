import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./resource-routes.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./resource-routes.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp resource handlers must be implemented: ${String(error)}`);
    }
}

function request(path: 'todolists' | 'todos', params: Record<string, string> = {}) {
    const url = new URL(`https://seo-ops.test/api/integrations/basecamp/${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return new Request(url);
}

async function body(response: Response) {
    return await response.json() as Record<string, unknown>;
}

const externalSource = (allowedProjectIds: Array<string | number> = ['202']) => ({
    findMembership: async () => ({ organizationIsInternal: false }),
    listConfiguredProjectIds: async () => allowedProjectIds,
});

test('todolists GET rejects unauthenticated direct calls before authorization and provider access', async () => {
    const { createBasecampTodolistsGet } = await loadRouteModule();
    const get = createBasecampTodolistsGet({
        getUserId: async () => null,
        createAccessSource: () => { throw new Error('authorization source must not be constructed'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listTodolists: async () => { throw new Error('provider must not be called'); },
    });

    const response = await get(request('todolists', {
        organizationId: 'org-customer',
        projectId: '202',
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(await body(response), { error: 'Unauthorized' });
});

test('todolists GET rejects missing organization context before provider access', async () => {
    const { createBasecampTodolistsGet } = await loadRouteModule();
    const get = createBasecampTodolistsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => { throw new Error('authorization source must not be constructed'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listTodolists: async () => { throw new Error('provider must not be called'); },
    });

    const response = await get(request('todolists', { projectId: '202' }));

    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { error: 'organizationId required' });
});

test('todolists GET rejects nonmembers and unauthorized project IDs without contacting Basecamp', async () => {
    const { createBasecampTodolistsGet } = await loadRouteModule();
    for (const source of [
        {
            findMembership: async () => null,
            listConfiguredProjectIds: async () => { throw new Error('allowlist must not run'); },
        },
        externalSource(['202']),
    ]) {
        const get = createBasecampTodolistsGet({
            getUserId: async () => 'user-outsider',
            createAccessSource: () => source,
            isConfigured: () => { throw new Error('provider configuration must not be read'); },
            listTodolists: async () => { throw new Error('provider must not be called'); },
        });

        const response = await get(request('todolists', {
            organizationId: 'org-customer',
            projectId: '999',
        }));

        assert.equal(response.status, 403);
    }
});

test('todolists GET returns lists only for a server-authorized project', async () => {
    const { createBasecampTodolistsGet } = await loadRouteModule();
    const lists = [{ id: 44, title: 'SEO', name: 'SEO', todos_count: 2 }];
    const get = createBasecampTodolistsGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        listTodolists: async projectId => {
            assert.equal(projectId, '202');
            return lists;
        },
    });

    const response = await get(request('todolists', {
        organizationId: 'org-customer',
        projectId: '202',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { todolists: lists });
});

test('todos GET rejects cross-organization projects before listing lists or todos', async () => {
    const { createBasecampTodosGet } = await loadRouteModule();
    const get = createBasecampTodosGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listTodolists: async () => { throw new Error('lists must not be fetched'); },
        listTodos: async () => { throw new Error('todos must not be fetched'); },
    });

    const response = await get(request('todos', {
        organizationId: 'org-customer',
        projectId: '999',
        todolistId: '44',
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'Project is not authorized' });
});

test('todos GET verifies the list belongs to the authorized project before returning tasks', async () => {
    const { createBasecampTodosGet } = await loadRouteModule();
    const get = createBasecampTodosGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        listTodolists: async () => [{ id: 44, title: 'SEO', name: 'SEO', todos_count: 2 }],
        listTodos: async () => { throw new Error('todos must not be fetched for a mismatched list'); },
    });

    const response = await get(request('todos', {
        organizationId: 'org-customer',
        projectId: '202',
        todolistId: '55',
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'Todolist is not authorized' });
});

test('todos GET returns tasks after both project and list authorization', async () => {
    const { createBasecampTodosGet } = await loadRouteModule();
    const todos = [{
        id: 77,
        title: 'Authorized task',
        due_on: null,
        completed: false,
        description: '',
        assignees: [],
        app_url: 'https://3.basecamp.test/task/77',
    }];
    const get = createBasecampTodosGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        listTodolists: async () => [{ id: 44, title: 'SEO', name: 'SEO', todos_count: 1 }],
        listTodos: async (projectId, todolistId, includeCompleted) => {
            assert.deepEqual([projectId, todolistId, includeCompleted], ['202', '44', true]);
            return todos;
        },
    });

    const response = await get(request('todos', {
        organizationId: 'org-customer',
        projectId: '202',
        todolistId: '44',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { todos });
});

test('timesheet GET rejects cross-organization projects before provider discovery', async () => {
    const { createBasecampTimesheetGet } = await loadRouteModule();
    const get = createBasecampTimesheetGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        listTodolists: async () => [],
        getTimesheetEnabled: async () => { throw new Error('provider must not be called'); },
        findTimesheetRecordingId: async () => { throw new Error('provider must not be called'); },
    });

    const response = await get(request('todolists', {
        organizationId: 'org-customer',
        projectId: '999',
    }));

    assert.equal(response.status, 403);
});

test('timesheet GET rejects unauthenticated users and nonmembers before provider discovery', async () => {
    const { createBasecampTimesheetGet } = await loadRouteModule();
    for (const scenario of [
        { userId: null, source: () => { throw new Error('source must not be created'); }, status: 401 },
        {
            userId: 'outsider',
            source: () => ({
                findMembership: async () => null,
                listConfiguredProjectIds: async () => { throw new Error('allowlist must not run'); },
            }),
            status: 403,
        },
    ]) {
        const get = createBasecampTimesheetGet({
            getUserId: async () => scenario.userId,
            createAccessSource: scenario.source,
            isConfigured: () => { throw new Error('provider configuration must not be read'); },
            listTodolists: async () => [],
            getTimesheetEnabled: async () => { throw new Error('provider must not be called'); },
            findTimesheetRecordingId: async () => { throw new Error('provider must not be called'); },
        });

        const response = await get(request('todolists', {
            organizationId: 'org-customer',
            projectId: '202',
        }));

        assert.equal(response.status, scenario.status);
    }
});

test('timesheet GET discovers availability only for a server-authorized project', async () => {
    const { createBasecampTimesheetGet } = await loadRouteModule();
    const get = createBasecampTimesheetGet({
        getUserId: async () => 'user-1',
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        listTodolists: async () => [],
        getTimesheetEnabled: async projectId => {
            assert.equal(projectId, '202');
            return true;
        },
        findTimesheetRecordingId: async projectId => {
            assert.equal(projectId, '202');
            return 66;
        },
    });

    const response = await get(request('todolists', {
        organizationId: 'org-customer',
        projectId: '202',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await body(response), { timesheetEnabled: true, recordingFound: true });
});
