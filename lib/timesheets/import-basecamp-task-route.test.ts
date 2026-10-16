import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createImportBasecampTaskPost,
    type ImportBasecampTaskDependencies,
} from './import-basecamp-task-route.ts';
import type { TaskSourceEntry, TasksAuthorization } from './import-tasks-route.ts';
import { timeTrackingTaskId } from '../tasks/pillars.ts';

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
    steps?: unknown[] | ((projectId: string, todoId: string) => Promise<unknown>);
    existing?: { id: string; title: string; stage?: string | null; priority?: string | null } | null;
} = {}) {
    const inserted: Array<Record<string, unknown>> = [];
    const providerCalls: Array<{ projectId: string; todoId: string }> = [];
    const stepCalls: Array<{ projectId: string; todoId: string }> = [];
    const assigneeLookups: Array<{ organizationId: string; personIds: number[] }> = [];
    const logs: unknown[] = [];
    const recordings: Array<{
        id: string;
        title: string;
        basecampTodoId: number;
        stage: string | null;
        priority: string | null;
        parentTaskId: string | null;
    }> = [];

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
        async getSteps(projectId, todoId) {
            stepCalls.push({ projectId, todoId });
            const steps = typeof options.steps === 'function'
                ? await options.steps(projectId, todoId)
                : (options.steps ?? []);
            return steps;
        },
        async resolveAssignees(organizationId, personIds) {
            assigneeLookups.push({ organizationId, personIds });
            // 9999 has no member row and is simply absent.
            return new Map([[5001, 'user-abel']]);
        },
        async findImportedTask(_organizationId, _clientId, basecampTodoId) {
            if (options.existing !== undefined) return options.existing;
            const found = recordings.find(record => (
                record.basecampTodoId === basecampTodoId && record.parentTaskId == null
            ));
            return found
                ? { id: found.id, title: found.title, stage: found.stage, priority: found.priority }
                : null;
        },
        async findImportedRecordings(_organizationId, _clientId, basecampIds) {
            const wanted = new Set(basecampIds);
            return recordings.filter(record => wanted.has(record.basecampTodoId));
        },
        async insertTask(row) {
            inserted.push(row);
            const isChild = typeof row.parent_task_id === 'string';
            const id = isChild ? `step-${inserted.length}` : 'task-new';
            recordings.push({
                id,
                title: String(row.title),
                basecampTodoId: Number(row.basecamp_todo_id),
                stage: typeof row.stage === 'string' ? row.stage : 'backlog',
                priority: typeof row.priority === 'string' ? row.priority : 'medium',
                parentTaskId: isChild ? String(row.parent_task_id) : null,
            });
            return { id, title: String(row.title), stage: typeof row.stage === 'string' ? row.stage : 'backlog' };
        },
        async logImport(payload) { logs.push(payload); },
        now: () => '2026-08-26T00:00:00.000Z',
    };

    return {
        inserted,
        providerCalls,
        stepCalls,
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

/**
 * To-do 10211418597 in bucket 47747763. Steps are checklist items on that
 * to-do, not separate to-dos: one is already done, one is open and dated.
 */
const faqSteps = [
    {
        id: 10211450455,
        title: 'Send for approval',
        completed: true,
        completion: { created_at: '2026-08-17T21:40:17.999Z' },
        position: 2,
        status: 'active',
        assignees: [{ id: 5001 }, { id: 9999 }],
        parent: { id: 10211418597, type: 'Todo' },
    },
    {
        id: 10211449969,
        title: 'Publish on website',
        completed: false,
        due_on: '2026-10-30',
        position: 1,
        status: 'active',
        assignees: [{ id: 9999 }],
        parent: { id: 10211418597, type: 'Todo' },
    },
    {
        id: 8,
        title: 'Trashed step',
        status: 'trashed',
        completed: false,
        parent: { id: 10211418597, type: 'Todo' },
    },
];

test('Basecamp steps import as pillar subtasks, and a second pick does not duplicate them', async () => {
    const member = harness({
        projectId: '47747763',
        steps: faqSteps,
        existing: { id: 'task-faqs', title: 'Website FAQs', stage: 'onboarding', priority: 'high' },
    });

    const first = await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '10211418597',
    }));
    assert.equal(first.status, 200);
    const firstBody = await first.json() as { taskId: string; imported: boolean };
    assert.deepEqual(
        { taskId: firstBody.taskId, imported: firstBody.imported },
        { taskId: 'task-faqs', imported: false },
    );
    // The parent was already a task, so the to-do itself is not fetched again.
    assert.deepEqual(member.providerCalls, []);
    assert.deepEqual(member.stepCalls, [{ projectId: '47747763', todoId: '10211418597' }]);

    assert.equal(member.inserted.length, 2);
    const publish = member.inserted.find(row => row.title === 'Publish on website');
    const approval = member.inserted.find(row => row.title === 'Send for approval');
    assert.ok(publish && approval);

    assert.equal(publish.parent_task_id, 'task-faqs');
    assert.equal(approval.parent_task_id, 'task-faqs');
    assert.equal(publish.client_id, 'client-a');
    assert.equal(approval.client_id, 'client-a');
    assert.equal(publish.stage, 'onboarding');
    assert.equal(approval.stage, 'onboarding');
    assert.equal(publish.status, 'todo');
    assert.equal(publish.due_date, '2026-10-30');
    assert.equal(publish.completed_at, null);
    assert.deepEqual(publish.assignee_ids, []);
    assert.equal(approval.status, 'done');
    assert.equal(approval.completed_at, '2026-08-17T21:40:17.999Z');
    assert.deepEqual(approval.assignee_ids, ['user-abel']);
    assert.equal(approval.priority, 'high');
    assert.equal(approval.basecamp_todo_id, 10211450455);
    assert.equal(publish.basecamp_todo_id, 10211449969);
    assert.equal(Object.hasOwn(publish, 'recurrence'), false);
    assert.equal(Object.hasOwn(publish, 'start_date'), false);
    assert.equal(timeTrackingTaskId(
        { id: 'step-publish', parentTaskId: 'task-faqs', title: 'Publish on website' },
        { title: 'Website FAQs' },
    ), 'task-faqs');
    // Checklist order, not the order the payload happened to list them.
    assert.deepEqual(member.inserted.map(row => row.title), [
        'Publish on website',
        'Send for approval',
    ]);

    const second = await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '10211418597',
    }));
    assert.equal(second.status, 200);
    assert.equal(member.inserted.length, 2);
});

test('a newly imported to-do brings its steps along as children', async () => {
    const member = harness({
        projectId: '47747763',
        todo: {
            id: 10211418597,
            title: 'Website FAQs',
            description: '',
            due_on: null,
            completed: false,
            assignees: [],
        },
        steps: faqSteps,
    });
    const response = await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '10211418597',
    }));
    assert.equal(response.status, 201);
    const parent = member.inserted.find(row => row.title === 'Website FAQs');
    const publish = member.inserted.find(row => row.title === 'Publish on website');
    assert.ok(parent && publish);
    assert.equal(parent.parent_task_id, undefined);
    assert.equal(publish.parent_task_id, 'task-new');
    assert.equal(publish.stage, 'backlog');
    assert.equal(publish.due_date, '2026-10-30');
    assert.equal(publish.client_id, 'client-a');

    const again = await member.post(request({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        basecampTodoId: '10211418597',
    }));
    assert.equal(again.status, 200);
    assert.equal((await again.json() as { imported: boolean }).imported, false);
    assert.equal(member.inserted.length, 3);
});
