import assert from 'node:assert/strict';
import test from 'node:test';

import {
    syncPlanTask,
    type PlanProviderResult,
    type PlanPushClient,
    type PlanPushDependencies,
    type PlanPushSnapshot,
    type PlanPushTask,
} from './basecamp-push-run.ts';

const at = '2026-10-20T18:14:00.000Z';

function task(overrides: Partial<PlanPushTask> = {}): PlanPushTask {
    return {
        id: 'task-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        title: 'Blog: home addition cost',
        description: 'Draft the outline',
        dueDate: null,
        status: 'todo',
        stage: 'backlog',
        parentTaskId: null,
        basecampTodoId: null,
        assigneePersonIds: [],
        children: [],
        ...overrides,
    };
}

function client(overrides: Partial<PlanPushClient> = {}): PlanPushClient {
    return {
        id: 'client-1',
        syncEnabled: true,
        projectId: '48599958',
        todolistId: '9001',
        projectName: "Maya's Construction",
        todolistName: 'SEO: October',
        syncState: null,
        syncError: null,
        ...overrides,
    };
}

function harness(snapshot: PlanPushSnapshot | null, providerOverrides: Partial<PlanPushDependencies['provider']> = {}) {
    const calls: string[] = [];
    const recorded: Array<{ id: string; state: string; error: string | null }> = [];
    const clients: Array<{ id: string; state: string }> = [];
    const links: string[] = [];
    const ok = async (): Promise<PlanProviderResult> => ({ ok: true });
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (!snapshot) return null;
                if (id === snapshot.task.id) return snapshot;
                return null;
            },
            async linkTodo(taskId, _projectId, todoId) {
                links.push(`${taskId}:${todoId}`);
                if (snapshot && snapshot.task.id === taskId) snapshot.task.basecampTodoId = todoId;
                const child = snapshot?.task.children.find(item => item.id === taskId);
                if (child) child.basecampTodoId = todoId;
            },
            async recordTask(id, sync) {
                recorded.push({ id, state: sync.state, error: sync.error });
            },
            async recordClient(id, sync) {
                clients.push({ id, state: sync.state });
            },
        },
        provider: {
            async createTodo() {
                calls.push('create');
                return { ok: true, todoId: '77', supportsSubtasks: true };
            },
            async updateTodo() {
                calls.push('update');
                return ok();
            },
            async setAssignees() {
                calls.push('assignees');
                return ok();
            },
            async getTodo() {
                calls.push('get');
                return { ok: true, completed: false };
            },
            async completeTodo() {
                calls.push('complete');
                return ok();
            },
            async reopenTodo() {
                calls.push('reopen');
                return ok();
            },
            async createStep(input) {
                calls.push(`step:${input.title}`);
                return { ok: true, todoId: '88' };
            },
            ...providerOverrides,
        },
    };
    return { dependencies, calls, recorded, clients, links };
}

test('an undated backlog task never calls Basecamp', async () => {
    const { dependencies, calls, recorded } = harness({ task: task(), client: client(), parent: null });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'skipped');
    assert.deepEqual(calls, []);
    assert.deepEqual(recorded, []);
});

test('adding a due date creates one to-do', async () => {
    const { dependencies, calls, links, recorded } = harness({
        task: task({ dueDate: '2026-10-31' }),
        client: client(),
        parent: null,
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, ['create']);
    assert.deepEqual(links, ['task-1:77']);
    assert.equal(recorded[0]?.state, 'ok');
    assert.equal(recorded[0]?.error, null);
});

test('leaving backlog creates a to-do even without a due date', async () => {
    const { dependencies, calls } = harness({
        task: task({ stage: 'onboarding' }),
        client: client(),
        parent: null,
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, ['create']);
});

test('a later change updates the existing to-do and does not create another', async () => {
    const { dependencies, calls } = harness({
        task: task({
            dueDate: '2026-11-02',
            basecampTodoId: '77',
            status: 'done',
            assigneePersonIds: [4],
            children: [{ id: 'child-1', title: 'Sources', basecampTodoId: null }],
        }),
        client: client(),
        parent: null,
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.equal(calls.includes('create'), false);
    assert.deepEqual(calls.slice(0, 3), ['update', 'assignees', 'get']);
    assert.equal(calls.includes('complete'), true);
    assert.equal(calls.includes('step:Sources'), true);
});

test('one failed attempt is stored and not repeated', async () => {
    let creates = 0;
    const { dependencies, recorded, clients } = harness({
        task: task({ dueDate: '2026-10-31' }),
        client: client(),
        parent: null,
    }, {
        async createTodo() {
            creates += 1;
            return {
                ok: false,
                status: 404,
                scope: 'task',
                message: 'Basecamp returned 404: the to-do list "SEO: October" no longer exists in project "Maya\'s Construction".',
            };
        },
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(creates, 1);
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.sync.state, 'failed');
    assert.match(outcome.sync.error ?? '', /SEO: October/);
    assert.equal(outcome.sync.attemptedAt, at);
    assert.equal(outcome.scope, 'task');
    assert.equal(outcome.banner.failure, null);
    assert.equal(recorded.length, 1);
    assert.deepEqual(clients, []);
});

test('a revoked connection is one client-wide failure', async () => {
    const { dependencies, clients } = harness({
        task: task({ dueDate: '2026-10-31', basecampTodoId: '77' }),
        client: client(),
        parent: null,
    }, {
        async updateTodo() {
            return {
                ok: false,
                status: 401,
                scope: 'client',
                message: 'Basecamp returned 401: the connection is no longer authorized.',
            };
        },
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'failed');
    if (outcome.status !== 'failed') return;
    assert.equal(outcome.scope, 'client');
    assert.match(outcome.banner.failure ?? '', /401/);
    assert.deepEqual(clients, [{ id: 'client-1', state: 'failed' }]);
});

test('a client with no Basecamp project does nothing visible', async () => {
    const { dependencies, calls, recorded } = harness({
        task: task({ dueDate: '2026-10-31', stage: 'onboarding' }),
        client: client({ syncEnabled: false, projectId: null }),
        parent: null,
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.deepEqual(outcome, { status: 'skipped', reason: 'no-project' });
    assert.deepEqual(calls, []);
    assert.deepEqual(recorded, []);
});

test('a qualifying child pushes the parent to-do instead of a second to-do', async () => {
    const parent = task({ id: 'parent-1', stage: 'onboarding', title: 'Citations' });
    const child = task({ id: 'child-1', parentTaskId: 'parent-1', dueDate: '2026-10-31', title: 'Houzz' });
    const calls: string[] = [];
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (id === 'child-1') return { task: child, client: client(), parent: { id: parent.id, stage: parent.stage, dueDate: parent.dueDate } };
                if (id === 'parent-1') return { task: parent, client: client(), parent: null };
                return null;
            },
            async linkTodo(taskId, _projectId, todoId) {
                if (taskId === parent.id) parent.basecampTodoId = todoId;
            },
            async recordTask() {},
            async recordClient() {},
        },
        provider: {
            async createTodo(input) {
                calls.push(`create:${input.title}`);
                return { ok: true, todoId: '77', supportsSubtasks: true };
            },
            async updateTodo() { return { ok: true }; },
            async setAssignees() { return { ok: true }; },
            async getTodo() { return { ok: true, completed: false }; },
            async completeTodo() { return { ok: true }; },
            async reopenTodo() { return { ok: true }; },
            async createStep() { return { ok: true, todoId: '88' }; },
        },
    };
    const outcome = await syncPlanTask('child-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.deepEqual(calls, ['create:Citations']);
});
