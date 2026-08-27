import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TASK_SEARCH_LIMIT,
    createImportTasksGet,
    createImportTasksPost,
    type ImportTasksDependencies,
    type TaskSourceEntry,
    type TasksAuthorization,
} from './import-tasks-route.ts';

function entry(overrides: Partial<TaskSourceEntry> = {}): TaskSourceEntry {
    return { id: 'log-1', userId: 'user-abel', clientId: 'client-a', ...overrides };
}

function harness(options: {
    authorization?: TasksAuthorization;
    entry?: TaskSourceEntry | null;
} = {}) {
    const searches: Array<{
        organizationId: string;
        clientId: string;
        query: string;
        limit: number;
    }> = [];
    const entryLoads: Array<{ organizationId: string; timeLogId: string }> = [];
    const creations: Array<Record<string, unknown>> = [];

    const dependencies: ImportTasksDependencies = {
        async authorize() {
            return options.authorization ?? {
                ok: true,
                userId: 'user-abel',
                organizationId: 'org-canonical',
                isManager: false,
            };
        },
        async searchTasks(scope) {
            searches.push(scope);
            return [{ id: 'task-1', title: 'Roadmap to-dos', status: 'todo' }];
        },
        async loadEntry(organizationId, timeLogId) {
            entryLoads.push({ organizationId, timeLogId });
            return options.entry === undefined ? entry() : options.entry;
        },
        async createTask(input) {
            creations.push(input);
            return { id: 'task-new' };
        },
    };

    return {
        searches,
        entryLoads,
        creations,
        get: createImportTasksGet(dependencies),
        post: createImportTasksPost(dependencies),
    };
}

function getRequest(query: string): Request {
    return new Request(`https://seo-pm.test/api/timesheets/imports/tasks?${query}`);
}

function postRequest(body: unknown): Request {
    return new Request('https://seo-pm.test/api/timesheets/imports/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// --- searching -------------------------------------------------------------

test('a member searches their own organization for one client', async () => {
    const member = harness();
    const response = await member.get(getRequest(
        'organizationId=org-typed&clientId=client-a&q=roadmap',
    ));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        tasks: [{ id: 'task-1', title: 'Roadmap to-dos', status: 'todo' }],
    });
    // The canonical organization from authorization, never the typed one.
    assert.deepEqual(member.searches, [{
        organizationId: 'org-canonical',
        clientId: 'client-a',
        query: 'roadmap',
        limit: TASK_SEARCH_LIMIT,
    }]);
});

test('the candidate list is capped', () => {
    assert.equal(TASK_SEARCH_LIMIT, 20);
});

test('a row with no client is told so, not shown an empty list', async () => {
    const member = harness();
    const response = await member.get(getRequest('organizationId=org-canonical'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
        error: 'Give this entry a client first',
        tasks: [],
    });
    assert.deepEqual(member.searches, []);
});

test('a non-member never reaches the task query', async () => {
    const outsider = harness({
        authorization: { ok: false, status: 403, error: 'Forbidden' },
    });
    const response = await outsider.get(getRequest(
        'organizationId=org-other&clientId=client-a',
    ));

    assert.equal(response.status, 403);
    assert.deepEqual(outsider.searches, []);
});

// --- creating --------------------------------------------------------------

test('the client comes from the time log, never from the body', async () => {
    const member = harness();
    const response = await member.post(postRequest({
        organizationId: 'org-typed',
        timeLogId: 'log-1',
        title: 'Add roadmap to-dos to Basecamp',
        clientId: 'client-someone-else',
    }));

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
        ok: true,
        taskId: 'task-new',
        clientId: 'client-a',
    });
    assert.deepEqual(member.entryLoads, [{
        organizationId: 'org-canonical',
        timeLogId: 'log-1',
    }]);
    assert.deepEqual(member.creations, [{
        organizationId: 'org-canonical',
        clientId: 'client-a',
        title: 'Add roadmap to-dos to Basecamp',
        assigneeUserId: 'user-abel',
        createdBy: 'user-abel',
    }]);
});

test('the assignee defaults to whoever the time belongs to', async () => {
    const manager = harness({
        authorization: {
            ok: true,
            userId: 'user-carlos',
            organizationId: 'org-canonical',
            isManager: true,
        },
        entry: entry({ userId: 'user-abel' }),
    });
    await manager.post(postRequest({
        organizationId: 'org-canonical',
        timeLogId: 'log-1',
        title: 'Checked off Basecamp to-dos',
    }));

    assert.equal(manager.creations[0].assigneeUserId, 'user-abel');
    assert.equal(manager.creations[0].createdBy, 'user-carlos');
});

test('a member may not create a task from somebody else’s entry', async () => {
    const member = harness({ entry: entry({ userId: 'user-someone-else' }) });
    const response = await member.post(postRequest({
        organizationId: 'org-canonical',
        timeLogId: 'log-1',
        title: 'Roadmap',
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(member.creations, []);
});

test('a manager may create a task from anyone’s entry', async () => {
    const manager = harness({
        authorization: {
            ok: true,
            userId: 'user-carlos',
            organizationId: 'org-canonical',
            isManager: true,
        },
        entry: entry({ userId: 'user-someone-else' }),
    });
    const response = await manager.post(postRequest({
        organizationId: 'org-canonical',
        timeLogId: 'log-1',
        title: 'Roadmap',
    }));

    assert.equal(response.status, 201);
    assert.equal(manager.creations.length, 1);
});

test('an entry with no client cannot mint a task', async () => {
    const member = harness({ entry: entry({ clientId: null }) });
    const response = await member.post(postRequest({
        organizationId: 'org-canonical',
        timeLogId: 'log-1',
        title: 'Roadmap',
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'Give this entry a client first' });
    assert.deepEqual(member.creations, []);
});

test('an unknown entry is a 404, not a task on a guessed client', async () => {
    const member = harness({ entry: null });
    const response = await member.post(postRequest({
        organizationId: 'org-canonical',
        timeLogId: 'log-gone',
        title: 'Roadmap',
    }));

    assert.equal(response.status, 404);
    assert.deepEqual(member.creations, []);
});

test('a blank or oversized title is refused before anything is authorized', async () => {
    const member = harness();
    for (const title of ['', '   ', 'x'.repeat(201)]) {
        const response = await member.post(postRequest({
            organizationId: 'org-canonical',
            timeLogId: 'log-1',
            title,
        }));
        assert.equal(response.status, 400);
    }
    assert.deepEqual(member.entryLoads, []);
    assert.deepEqual(member.creations, []);
});

test('malformed JSON is a 400', async () => {
    const member = harness();
    const response = await member.post(new Request(
        'https://seo-pm.test/api/timesheets/imports/tasks',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
    ));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
});
