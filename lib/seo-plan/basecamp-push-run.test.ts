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
        completionSubscriberPersonIds: [],
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

test('an imported onboarding task updates its existing to-do and does not create another', async () => {
    const { dependencies, calls, links } = harness({
        task: task({
            title: 'SEO Set Up',
            stage: 'onboarding',
            dueDate: null,
            basecampTodoId: '10425524627',
            children: [{
                id: 'step-1',
                title: 'Connect Google Analytics',
                basecampTodoId: '10425524630',
            }],
        }),
        client: client({ todolistId: '10424778903' }),
        parent: null,
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.equal(calls.includes('create'), false);
    assert.equal(calls.some(call => call.startsWith('step:')), false);
    assert.equal(calls[0], 'update');
    assert.deepEqual(links, []);
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
    assert.deepEqual(calls.slice(0, 2), ['update', 'get']);
    assert.equal(calls.includes('complete'), true);
    assert.equal(calls.includes('step:Sources'), true);
});

test('a later update sends assignees with the content and records ok, clearing a stale error', async () => {
    const updates: Array<{ title: string; assigneePersonIds: number[]; completionSubscriberPersonIds: number[] }> = [];
    const { dependencies, calls, recorded } = harness({
        task: task({
            dueDate: '2026-11-30',
            basecampTodoId: '10429396134',
            description: 'Pick one page per service and city.',
            assigneePersonIds: [4],
            completionSubscriberPersonIds: [9],
        }),
        client: client(),
        parent: null,
    }, {
        async updateTodo(input) {
            updates.push({
                title: input.title,
                assigneePersonIds: input.assigneePersonIds,
                completionSubscriberPersonIds: input.completionSubscriberPersonIds,
            });
            return { ok: true };
        },
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    if (outcome.status !== 'ok') return;
    assert.equal(outcome.sync.state, 'ok');
    assert.equal(outcome.sync.error, null);
    assert.equal(calls.includes('get'), true);
    assert.equal(calls.includes('create'), false);
    assert.deepEqual(updates, [{
        title: 'Blog: home addition cost',
        assigneePersonIds: [4],
        completionSubscriberPersonIds: [9],
    }]);
    assert.deepEqual(recorded, [{ id: 'task-1', state: 'ok', error: null }]);
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

test('a child push records the result on the child, and a later success clears it', async () => {
    const parent = task({
        id: 'parent-1',
        title: 'Indexing + bloat triage',
        dueDate: '2026-11-30',
        basecampTodoId: '10429396134',
        description: 'Pick one page per service and city.',
        children: [{ id: 'child-1', title: 'Hide the duplicates', basecampTodoId: null }],
    });
    const child = task({
        id: 'child-1',
        parentTaskId: 'parent-1',
        dueDate: '2026-11-30',
        title: 'Hide the duplicates',
    });
    const recorded: Array<{ id: string; state: string; error: string | null }> = [];
    const calls: string[] = [];
    let fail = true;
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (id === 'child-1') {
                    return {
                        task: child,
                        client: client(),
                        parent: { id: parent.id, stage: parent.stage, dueDate: parent.dueDate },
                    };
                }
                if (id === 'parent-1') return { task: parent, client: client(), parent: null };
                return null;
            },
            async linkTodo(taskId, _projectId, todoId) {
                const step = parent.children.find(item => item.id === taskId);
                if (step) step.basecampTodoId = todoId;
            },
            async recordTask(id, sync) {
                recorded.push({ id, state: sync.state, error: sync.error });
            },
            async recordClient() {},
        },
        provider: {
            async createTodo() {
                throw new Error('an existing parent to-do must be updated, not created');
            },
            async updateTodo(input) {
                calls.push(`update:${input.title}`);
                assert.deepEqual(input.assigneePersonIds, []);
                assert.deepEqual(input.completionSubscriberPersonIds, []);
                if (fail) {
                    return {
                        ok: false,
                        status: 422,
                        scope: 'task',
                        message: 'Basecamp returned 422: {"status":422,"error":"Unprocessable Entity"}',
                    };
                }
                return { ok: true };
            },
            async getTodo() {
                calls.push('get');
                return { ok: true, completed: false, supportsSubtasks: true };
            },
            async completeTodo() { return { ok: true }; },
            async reopenTodo() { return { ok: true }; },
            async createStep(input) {
                calls.push(`step:${input.title}`);
                return { ok: true, todoId: '88' };
            },
        },
    };

    const failed = await syncPlanTask('child-1', dependencies);
    assert.equal(failed.status, 'failed');
    assert.deepEqual(calls, ['update:Indexing + bloat triage']);
    assert.deepEqual(recorded.map(row => row.id), ['parent-1', 'child-1']);
    assert.ok(recorded.every(row => row.state === 'failed' && /422/.test(row.error ?? '')));

    fail = false;
    recorded.length = 0;
    calls.length = 0;
    const succeeded = await syncPlanTask('child-1', dependencies);
    assert.equal(succeeded.status, 'ok');
    if (succeeded.status !== 'ok') return;
    assert.equal(succeeded.sync.error, null);
    assert.deepEqual(calls, ['update:Indexing + bloat triage', 'get', 'step:Hide the duplicates']);
    assert.deepEqual(recorded, [
        { id: 'parent-1', state: 'ok', error: null },
        { id: 'child-1', state: 'ok', error: null },
    ]);
});

test('a parent push turns a flat child to-do into a subtask and trashes it only after the step is saved', async () => {
    const calls: string[] = [];
    const child = { id: 'child-1', title: 'Houzz', basecampTodoId: '100', pendingTrashId: null as string | null };
    const parent = task({
        id: 'parent-1',
        stage: 'onboarding',
        title: 'Citations',
        basecampTodoId: '77',
        children: [child],
    });
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (id === 'child-1') {
                    return {
                        task: task({ id: 'child-1', title: 'Houzz', parentTaskId: 'parent-1', basecampTodoId: child.basecampTodoId }),
                        client: client(),
                        parent: { id: 'parent-1', stage: 'onboarding', dueDate: null },
                    };
                }
                if (id === 'parent-1') return { task: parent, client: client(), parent: null };
                return null;
            },
            async linkTodo(taskId, _projectId, todoId, _at, pendingTrashId) {
                calls.push(`link:${taskId}:${todoId}:${pendingTrashId ?? ''}`);
                child.basecampTodoId = todoId;
                child.pendingTrashId = pendingTrashId ?? null;
            },
            async clearPendingTrash(taskId) {
                calls.push(`clear:${taskId}`);
                child.pendingTrashId = null;
            },
            async recordTask() {},
            async recordClient() {},
        },
        provider: {
            async createTodo() { return { ok: true, todoId: '77' }; },
            async updateTodo() { calls.push('update'); return { ok: true }; },
            async getTodo() { calls.push('get'); return { ok: true, completed: false }; },
            async completeTodo() { return { ok: true }; },
            async reopenTodo() { return { ok: true }; },
            async createStep(input) {
                calls.push(`step:${input.title}`);
                return { ok: true, todoId: '200' };
            },
            async inspectRecording(input) {
                calls.push(`inspect:${input.recordingId}`);
                if (input.recordingId === '200') {
                    return { ok: true, recording: { kind: 'step', parentTodoId: '77', trashed: false } };
                }
                return { ok: true, recording: { kind: 'todo', trashed: false } };
            },
            async listSteps() {
                calls.push('list-steps');
                return { ok: true, steps: [] };
            },
            async trashRecording(input) {
                calls.push(`trash:${input.recordingId}`);
                return { ok: true, alreadyGone: false };
            },
        },
    };
    const outcome = await syncPlanTask('child-1', dependencies);
    assert.equal(outcome.status, 'ok');
    const linkAt = calls.indexOf('link:child-1:200:100');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(linkAt > calls.indexOf('step:Houzz'));
    assert.ok(trashAt > linkAt);
    assert.ok(calls.indexOf('clear:child-1') > trashAt);
    assert.equal(calls.includes('update'), true);
    assert.equal(child.basecampTodoId, '200');
});

test('a done parent push completes a done child step and then completes the parent again', async () => {
    const calls: string[] = [];
    const child = {
        id: 'child-1',
        title: 'Houzz',
        status: 'done',
        basecampTodoId: '100',
        pendingTrashId: null as string | null,
    };
    const parent = task({
        id: 'parent-1',
        stage: 'onboarding',
        status: 'done',
        title: 'Citations',
        basecampTodoId: '77',
        children: [child],
    });
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (id === 'child-1') {
                    return {
                        task: task({
                            id: 'child-1',
                            title: 'Houzz',
                            status: 'done',
                            parentTaskId: 'parent-1',
                            basecampTodoId: child.basecampTodoId,
                        }),
                        client: client(),
                        parent: { id: 'parent-1', stage: 'onboarding', dueDate: null },
                    };
                }
                if (id === 'parent-1') return { task: parent, client: client(), parent: null };
                return null;
            },
            async linkTodo(taskId, _projectId, todoId, _at, pendingTrashId) {
                calls.push(`link:${taskId}:${todoId}:${pendingTrashId ?? ''}`);
                child.basecampTodoId = todoId;
                child.pendingTrashId = pendingTrashId ?? null;
            },
            async clearPendingTrash(taskId) {
                calls.push(`clear:${taskId}`);
                child.pendingTrashId = null;
            },
            async recordTask() {},
            async recordClient() {},
        },
        provider: {
            async createTodo() { return { ok: true, todoId: '77' }; },
            async updateTodo() { calls.push('update'); return { ok: true }; },
            async getTodo() { calls.push('get'); return { ok: true, completed: true }; },
            async completeTodo(input) { calls.push(`complete-todo:${input.todoId}`); return { ok: true }; },
            async reopenTodo(input) { calls.push(`reopen:${input.todoId}`); return { ok: true }; },
            async createStep(input) { calls.push(`step:${input.title}`); return { ok: true, todoId: '200' }; },
            async completeStep(input) { calls.push(`complete-step:${input.stepId}`); return { ok: true }; },
            async inspectRecording(input) {
                calls.push(`inspect:${input.recordingId}`);
                if (input.recordingId === '77') {
                    return { ok: true, recording: { kind: 'todo', trashed: false, completed: true } };
                }
                return { ok: true, recording: { kind: 'todo', trashed: false, completed: true } };
            },
            async listSteps() { calls.push('list-steps'); return { ok: true, steps: [] }; },
            async trashRecording(input) { calls.push(`trash:${input.recordingId}`); return { ok: true, alreadyGone: false }; },
        },
    };
    const outcome = await syncPlanTask('child-1', dependencies);
    assert.equal(outcome.status, 'ok');
    const reopenAt = calls.indexOf('reopen:77');
    const stepAt = calls.indexOf('step:Houzz');
    const completeStepAt = calls.indexOf('complete-step:200');
    const completeParentAt = calls.lastIndexOf('complete-todo:77');
    const trashAt = calls.indexOf('trash:100');
    assert.ok(reopenAt > calls.indexOf('get'));
    assert.ok(stepAt > reopenAt);
    assert.ok(completeStepAt > stepAt);
    assert.ok(completeParentAt > completeStepAt);
    assert.ok(trashAt > completeParentAt);
});

test('a child under a parent that does not qualify is nested instead of updated as its own to-do', async () => {
    const calls: string[] = [];
    const childTask = task({
        id: 'child-1',
        title: 'Houzz',
        dueDate: '2026-10-31',
        parentTaskId: 'parent-1',
        basecampTodoId: '100',
    });
    const parent = task({
        id: 'parent-1',
        title: 'Citations',
        stage: 'backlog',
        dueDate: null,
        basecampTodoId: '77',
        children: [],
    });
    const dependencies: PlanPushDependencies = {
        now: () => at,
        store: {
            async load(id) {
                if (id === 'child-1') {
                    return { task: childTask, client: client(), parent: { id: parent.id, stage: parent.stage, dueDate: parent.dueDate } };
                }
                if (id === 'parent-1') return { task: parent, client: client(), parent: null };
                return null;
            },
            async linkTodo(taskId, _projectId, todoId) {
                calls.push(`link:${taskId}:${todoId}`);
                childTask.basecampTodoId = todoId;
            },
            async clearPendingTrash() {},
            async recordTask() {},
            async recordClient() {},
        },
        provider: {
            async createTodo() { calls.push('create'); return { ok: true, todoId: '300' }; },
            async updateTodo(input) { calls.push(`update:${input.todoId}`); return { ok: true }; },
            async getTodo() { return { ok: true, completed: false }; },
            async completeTodo() { return { ok: true }; },
            async reopenTodo() { return { ok: true }; },
            async createStep() { calls.push('step'); return { ok: true, todoId: '200' }; },
            async inspectRecording() {
                return { ok: true, recording: { kind: 'todo', trashed: false } };
            },
            async listSteps() { return { ok: true, steps: [] }; },
            async trashRecording() { calls.push('trash'); return { ok: true, alreadyGone: false }; },
        },
    };
    const outcome = await syncPlanTask('child-1', dependencies);
    assert.equal(outcome.status, 'ok');
    assert.equal(calls.includes('step'), true);
    assert.equal(calls.includes('trash'), true);
    assert.equal(calls.includes('update:100'), false);
    assert.equal(calls.includes('create'), false);
});

test('an undated backlog task is not lifted out of a subtask', async () => {
    const calls: string[] = [];
    const { dependencies } = harness({
        task: task({ stage: 'backlog', dueDate: null, basecampTodoId: '100' }),
        client: client(),
        parent: null,
    }, {
        async inspectRecording() {
            calls.push('inspect');
            return { ok: true, recording: { kind: 'step', parentTodoId: '77', trashed: false } };
        },
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'skipped');
    assert.deepEqual(calls, []);
});

test('a qualifying top-level task that is still a subtask becomes a to-do before it is updated', async () => {
    const calls: string[] = [];
    const row = task({ stage: 'onboarding', basecampTodoId: '100', title: 'Houzz' });
    const { dependencies } = harness({ task: row, client: client(), parent: null }, {
        async inspectRecording() {
            calls.push('inspect');
            return { ok: true, recording: { kind: 'step', parentTodoId: '77', trashed: false } };
        },
        async listSteps() {
            return { ok: true, steps: [] };
        },
        async listTodos() {
            calls.push('list-todos');
            return { ok: true, todos: [] };
        },
        async createTodo(input) {
            calls.push(`create:${input.title}`);
            return { ok: true, todoId: '300' };
        },
        async updateTodo(input) {
            calls.push(`update:${input.todoId}`);
            return { ok: true };
        },
        async trashRecording(input) {
            calls.push(`trash:${input.recordingId}`);
            return { ok: true, alreadyGone: false };
        },
    });
    const outcome = await syncPlanTask('task-1', dependencies);
    assert.equal(outcome.status, 'ok');
    const createAt = calls.indexOf('create:Houzz');
    const trashAt = calls.indexOf('trash:100');
    const updateAt = calls.indexOf('update:300');
    assert.ok(createAt >= 0);
    assert.ok(trashAt > createAt);
    assert.ok(updateAt > trashAt);
    assert.equal(row.basecampTodoId, '300');
});
