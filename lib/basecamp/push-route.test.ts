import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botCreatedTaskRow } from '../bots/task-create.ts';
import { basecampTodoCreateBody } from './api.ts';
import { normalizeBasecampTodoStep } from './todo-steps.ts';

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

test('Basecamp to-do creation forwards the description stored by bot create', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const row = botCreatedTaskRow({
        organizationId: canonicalTask.organizationId,
        clientId: canonicalTask.clientId,
        title: 'Audit landing pages',
        description: 'Review redirects.\nRecord links that need an update.',
        actorUserId: authorized.userId,
        botKeyId: 'seo-bot',
        botOperationId: null,
        now: '2026-08-20T00:00:00.000Z',
    });
    const task = {
        ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo',
        title: String(row.title), description: typeof row.description === 'string' ? row.description : '',
        dueDate: null, assigneePersonIds: [], completionSubscriberPersonIds: [],
    };
    let payload: unknown;
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
            listTodolists: async () => [{ id: 44 }],
            createTodo: async (_projectId, _todolistId, params) => {
                payload = basecampTodoCreateBody(params);
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

    const response = await post(request({ action: 'create_todo', taskId: task.id }));
    assert.equal(response.status, 200);
    assert.deepEqual(payload, {
        content: 'Audit landing pages',
        description: 'Review redirects.\nRecord links that need an update.',
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
    let completed: [string, string] | null = null;
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
            listSteps: async () => [],
            createStep: async (_projectId, parentId, title) => {
                assert.equal(parentId, '77');
                createdSteps.push(title);
                return { id: 102 };
            },
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

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));

    assert.equal(response.status, 200);
    assert.deepEqual(createdSteps, ['Retry this step']);
    assert.equal((await response.json()).subtasksPreserved, 1);
    assert.deepEqual(completed, ['202', '77']);
});

async function pushExistingTodo(input: {
    titles: string[];
    steps?: Array<{ id: number; title: string; parent?: { id: number } }>;
    claimed?: string[];
    stepReadFails?: boolean;
    linkConflictId?: string;
}) {
    const { createBasecampPushPost } = await loadRouteModule();
    const createdSteps: string[] = [];
    const linked: Array<[string, string]> = [];
    const completedSteps: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, status: 'todo' }),
            listSubtasks: async () => input.titles.map((title, index) => ({
                id: `child-${index + 1}`, title, status: 'done', basecampTodoId: null,
            })),
            listLinkedStepIds: async (projectId: string, stepIds: string[]) => {
                assert.equal(projectId, '202');
                return (input.claimed ?? []).filter(id => stepIds.includes(id));
            },
            updateTaskLink: async (taskId, orgId, clientId, projectId, stepId) => {
                assert.deepEqual([orgId, clientId, projectId], ['org-a', 'client-a', '202']);
                if (stepId === input.linkConflictId) {
                    return {
                        code: '23505',
                        message: 'duplicate key value violates unique constraint "tasks_basecamp_recording_unique"',
                    };
                }
                linked.push([taskId, stepId]);
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async (_projectId, todoId) => ({ id: todoId }),
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => { throw new Error('must reuse the linked to-do'); },
            listSteps: async (projectId: string, todoId: string) => {
                assert.deepEqual([projectId, todoId], ['202', '77']);
                if (input.stepReadFails) throw new Error('Basecamp unavailable');
                return (input.steps ?? []).map(step => normalizeBasecampTodoStep(step)!);
            },
            createStep: async (projectId, todoId, title) => {
                assert.deepEqual([projectId, todoId], ['202', '77']);
                createdSteps.push(title);
                return { id: 100 + createdSteps.length };
            },
            completeTodo: async () => false,
            completeStep: async (_projectId, stepId) => {
                completedSteps.push(stepId);
                return true;
            },
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    return { status: response.status, body: await responseBody(response), createdSteps, linked, completedSteps };
}

test('push links exact and case-insensitive trimmed titles without changing existing steps', async () => {
    const result = await pushExistingTodo({
        titles: ['Connect Analytics', '  QA the Page  '],
        steps: [{ id: 81, title: 'Connect Analytics' }, { id: 82, title: 'qa the page' }],
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.createdSteps, []);
    assert.deepEqual(result.linked, [['child-1', '81'], ['child-2', '82']]);
    assert.deepEqual(result.completedSteps, []);
});

test('push creates a step when the title only matches under a different to-do', async () => {
    const result = await pushExistingTodo({
        titles: ['Connect Analytics'],
        steps: [{ id: 81, title: 'Connect Analytics', parent: { id: 78 } }],
    });

    assert.equal(result.status, 200);
    assert.deepEqual(result.createdSteps, ['Connect Analytics']);
    assert.deepEqual(result.linked, [['child-1', '101']]);
    assert.deepEqual(result.completedSteps, ['101']);
});

test('push skips titles shared by multiple Basecamp steps or multiple unlinked subtasks', async () => {
    const result = await pushExistingTodo({
        titles: ['Brief', 'Draft', ' draft '],
        steps: [{ id: 81, title: 'Brief' }, { id: 82, title: 'BRIEF' }, { id: 83, title: 'Draft' }],
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.subtasksSkipped, 3);
    assert.match(String(result.body.reason), /ambiguous/i);
    assert.deepEqual(result.createdSteps, []);
    assert.deepEqual(result.linked, []);
});

test('push links, creates, and skips claimed matches in the same batch', async () => {
    const result = await pushExistingTodo({
        titles: ['Connect Analytics', 'Connect Search Console', 'QA'],
        steps: [{ id: 81, title: 'Connect Analytics' }, { id: 82, title: 'QA' }],
        claimed: ['82'],
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.subtasksSkipped, 1);
    assert.match(String(result.body.reason), /already linked/i);
    assert.deepEqual(result.createdSteps, ['Connect Search Console']);
    assert.deepEqual(result.linked, [['child-1', '81'], ['child-2', '101']]);
    assert.deepEqual(result.completedSteps, ['101']);
});

test('push fails without creating steps when the Basecamp step read fails', async () => {
    const result = await pushExistingTodo({ titles: ['Brief'], stepReadFails: true });

    assert.equal(result.status, 502);
    assert.deepEqual(result.body, {
        success: false, partial: true, todoId: '77', error: 'Basecamp subtasks could not be read',
    });
    assert.deepEqual(result.createdSteps, []);
    assert.deepEqual(result.linked, []);
});

test('push skips a step claimed during the link write and continues with other subtasks', async () => {
    const result = await pushExistingTodo({
        titles: ['Brief', 'Draft'],
        steps: [{ id: 81, title: 'Brief' }],
        linkConflictId: '81',
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.subtasksSkipped, 1);
    assert.match(String(result.body.reason), /already linked/i);
    assert.deepEqual(result.createdSteps, ['Draft']);
    assert.deepEqual(result.linked, [['child-2', '101']]);
    assert.deepEqual(result.completedSteps, ['101']);
});

test('push leaves a newly created step alone if another task claims it before the link write', async () => {
    const result = await pushExistingTodo({ titles: ['Brief'], linkConflictId: '101' });

    assert.equal(result.status, 200);
    assert.equal(result.body.subtasksSkipped, 1);
    assert.match(String(result.body.reason), /already linked/i);
    assert.deepEqual(result.createdSteps, ['Brief']);
    assert.deepEqual(result.linked, []);
    assert.deepEqual(result.completedSteps, []);
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

test('completing and reopening a stored step uses the step endpoint, not the to-do endpoint', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const calls: string[] = [];
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
            getTodo: async () => { throw new Error('a step id must not be read as a to-do'); },
            listTodolists: async () => [],
            createTodo: async () => null,
            recordingKind: async () => 'step',
            completeTodo: async () => { throw new Error('step completion must not use the to-do endpoint'); },
            reopenTodo: async () => { throw new Error('step reopening must not use the to-do endpoint'); },
            completeStep: async (projectId, stepId) => {
                calls.push(`complete:${projectId}:${stepId}`);
                return true;
            },
            reopenStep: async (projectId, stepId) => {
                calls.push(`reopen:${projectId}:${stepId}`);
                return true;
            },
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const completed = await post(request({ action: 'complete_todo', taskId: 'task-a', todoId: '888' }));
    const reopened = await post(request({ action: 'reopen_todo', taskId: 'task-a', todoId: '888' }));

    assert.equal(completed.status, 200);
    assert.equal(reopened.status, 200);
    assert.deepEqual(await completed.json(), { success: true });
    assert.deepEqual(await reopened.json(), { success: true });
    assert.deepEqual(calls, ['complete:202:77', 'reopen:202:77']);
});

test('completing and reopening a stored to-do still uses the to-do endpoint', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const calls: string[] = [];
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
            getTodo: async () => { throw new Error('completion classifies the recording before any to-do read'); },
            listTodolists: async () => [],
            createTodo: async () => null,
            recordingKind: async () => 'todo',
            completeTodo: async (projectId, todoId) => {
                calls.push(`complete:${projectId}:${todoId}`);
                return true;
            },
            reopenTodo: async (projectId, todoId) => {
                calls.push(`reopen:${projectId}:${todoId}`);
                return true;
            },
            completeStep: async () => { throw new Error('a to-do must not use the step endpoint'); },
            reopenStep: async () => { throw new Error('a to-do must not use the step endpoint'); },
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const completed = await post(request({ action: 'complete_todo', taskId: 'task-a' }));
    const reopened = await post(request({ action: 'reopen_todo', taskId: 'task-a' }));

    assert.equal(completed.status, 200);
    assert.equal(reopened.status, 200);
    assert.deepEqual(calls, ['complete:202:77', 'reopen:202:77']);
});

test('create push leaves an already-linked step in place and completes it when the task is done', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const calls: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => canonicalTask,
            listSubtasks: async () => { throw new Error('a step has no child to-dos to create'); },
            updateTaskLink: async () => { throw new Error('the step link is already stored'); },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => { throw new Error('a step id must not be read as a to-do'); },
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => { throw new Error('must not create a to-do for a step'); },
            recordingKind: async () => 'step',
            completeTodo: async () => { throw new Error('a done step must not be completed as a to-do'); },
            reopenTodo: async () => false,
            completeStep: async (projectId, stepId) => {
                calls.push(`complete:${projectId}:${stepId}`);
                return true;
            },
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, todoId: '77' });
    assert.deepEqual(calls, ['complete:202:77']);
});

test('creating a to-do for a task that is already done also completes that to-do', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const calls: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'done' }),
            listSubtasks: async () => [
                { id: 'child-1', title: 'Brief', status: 'done', basecampTodoId: null },
                { id: 'child-2', title: 'Draft', status: 'todo', basecampTodoId: null },
            ],
            updateTaskLink: async (taskId, _organizationId, _clientId, _projectId, recordingId) => {
                calls.push(`link:${taskId}:${recordingId}`);
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
            createStep: async (_projectId, _parentId, title) => ({ id: title === 'Brief' ? 200 : 201 }),
            completeTodo: async (projectId, todoId) => {
                calls.push(`complete-todo:${projectId}:${todoId}`);
                return true;
            },
            reopenTodo: async () => false,
            completeStep: async (projectId, stepId) => {
                calls.push(`complete-step:${projectId}:${stepId}`);
                return true;
            },
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, todoId: 77 });
    assert.deepEqual(calls, [
        'link:task-a:77',
        'link:child-1:200',
        'link:child-2:201',
        'complete-step:202:200',
        'complete-todo:202:77',
    ]);
});

test('creating a to-do for an open task does not complete it', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    let completed = false;
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' }),
            listSubtasks: async () => [],
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => ({ id: 77, appUrl: 'https://3.basecamp.test/task/77' }),
            completeTodo: async () => { completed = true; return true; },
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 200);
    assert.equal(completed, false);
});

test('creating a to-do moves project-timesheet time onto that to-do after the link is saved', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const calls: string[] = [];
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => ({ ...canonicalTask, basecampTodoId: null, basecampProjectId: null, status: 'todo' }),
            updateTaskLink: async (_taskId, _organizationId, _clientId, _projectId, recordingId) => {
                calls.push(`link:${recordingId}`);
                return null;
            },
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        rehomeProjectTime: async (moved) => {
            calls.push(`rehome:${moved.taskId}:${moved.todoId}`);
            return { failed: 0 };
        },
        provider: {
            isConfigured: () => true,
            getTodo: async () => null,
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => ({ id: 77, appUrl: 'https://3.basecamp.test/task/77' }),
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
    assert.deepEqual(calls, ['link:77', 'rehome:task-a:77']);
});

test('a project-timesheet move that fails keeps the to-do and asks for another send', async () => {
    const { createBasecampPushPost } = await loadRouteModule();
    const post = createBasecampPushPost({
        authorizeTask: async () => authorized,
        createStore: () => ({
            getTask: async () => canonicalTask,
            updateTaskLink: async () => null,
            markTaskSynced: async () => null,
        }),
        createAccessSource: () => externalSource(),
        rehomeProjectTime: async () => ({ failed: 1 }),
        provider: {
            isConfigured: () => true,
            getTodo: async (_projectId, todoId) => ({ id: todoId }),
            listTodolists: async () => [{ id: 44 }],
            createTodo: async () => { throw new Error('must reuse the linked to-do'); },
            completeTodo: async () => true,
            reopenTodo: async () => false,
            createComment: async () => null,
            updateTodoDueDate: async () => false,
            updateTodoAssignees: async () => false,
        },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ action: 'create_todo', taskId: 'task-a' }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
        success: false,
        partial: true,
        todoId: '77',
        error: 'Basecamp time could not be moved onto the to-do',
    });
});
