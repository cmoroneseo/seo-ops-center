import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TASK_SEARCH_LIMIT,
    createImportTasksGet,
    createImportTasksPost,
    type BasecampCandidateSource,
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
        // This harness wires no Basecamp source, so the second group is empty
        // and says why rather than reading as "Basecamp has nothing".
        basecampTodos: [],
        basecamp: { available: false, reason: 'not_configured' },
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
        // Empty here because this request sent no notes; the row supplies them.
        notes: '',
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


// ---------------------------------------------------------------------------
// Basecamp to-dos in the picker.
//
// A 0.4h entry, "Made revisions to XERF landing page for client", could not be
// linked to anything: the to-do it belonged to — "XERF landing page", assigned
// and completed — lived only in Basecamp, and the picker only searched
// `tasks`. These cover offering that to-do without ever trusting the browser
// for the project, and degrading to SEO PM tasks when Basecamp cannot answer.
// ---------------------------------------------------------------------------

function basecampSource(overrides: Partial<BasecampCandidateSource> = {}) {
    const calls = {
        resolvedClients: [] as Array<{ organizationId: string; clientId: string }>,
        authorized: [] as Array<{ userId: string; organizationId: string; projectId: string }>,
        listedProjects: [] as string[],
        importedFor: [] as string[],
    };
    const source: BasecampCandidateSource = {
        async resolveClientProjectId(organizationId, clientId) {
            calls.resolvedClients.push({ organizationId, clientId });
            return '202';
        },
        async authorizeProject(input) {
            calls.authorized.push(input);
            return true;
        },
        isConfigured: () => true,
        async listProjectTodos(projectId) {
            calls.listedProjects.push(projectId);
            return [
                {
                    id: '77',
                    title: 'XERF landing page',
                    completed: true,
                    dueOn: null,
                    todolistTitle: 'August',
                    projectId,
                },
                {
                    id: '78',
                    title: 'Already imported',
                    completed: false,
                    dueOn: null,
                    todolistTitle: 'August',
                    projectId,
                },
            ];
        },
        async listImportedTodoIds(organizationId) {
            calls.importedFor.push(organizationId);
            return [78];
        },
        ...overrides,
    };
    return { calls, source };
}

function pickerHarness(overrides: Partial<BasecampCandidateSource> = {}) {
    const { calls, source } = basecampSource(overrides);
    const dependencies: ImportTasksDependencies = {
        async authorize() {
            return {
                ok: true,
                userId: 'user-abel',
                organizationId: 'org-canonical',
                isManager: false,
            };
        },
        async searchTasks() {
            return [{ id: 'task-1', title: 'Roadmap to-dos', status: 'todo' }];
        },
        async loadEntry() { return entry(); },
        async createTask() { return { id: 'task-new' }; },
        basecamp: source,
    };
    return { calls, get: createImportTasksGet(dependencies) };
}

function pickerRequest(include?: string, query?: string) {
    const params = new URLSearchParams({
        organizationId: 'org-canonical',
        clientId: 'client-a',
    });
    if (include) params.set('include', include);
    if (query) params.set('q', query);
    return new Request(`https://seo-ops.test/api/timesheets/imports/tasks?${params}`);
}

test('the picker offers Basecamp to-dos that are not yet SEO PM tasks, completed included', async () => {
    const { get } = pickerHarness();

    const body = await (await get(pickerRequest())).json() as {
        tasks: Array<{ id: string }>;
        basecampTodos: Array<{ id: string; completed: boolean }>;
        basecamp: { available: boolean; reason: string };
    };

    assert.deepEqual(body.tasks.map(task => task.id), ['task-1']);
    // 78 is already imported and must not be offered a second time.
    assert.deepEqual(body.basecampTodos.map(todo => todo.id), ['77']);
    assert.equal(body.basecampTodos[0].completed, true);
    assert.deepEqual(body.basecamp, { available: true, reason: 'ok' });
});

test('the Basecamp project is resolved from the client, never from the request', async () => {
    const { calls, get } = pickerHarness();
    const params = new URLSearchParams({
        organizationId: 'org-canonical',
        clientId: 'client-a',
        // A browser-supplied project must have no effect whatsoever.
        projectId: '999',
        basecampProjectId: '999',
    });
    await get(new Request(`https://seo-ops.test/api/timesheets/imports/tasks?${params}`));

    assert.deepEqual(calls.resolvedClients, [
        { organizationId: 'org-canonical', clientId: 'client-a' },
    ]);
    assert.deepEqual(calls.listedProjects, ['202']);
    assert.deepEqual(calls.authorized, [
        { userId: 'user-abel', organizationId: 'org-canonical', projectId: '202' },
    ]);
});

test('a client with no Basecamp project returns SEO PM tasks and says why', async () => {
    const { get } = pickerHarness({ resolveClientProjectId: async () => null });

    const response = await get(pickerRequest());
    const body = await response.json() as {
        tasks: unknown[];
        basecampTodos: unknown[];
        basecamp: { available: boolean; reason: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.tasks.length, 1);
    assert.deepEqual(body.basecampTodos, []);
    assert.deepEqual(body.basecamp, { available: false, reason: 'no_project' });
});

test('a Basecamp failure degrades to SEO PM tasks rather than blocking linking', async () => {
    const { get } = pickerHarness({
        listProjectTodos: async () => { throw new Error('Basecamp is down'); },
    });

    const response = await get(pickerRequest());
    const body = await response.json() as {
        tasks: unknown[];
        basecamp: { available: boolean; reason: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.tasks.length, 1);
    assert.deepEqual(body.basecamp, { available: false, reason: 'unavailable' });
});

test('an unauthorized Basecamp project yields no to-dos and no provider call', async () => {
    const { calls, get } = pickerHarness({
        authorizeProject: async () => false,
        listProjectTodos: async () => { throw new Error('provider must not be called'); },
    });

    const body = await (await get(pickerRequest())).json() as {
        basecampTodos: unknown[];
        basecamp: { reason: string };
    };

    assert.deepEqual(body.basecampTodos, []);
    assert.equal(body.basecamp.reason, 'not_authorized');
    assert.deepEqual(calls.listedProjects, []);
});

test('include=tasks keeps the several-call Basecamp listing off the per-keystroke path', async () => {
    const { calls, get } = pickerHarness();

    const body = await (await get(pickerRequest('tasks', 'xerf'))).json() as {
        tasks: unknown[];
        basecampTodos: unknown[];
        basecamp: { reason: string };
    };

    assert.equal(body.tasks.length, 1);
    assert.deepEqual(body.basecampTodos, []);
    assert.equal(body.basecamp.reason, 'not_requested');
    assert.deepEqual(calls.listedProjects, []);
});

test('include=basecamp skips the SEO PM search so opening the picker costs one query each', async () => {
    const { source } = basecampSource();
    const dependencies: ImportTasksDependencies = {
        async authorize() {
            return { ok: true, userId: 'user-abel', organizationId: 'org-canonical', isManager: false };
        },
        async searchTasks() { throw new Error('task search must not run'); },
        async loadEntry() { return entry(); },
        async createTask() { return { id: 'task-new' }; },
        basecamp: source,
    };

    const body = await (await createImportTasksGet(dependencies)(
        pickerRequest('basecamp'),
    )).json() as { tasks: unknown[]; basecampTodos: unknown[] };

    assert.deepEqual(body.tasks, []);
    assert.equal(body.basecampTodos.length, 1);
});

test('a picker with no Basecamp wiring still answers with SEO PM tasks', async () => {
    const dependencies: ImportTasksDependencies = {
        async authorize() {
            return { ok: true, userId: 'user-abel', organizationId: 'org-canonical', isManager: false };
        },
        async searchTasks() {
            return [{ id: 'task-1', title: 'Roadmap to-dos', status: 'todo' }];
        },
        async loadEntry() { return entry(); },
        async createTask() { return { id: 'task-new' }; },
    };

    const body = await (await createImportTasksGet(dependencies)(pickerRequest())).json() as {
        tasks: unknown[];
        basecamp: { reason: string };
    };

    assert.equal(body.tasks.length, 1);
    assert.equal(body.basecamp.reason, 'not_configured');
});
