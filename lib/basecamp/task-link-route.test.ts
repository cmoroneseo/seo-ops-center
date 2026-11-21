import assert from 'node:assert/strict';
import test from 'node:test';
import { createBasecampTaskLinkHandler, type BasecampTaskLinkDependencies } from './task-link-route.ts';
import { parseBasecampTodoInput } from './todo-input.ts';
import type { BasecampLinkedTask } from './task-todo-link.ts';
import { normalizeBasecampTodoStep } from './todo-steps.ts';

const todoId = '10425524627';
const projectId = '202';
const now = '2026-11-20T21:00:00Z';
const parent: BasecampLinkedTask = {
    id: '2d6b57f1-c4cd-4b47-a07e-bba8d1b2612b', organizationId: 'org', clientId: 'client',
    title: 'SEO Set Up', category: 'technical', priority: 'high',
    parentTaskId: null, basecampTodoId: null, basecampProjectId: null,
};
const session = {
    ok: true, userId: 'member', organizationId: parent.organizationId, clientId: parent.clientId,
    taskId: parent.id, role: 'member',
} as const;

function fixture(options: { linked?: boolean; configuredProjectId?: string | null } = {}) {
    const root = options.linked ? { ...parent, basecampTodoId: todoId, basecampProjectId: projectId } : { ...parent };
    const tasks: BasecampLinkedTask[] = [root];
    const inserted: Record<string, unknown>[] = [];
    const steps = Array.from({ length: 9 }, (_, index) => normalizeBasecampTodoStep({
        id: Number(todoId) + index + 1,
        title: `Step ${index + 1}`,
        position: index + 1,
        parent: { id: Number(todoId) },
        completed: index === 4,
        completion: index === 4 ? { created_at: '2026-11-18T12:00:00Z' } : null,
    })!);
    const todo = { id: todoId, title: parent.title, description: '', due_on: null, steps: [steps[0]] };
    const writeCalls: string[] = [];
    const readCalls: string[] = [];
    const provider = {
        isConfigured: () => true,
        async recordingKind(project: string, id: string) {
            readCalls.push('recordingKind');
            if (project !== projectId) return null;
            if (id === todoId) return 'todo' as const;
            return steps.some(step => String(step.id) === id) ? 'step' as const : null;
        },
        async getTodo(project: string, id: string) {
            readCalls.push('getTodo');
            return project === projectId && id === todoId ? todo : null;
        },
        async listSteps() { readCalls.push('listSteps'); return steps; },
        async createTodo() { writeCalls.push('createTodo'); },
        async createStep() { writeCalls.push('createStep'); },
        async updateTodo() { writeCalls.push('updateTodo'); },
        async completeTodo() { writeCalls.push('completeTodo'); },
        async completeStep() { writeCalls.push('completeStep'); },
    };
    const deps: BasecampTaskLinkDependencies = {
        authorizeTask: async () => session,
        createStore: () => ({
            async getTask(auth) {
                assert.equal(auth.taskId, root.id);
                return {
                    ...root,
                    configuredProjectId: options.configuredProjectId === undefined ? projectId : options.configuredProjectId,
                };
            },
            async findRecordings(ids) {
                return tasks.filter(row => row.basecampTodoId && ids.includes(row.basecampTodoId));
            },
            async listChildren(task) { return tasks.filter(row => row.parentTaskId === task.id); },
            async updateTaskLink(task, project, id) {
                const local = tasks.find(row => row.id === task.id)!;
                if (local.basecampTodoId && local.basecampTodoId !== id) return null;
                Object.assign(local, { basecampTodoId: id, basecampProjectId: project });
                return local;
            },
            async insertImportedTasks(rows) {
                inserted.push(...rows);
                return rows.map(row => {
                    const child = {
                        ...parent, id: `imported-${row.basecamp_todo_id}`, title: String(row.title),
                        parentTaskId: String(row.parent_task_id), basecampTodoId: String(row.basecamp_todo_id),
                        basecampProjectId: String(row.basecamp_project_id),
                    };
                    tasks.push(child);
                    return child;
                });
            },
        }),
        provider,
        now: () => now,
    };
    function call(action: 'link' | 'refresh' | 'check', input: unknown = todoId) {
        const url = 'http://localhost/basecamp';
        const req = action === 'check'
            ? new Request(`${url}?taskId=${root.id}`)
            : new Request(url, { method: 'POST', body: JSON.stringify({ taskId: root.id, basecampTodoId: input }) });
        return createBasecampTaskLinkHandler(action, deps)(req);
    }
    return { root, tasks, inserted, steps, deps, provider, readCalls, writeCalls, call };
}

test('parses a positive safe id and a Basecamp to-do URL with its bucket', () => {
    assert.deepEqual(parseBasecampTodoInput(`  00${todoId} `), { todoId, projectId: null });
    assert.deepEqual(parseBasecampTodoInput(Number(todoId)), { todoId, projectId: null });
    assert.deepEqual(parseBasecampTodoInput(`https://3.basecamp.com/10/buckets/${projectId}/todos/${todoId}?x=1#checklist`), {
        todoId, projectId,
    });
    assert.deepEqual(parseBasecampTodoInput(`https://3.basecamp.com/10/todos/${todoId}`), { todoId, projectId: null });
    for (const invalid of [null, 0, -1, '1.5', '1e3', '9007199254740992', '', 'https://example.com/10/buckets/202/todos/10',
        'https://3.basecamp.com.evil/10/buckets/202/todos/10', 'https://3.basecamp.com/10/buckets/202/todolists/10']) {
        assert.equal(parseBasecampTodoInput(invalid), null);
    }
});

test('links an existing task, keeps a unique local title match, and imports the other steps once', async () => {
    const f = fixture();
    const local = { ...parent, id: 'local', parentTaskId: parent.id, title: '  STEP 1 ' };
    f.tasks.push(local);
    const result = await f.call('link', `https://3.basecamp.com/10/buckets/${projectId}/todos/${todoId}`);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { todoId, projectId, imported: 8, linked: 1 });
    assert.equal(f.root.basecampTodoId, todoId);
    assert.equal(local.basecampTodoId, String(f.steps[0].id));
    assert.ok(f.inserted.every(row => row.parent_task_id === parent.id && !Object.hasOwn(row, 'stage')));
    assert.equal(f.tasks.filter(row => row.parentTaskId === null).length, 1);
    const repeated = await f.call('link');
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), { todoId, projectId, imported: 0, linked: 0 });
    assert.deepEqual(f.writeCalls, []);
});

test('refuses invalid ids, another project, steps, and missing project configuration', async () => {
    assert.equal((await fixture().call('link', '0')).status, 400);
    const wrongBucket = fixture();
    assert.equal((await wrongBucket.call('link', `https://3.basecamp.com/10/buckets/999/todos/${todoId}`)).status, 404);
    assert.deepEqual(wrongBucket.readCalls, []);
    assert.equal((await fixture({ configuredProjectId: '999' }).call('link')).status, 404);
    const step = fixture();
    assert.equal((await step.call('link', step.steps[0].id)).status, 400);
    assert.equal(step.root.basecampTodoId, null);
    const unconfigured = fixture({ configuredProjectId: null });
    assert.equal((await unconfigured.call('link')).status, 409);
    assert.deepEqual(unconfigured.readCalls, []);
});

test('refuses conflicting links across organizations or on the requested task', async () => {
    const f = fixture();
    f.tasks.push({ ...parent, id: 'other', organizationId: 'other-org', clientId: 'other-client', basecampTodoId: todoId });
    assert.equal((await f.call('link')).status, 409);
    assert.equal(f.root.basecampTodoId, null);
    const existing = fixture();
    existing.root.basecampTodoId = '1234';
    assert.equal((await existing.call('link')).status, 409);
    assert.equal(existing.root.basecampTodoId, '1234');
});

const recordingConflict = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "tasks_basecamp_recording_unique"',
};

for (const write of ['updateTaskLink', 'insertImportedTasks'] as const) {
    test(`link returns a conflict if a concurrent request wins the ${write} write`, async () => {
        const f = fixture();
        const store = f.deps.createStore();
        store[write] = async () => { throw recordingConflict; };
        f.deps.createStore = () => store;

        const result = await f.call('link');
        assert.equal(result.status, 409);
        assert.match((await result.json()).error, /conflicting link/i);
        assert.deepEqual(f.inserted, []);
        assert.deepEqual(f.writeCalls, []);
    });
}

test('requires a session and a writable role for the canonical task client and organization', async () => {
    const denials = [
        [{ ok: false, status: 401, error: 'Unauthorized' }, 401],
        [{ ok: false, status: 403, error: 'Forbidden' }, 403],
        [{ ...session, role: 'viewer' }, 403],
        [{ ...session, organizationId: 'other-org' }, 404],
    ] as const;
    for (const [denial, status] of denials) {
        const f = fixture({ linked: true });
        f.deps.authorizeTask = async () => denial;
        for (const action of ['link', 'refresh', 'check'] as const) {
            assert.equal((await f.call(action)).status, status);
        }
        assert.deepEqual(f.readCalls, []);
        assert.deepEqual(f.inserted, []);
    }
});

test('refresh imports five newly arrived steps under the existing parent and then imports zero', async () => {
    const f = fixture({ linked: true });
    for (const step of f.steps.slice(0, 4)) {
        f.tasks.push({
            ...parent, id: `old-${step.id}`, title: `Existing app title ${step.id}`,
            parentTaskId: parent.id, basecampTodoId: String(step.id), basecampProjectId: projectId,
        });
    }
    const result = await f.call('refresh');
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { todoId, projectId, imported: 5, linked: 0 });
    assert.deepEqual(f.inserted.map(row => row.basecamp_todo_id), f.steps.slice(4).map(step => step.id));
    assert.ok(f.inserted.every(row => row.parent_task_id === parent.id));
    assert.equal(f.inserted[0].status, 'done');
    assert.equal(f.inserted[0].completed_at, '2026-11-18T12:00:00Z');
    assert.equal(f.tasks.filter(row => row.parentTaskId === parent.id).length, 9);
    assert.equal(f.tasks.filter(row => row.parentTaskId === null).length, 1);
    assert.deepEqual(await (await f.call('refresh')).json(), { todoId, projectId, imported: 0, linked: 0 });
    assert.equal(f.inserted.length, 5);
    assert.deepEqual(f.writeCalls, []);
});

test('refresh skips a step claimed during insert and imports the remaining steps', async () => {
    const f = fixture({ linked: true });
    const claimedStep = f.steps[4];
    const store = f.deps.createStore();
    const insert = store.insertImportedTasks;
    store.insertImportedTasks = async rows => {
        if (rows.some(row => row.basecamp_todo_id === claimedStep.id)) {
            if (!f.tasks.some(task => task.basecampTodoId === String(claimedStep.id))) {
                f.tasks.push({
                    ...parent, id: 'concurrent-import', parentTaskId: parent.id, title: claimedStep.title,
                    basecampTodoId: String(claimedStep.id), basecampProjectId: projectId,
                });
            }
            throw recordingConflict;
        }
        return insert(rows);
    };
    f.deps.createStore = () => store;

    const result = await f.call('refresh');
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { todoId, projectId, imported: 8, linked: 0 });
    assert.deepEqual(f.inserted.map(row => row.basecamp_todo_id), f.steps.filter(step => step !== claimedStep).map(step => step.id));
    assert.deepEqual(await (await f.call('refresh')).json(), { todoId, projectId, imported: 0, linked: 0 });
    assert.deepEqual(f.writeCalls, []);
});

test('refresh keeps unrelated uniqueness errors on the existing failure path', async () => {
    const f = fixture({ linked: true });
    const store = f.deps.createStore();
    store.insertImportedTasks = async () => {
        throw { code: '23505', message: 'duplicate key value violates unique constraint "tasks_pkey"' };
    };
    f.deps.createStore = () => store;

    assert.equal((await f.call('refresh')).status, 500);
    assert.deepEqual(f.writeCalls, []);
});

test('refresh eligibility and POST reject step links and nested tasks', async () => {
    const step = fixture({ linked: true });
    step.root.basecampTodoId = String(step.steps[0].id);
    assert.equal((await step.call('refresh')).status, 400);
    assert.deepEqual(await (await step.call('check')).json(), { canRefresh: false });
    assert.deepEqual(step.inserted, []);
    const nested = fixture({ linked: true });
    nested.root.parentTaskId = 'parent';
    assert.equal((await nested.call('refresh')).status, 400);
    assert.deepEqual(nested.readCalls, []);
    const f = fixture({ linked: true });
    assert.deepEqual(await (await f.call('check')).json(), { canRefresh: true });
    assert.deepEqual(f.readCalls, ['recordingKind']);
});

test('refresh refuses a mismatched or missing provider to-do and reports a failed step read', async () => {
    const mismatch = fixture({ linked: true });
    mismatch.root.basecampProjectId = '999';
    assert.equal((await mismatch.call('refresh')).status, 404);
    assert.deepEqual(mismatch.readCalls, []);
    assert.equal((await fixture({ linked: true, configuredProjectId: '999' }).call('refresh')).status, 404);
    const failed = fixture({ linked: true });
    failed.provider.listSteps = async () => { throw new Error('provider unavailable'); };
    assert.equal((await failed.call('refresh')).status, 502);
    assert.deepEqual(failed.inserted, []);
    const link = fixture();
    link.provider.listSteps = failed.provider.listSteps;
    assert.equal((await link.call('link')).status, 502);
    assert.equal(link.root.basecampTodoId, null);
});
