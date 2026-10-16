import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./push-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./push-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp push handler must be implemented: ${String(error)}`);
    }
}

function request(body: Record<string, unknown>) {
    return new Request('https://seo-ops.test/api/integrations/basecamp/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const authorized = {
    ok: true as const,
    userId: 'manager-1',
    actorName: 'Manager One',
    organizationId: 'org-a',
    clientId: 'client-a',
    taskId: 'task-a',
    role: 'admin' as const,
    canManageIntegrations: true,
};

const canonicalTask = {
    id: 'task-a',
    organizationId: 'org-a',
    clientId: 'client-a',
    title: 'Canonical title',
    description: 'Canonical description',
    dueDate: '2026-08-31',
    status: 'done',
    basecampTodoId: '77',
    basecampProjectId: '202',
    configuredProjectId: '202',
    configuredTodolistId: '44',
    syncEnabled: true,
    assigneePersonIds: [9],
    completionSubscriberPersonIds: [12],
};

const externalSource = () => ({
    findMembership: async () => ({ organizationIsInternal: false }),
    listConfiguredProjectIds: async () => ['202'],
});

async function responseBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('push rejects unauthenticated and cross-client task selectors before admin or provider access', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    for (const denial of [
        { ok: false as const, status: 401, error: 'Unauthorized' },
        { ok: false as const, status: 403, error: 'Forbidden' },
    ]) {
        const post = createBasecampPushPost({
            authorizeTask: async () => denial,
            createStore: () => { throw new Error('admin store must not be created'); },
            createAccessSource: () => { throw new Error('access source must not be created'); },
            provider: {
                isConfigured: () => { throw new Error('provider must not be reached'); },
                getTodo: async () => { throw new Error('provider must not be reached'); },
                listTodolists: async () => { throw new Error('provider must not be reached'); },
                createTodo: async () => { throw new Error('provider must not be reached'); },
                completeTodo: async () => { throw new Error('provider must not be reached'); },
                reopenTodo: async () => { throw new Error('provider must not be reached'); },
                createComment: async () => { throw new Error('provider must not be reached'); },
                updateTodoDueDate: async () => { throw new Error('provider must not be reached'); },
                updateTodoAssignees: async () => { throw new Error('provider must not be reached'); },
            },
            now: () => '2026-08-20T00:00:00.000Z',
        });

        const response = await post(request({
            action: 'complete_todo',
            taskId: 'task-victim',
            projectId: '999',
            todoId: '888',
        }));

        assert.equal(response.status, denial.status);
    }
});

test('push ignores caller provider IDs and completes the canonical task recording', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    let completed: [string, string] | null = null;
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => canonicalTask,
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => ({ id: 77 }),
            listTodolists: async () => [],
            createTodo: async () => null,
            completeTodo: async (projectId, todoId) => {
                completed = [projectId, todoId];
                return true;
            },
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({
        action: 'complete_todo',
        taskId: 'task-a',
        projectId: '999',
        todoId: '888',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(completed, ['202', '77']);
});

test('push rejects a stored task link that no longer matches the canonical client project', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampProjectId: '303' }),
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        provider: {
            isConfigured: () => { throw new Error('provider must not be reached'); },
            getTodo: async () => { throw new Error('provider must not be reached'); },
            listTodolists: async () => [],
            createTodo: async () => null,
            completeTodo: async () => { throw new Error('provider must not be reached'); },
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'complete_todo', taskId: 'task-a' }));

    assert.equal(response.status, 409);
    assert.deepEqual(await responseBody(response), { error: 'Task Basecamp link does not match its client configuration' });
});

test('push verifies the canonical todo belongs to the canonical project before mutation', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => canonicalTask,
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [],
            createTodo: async () => null,
            completeTodo: async () => { throw new Error('mutation must not run'); },
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'complete_todo', taskId: 'task-a' }));

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Basecamp todo is not authorized' });
});

test('create push ignores a caller todolist override and uses only the protected configured list', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const task = { ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' };
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => task,
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async projectId => {
                assert.equal(projectId, '202');
                return [{ id: 44 }];
            },
            createTodo: async (projectId, todolistId) => {
                assert.deepEqual([projectId, todolistId], ['202', '44']);
                return { id: 77, appUrl: 'https://3.basecamp.test/task/77' };
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({
        action: 'create_todo',
        taskId: 'task-a',
        projectId: '999',
        todolistId: '55',
        content: 'Attacker title',
    }));

    assert.equal(response.status, 200);
});

test('create push uses canonical project and task content after verified list selection', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const task = { ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' };
    let created: { projectId: string; todolistId: string; params: Record<string, unknown> } | null = null;
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => task,
            updateTaskLink: async (_taskId, _organizationId, _clientId, projectId, todoId) => {
                assert.deepEqual([projectId, todoId], ['202', '77']);
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async (projectId, todolistId, params) => {
                created = { projectId, todolistId, params };
                return { id: 77, appUrl: 'https://3.basecamp.test/task/77' };
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({
        action: 'create_todo',
        taskId: 'task-a',
        projectId: '999',
        todolistId: '44',
        content: 'Attacker title',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(created, {
        projectId: '202',
        todolistId: '44',
        params: {
            content: 'Canonical title',
            description: 'Canonical description',
            dueOn: '2026-08-31',
            assigneePersonIds: [9],
            completionSubscriberPersonIds: [12],
        },
    });
});

test('create push maps canonical SEO PM subtasks to Basecamp steps after creating the parent', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const task = { ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' };
    const createdSteps: Array<{ parentId: string; title: string }> = [];
    const linked: Array<{ taskId: string; recordingId: string }> = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => task,
            listSubtasks: async () => [
                { id: 'child-1', title: 'Draft metadata', basecampTodoId: null },
                { id: 'child-2', title: 'QA the page', basecampTodoId: null },
            ],
            updateTaskLink: async (taskId, _organizationId, _clientId, _projectId, recordingId) => {
                linked.push({ taskId, recordingId });
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => ({ id: 77, appUrl: 'https://3.basecamp.test/task/77' }),
            createStep: async (_projectId, parentId, title) => {
                createdSteps.push({ parentId, title });
                return { id: 100 + createdSteps.length };
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));

    assert.equal(response.status, 200);
    assert.deepEqual(createdSteps, [
        { parentId: '77', title: 'Draft metadata' },
        { parentId: '77', title: 'QA the page' },
    ]);
    assert.deepEqual(linked, [
        { taskId: 'task-a', recordingId: '77' },
        { taskId: 'child-1', recordingId: '101' },
        { taskId: 'child-2', recordingId: '102' },
    ]);
});

test('retrying a partial create reuses the linked parent and skips already-linked steps', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const createdSteps: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => canonicalTask,
            listSubtasks: async () => [
                { id: 'child-1', title: 'Already synced', basecampTodoId: '101' },
                { id: 'child-2', title: 'Retry this step', basecampTodoId: null },
            ],
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async (_projectId, todoId) => ({ id: todoId }),
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => { throw new Error('must not duplicate the linked parent'); },
            createStep: async (_projectId, parentId, title) => {
                assert.equal(parentId, '77');
                createdSteps.push(title);
                return { id: 102 };
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));

    assert.equal(response.status, 200);
    assert.deepEqual(createdSteps, ['Retry this step']);
    assert.equal((await response.json()).subtasksPreserved, 1);
});

test('create push keeps imported Basecamp ids when nesting existing tasks', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const linked: string[] = [];
    let createdSteps = 0;
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' }),
            listSubtasks: async () => [
                { id: 'child-1', title: 'Connect Search Console', basecampTodoId: '9001' },
                { id: 'child-2', title: 'Connect Analytics', basecampTodoId: 9002 },
            ],
            updateTaskLink: async (taskId) => {
                linked.push(taskId);
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => ({ id: 77, appUrl: 'https://3.basecamp.test/task/77', supportsSubtasks: true }),
            createStep: async () => {
                createdSteps += 1;
                return { id: 500 };
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, todoId: 77, subtasksPreserved: 2 });
    assert.equal(createdSteps, 0);
    assert.deepEqual(linked, ['task-a']);
});

test('create push does not recreate steps that were imported from Basecamp', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const createdSteps: string[] = [];
    const linked: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({
                ...canonicalTask,
                title: 'Website FAQs',
                status: 'todo',
                basecampTodoId: 10211418597,
                basecampProjectId: 47747763,
                configuredProjectId: 47747763,
            }),
            listSubtasks: async () => [
                { id: 'child-publish', title: 'Publish on website', basecampTodoId: 10211449969 },
                { id: 'child-approval', title: 'Send for approval', basecampTodoId: 10211450455 },
            ],
            updateTaskLink: async (taskId) => {
                linked.push(taskId);
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => ({
            findMembership: async () => ({ organizationIsInternal: false }),
            listConfiguredProjectIds: async () => ['47747763'],
        }),
        provider: {
            isConfigured: () => true,
            getTodo: async (_projectId, todoId) => ({ id: todoId, supportsSubtasks: true }),
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => { throw new Error('must not create a second to-do'); },
            createStep: async (_projectId, _parentId, title) => {
                createdSteps.push(title);
                throw new Error('must not recreate an imported step');
            },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-10-16T21:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), {
        success: true,
        todoId: '10211418597',
        subtasksPreserved: 2,
    });
    assert.deepEqual(createdSteps, []);
    assert.deepEqual(linked, []);
});

test('create push keeps the parent when the to-do does not accept nested subtasks', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    let stepped = false;
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' }),
            listSubtasks: async () => [
                { id: 'child-1', title: 'Connect analytics', basecampTodoId: null },
            ],
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => ({ id: 77, appUrl: 'https://3.basecamp.test/task/77', supportsSubtasks: false }),
            createStep: async () => { stepped = true; return { id: 1 }; },
            completeTodo: async () => false,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, todoId: 77, subtasksSkipped: 1 });
    assert.equal(stepped, false);
});
