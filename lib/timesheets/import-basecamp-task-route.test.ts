import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createImportBasecampTaskPost,
    type ImportBasecampTaskDependencies,
} from './import-basecamp-task-route.ts';
import type { TaskSourceEntry, TasksAuthorization } from './import-tasks-route.ts';

const completedTodo = {
    id: 77,
    title: 'XERF landing page',
    description: '<div>Revisions</div>',
    due_on: null,
    completed: true,
    completion: { created_at: '2026-08-14T17:20:00.000Z' },
    assignees: [{ id: 5001 }, { id: 9999 }],
};

function harness(options: {
    authorization?: TasksAuthorization;
    entry?: TaskSourceEntry | null;
    projectId?: string | null;
    authorizeProject?: boolean;
    isConfigured?: boolean;
    todo?: unknown;
    existing?: { id: string; title: string } | null;
} = {}) {
    const inserted: Array<Record<string, unknown>> = [];
    const providerCalls: Array<{ projectId: string; todoId: string }> = [];
    const assigneeLookups: Array<{ organizationId: string; personIds: number[] }> = [];
    const logs: unknown[] = [];

    const dependencies: ImportBasecampTaskDependencies = {
        async authorize() {
            return options.authorization ?? {
                ok: true,
                userId: 'user-abel',
                organizationId: 'org-canonical',
                isManager: false,
            };
        },
        async loadEntry() {
            return options.entry === undefined
                ? { id: 'log-1', userId: 'user-abel', clientId: 'client-a' }
                : options.entry;
        },
        async resolveClientProjectId() {
            return options.projectId === undefined ? '202' : options.projectId;
        },
        async authorizeProject() {
            return options.authorizeProject ?? true;
        },
        isConfigured: () => options.isConfigured ?? true,
        async getTodo(projectId, todoId) {
            providerCalls.push({ projectId, todoId });
            return (options.todo === undefined ? completedTodo : options.todo) as never;
        },
        async resolveAssignees(organizationId, personIds) {
            assigneeLookups.push({ organizationId, personIds });
            // 9999 has no member row and is simply absent.
            return new Map([[5001, 'user-abel']]);
        },
        async findImportedTask() {
            return options.existing ?? null;
        },
        async insertTask(row) {
            inserted.push(row);
            return { id: 'task-new', title: String(row.title) };
        },
        async logImport(payload) { logs.push(payload); },
        now: () => '2026-08-26T00:00:00.000Z',
    };

    return {
        inserted,
        providerCalls,
        assigneeLookups,
        logs,
        post: createImportBasecampTaskPost(dependencies),
    };
}

function request(body: unknown = { organizationId: 'org-typed', timeLogId: 'log-1', basecampTodoId: '77' }) {
    return new Request('https://seo-ops.test/api/timesheets/imports/tasks/basecamp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

test('a completed Basecamp to-do arrives done, dated when it was actually finished', async () => {
    const member = harness();
    const response = await member.post(request());
    const body = await response.json() as { taskId: string; taskTitle: string; imported: boolean };

    assert.equal(response.status, 201);
    assert.deepEqual(
        { taskId: body.taskId, taskTitle: body.taskTitle, imported: body.imported },
        { taskId: 'task-new', taskTitle: 'XERF landing page', imported: true },
    );

    const row = member.inserted[0];
    assert.equal(row.status, 'done');
    // Finished on the 14th, imported on the 26th: the row must say the 14th,
    // or every backfilled to-do reads as completed today.
    assert.equal(row.completed_at, '2026-08-14T17:20:00.000Z');
    assert.deepEqual(row.status_history, [
        { status: 'done', at: '2026-08-14T17:20:00.000Z', by: 'user-abel' },
    ]);
});

test('the assignee is mapped back from the Basecamp person, and an unmapped person is omitted', async () => {
    const member = harness();
    await member.post(request());

    assert.deepEqual(member.assigneeLookups, [
        { organizationId: 'org-canonical', personIds: [5001, 9999] },
    ]);
    assert.deepEqual(member.inserted[0].assignee_ids, ['user-abel']);
});

test('an open to-do still arrives as todo', async () => {
    const member = harness({
        todo: { ...completedTodo, completed: false, completion: null },
    });
    await member.post(request());

    assert.equal(member.inserted[0].status, 'todo');
    assert.equal(member.inserted[0].completed_at, null);
});

test('the client comes from the time log and the project from that client, never from the body', async () => {
    const member = harness();
    await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '77',
        // All three are ignored.
        clientId: 'client-someone-else',
        organizationIdOverride: 'org-other',
        basecampProjectId: '999',
    }));

    assert.deepEqual(member.providerCalls, [{ projectId: '202', todoId: '77' }]);
    assert.equal(member.inserted[0].client_id, 'client-a');
    assert.equal(member.inserted[0].organization_id, 'org-canonical');
    assert.equal(member.inserted[0].basecamp_project_id, 202);
});

test('a to-do whose provider identity does not match what was asked for is refused', async () => {
    const member = harness({ todo: { ...completedTodo, id: 78 } });
    const response = await member.post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(member.inserted, []);
});

test('a missing provider to-do is refused rather than imported as an empty task', async () => {
    const member = harness({ todo: null });
    const response = await member.post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(member.inserted, []);
});

test('an entry with no client is told so instead of importing against nothing', async () => {
    const member = harness({ entry: { id: 'log-1', userId: 'user-abel', clientId: null } });
    const response = await member.post(request());

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Give this entry a client first' });
});

test('a client with no Basecamp project is refused, not silently imported', async () => {
    const member = harness({ projectId: null });
    const response = await member.post(request());

    assert.equal(response.status, 409);
    assert.deepEqual(member.inserted, []);
});

test('an unauthorized project is refused before the provider is touched', async () => {
    const member = harness({ authorizeProject: false });
    const response = await member.post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(member.providerCalls, []);
});

test('another member cannot import against an entry that is not theirs', async () => {
    const member = harness({ entry: { id: 'log-1', userId: 'user-other', clientId: 'client-a' } });
    const response = await member.post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(member.inserted, []);
});

test('a manager may import against anyone’s entry', async () => {
    const member = harness({
        authorization: {
            ok: true,
            userId: 'user-manager',
            organizationId: 'org-canonical',
            isManager: true,
        },
        entry: { id: 'log-1', userId: 'user-other', clientId: 'client-a' },
    });
    const response = await member.post(request());

    assert.equal(response.status, 201);
});

test('picking a to-do that is already a task links it rather than minting a duplicate', async () => {
    const member = harness({ existing: { id: 'task-existing', title: 'XERF landing page' } });
    const response = await member.post(request());
    const body = await response.json() as { taskId: string; imported: boolean };

    assert.equal(response.status, 200);
    assert.deepEqual({ taskId: body.taskId, imported: body.imported }, {
        taskId: 'task-existing',
        imported: false,
    });
    assert.deepEqual(member.inserted, []);
    assert.deepEqual(member.providerCalls, []);
});

test('an unconfigured Basecamp is reported rather than written through', async () => {
    const member = harness({ isConfigured: false });
    const response = await member.post(request());

    assert.equal(response.status, 503);
    assert.deepEqual(member.inserted, []);
});

test('a non-numeric to-do id is rejected before any lookup', async () => {
    const member = harness();
    const response = await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '77; drop',
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(member.providerCalls, []);
});

/**
 * The client's activity feed is also a client-facing report, so the date an
 * event carries is the date the client reads as "when this happened".
 *
 * A to-do completed on the 14th and imported on the 27th produced only an
 * "integration.tasks_imported" event stamped the 27th: the completion never
 * appeared in the feed at all, and the import sat above genuinely newer work.
 * Reported against "XERF landing page" — finished Aug 17, imported Aug 27.
 */

test('importing a finished to-do records the completion on the day it was finished', async () => {
    const member = harness();
    const response = await member.post(request());
    assert.equal(response.status, 201);

    const completion = member.logs.find(entry => entry.completedAt);
    assert.ok(completion, 'the import must carry the provider completion moment');
    assert.equal(completion.completedAt, '2026-08-14T17:20:00.000Z');
});

test('a to-do that is still open records no completion date', async () => {
    const member = harness({ todo: { ...completedTodo, completed: false, completion: null } });
    const response = await member.post(request());
    assert.equal(response.status, 201);

    assert.equal(member.logs[0].completedAt, null);
});
