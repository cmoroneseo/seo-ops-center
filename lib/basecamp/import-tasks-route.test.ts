import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeTrackingTaskId } from '../tasks/pillars.ts';

type RouteModule = typeof import('./import-tasks-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./import-tasks-route.ts');
    } catch (error) {
        assert.fail(`Request-level Basecamp import handler must be implemented: ${String(error)}`);
    }
}

const task = {
    title: 'Imported task',
    basecampTodoId: 77,
    basecampProjectId: 202,
    priority: 'medium' as const,
};

function request(overrides: Record<string, unknown> = {}) {
    return new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: 'client-a',
            organizationId: 'org-a',
            tasks: [task],
            ...overrides,
        }),
    });
}

const authorized = {
    ok: true as const,
    userId: 'user-1',
    actorName: 'User One',
    organizationId: 'org-a',
    clientId: 'client-a',
    role: 'member' as const,
};

const externalSource = (projects: Array<string | number> = ['202']) => ({
    findMembership: async () => ({ organizationIsInternal: false }),
    listConfiguredProjectIds: async () => projects,
});

async function responseBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('import rejects a known foreign client before project, provider, or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => ({ ok: false, status: 403, error: 'Forbidden' }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Forbidden' });
});

test('import rejects unauthenticated callers before project, provider, or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 401);
    assert.deepEqual(await responseBody(response), { error: 'Unauthorized' });
});

test('import rejects a mismatched caller organization before project or writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async (_clientId, assertedOrganizationId) => {
            assert.equal(assertedOrganizationId, 'org-attacker');
            return { ok: false, status: 403, error: 'Client does not belong to organization' };
        },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => false,
        getTodo: async () => null,
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request({ organizationId: 'org-attacker' }));

    assert.equal(response.status, 403);
});

test('import rejects an unauthorized Basecamp project before provider and writer access', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(['303']),
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Project is not authorized' });
});

test('import rejects todo IDs that do not belong to the authorized project before creating the writer', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async (projectId, todoId) => {
            assert.deepEqual([projectId, todoId], ['202', '77']);
            return null;
        },
        createWriter: () => { throw new Error('writer must not be created'); },
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 403);
    assert.deepEqual(await responseBody(response), { error: 'Basecamp todo is not authorized' });
});

test('authorized import writes the canonical client organization after provider provenance checks', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    let insertedRows: Array<Record<string, unknown>> = [];
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => ({
            id: 77,
            title: 'Canonical provider title',
            due_on: '2026-08-29',
            completed: false,
            description: 'Canonical provider description',
            assignees: [],
            app_url: 'https://3.basecamp.test/task/77',
        }),
        createWriter: () => ({
            insertTasks: async rows => { insertedRows = rows; return null; },
            logActivity: async () => {},
        }),
        now: () => '2026-08-20T00:00:00.000Z',
    });

    const response = await post(request());

    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 1, errors: [] });
    assert.equal(insertedRows.length, 1);
    assert.equal(insertedRows[0].organization_id, 'org-a');
    assert.equal(insertedRows[0].client_id, 'client-a');
    assert.equal(insertedRows[0].basecamp_project_id, 202);
    assert.equal(insertedRows[0].basecamp_todo_id, 77);
    assert.equal(insertedRows[0].title, 'Canonical provider title');
    assert.equal(insertedRows[0].description, 'Canonical provider description');
    assert.equal(insertedRows[0].due_date, '2026-08-29');
    assert.equal(insertedRows[0].priority, 'medium');
});

// ---------------------------------------------------------------------------
// `buildBasecampTaskRows` is shared by the bulk import screen and the
// timesheet picker's import-and-link. Mirroring completion and carrying
// assignees are OPTIONS on the builder, defaulting off — but BOTH callers now
// opt in. A to-do finished in Basecamp that arrives here outstanding shows as
// open work, skews task counts, and never reaches the client's feed as
// completed at all.
// ---------------------------------------------------------------------------

const completedProviderTodo = {
    id: 77,
    title: 'XERF landing page',
    description: 'Revisions',
    due_on: null,
    completed: true,
    completion: { created_at: '2026-08-14T17:20:00.000Z' },
    assignees: [{ id: 5001 }],
};

test('the builder leaves completion alone unless asked', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => completedProviderTodo,
        now: '2026-08-26T00:00:00.000Z',
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    const row = built.rows[0];
    assert.equal(row.status, 'todo');
    assert.equal(row.completed_at, null);
    assert.deepEqual(row.assignee_ids, []);
    assert.deepEqual(row.status_history, [
        { status: 'todo', at: '2026-08-26T00:00:00.000Z', by: 'user-1' },
    ]);
});

test('opting in mirrors completion and maps assignees back to org members', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => completedProviderTodo,
        now: '2026-08-26T00:00:00.000Z',
        options: {
            mirrorCompletion: true,
            resolveAssignees: async personIds => {
                assert.deepEqual(personIds, [5001]);
                return new Map([[5001, 'user-abel']]);
            },
        },
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    const row = built.rows[0];
    assert.equal(row.status, 'done');
    assert.equal(row.completed_at, '2026-08-14T17:20:00.000Z');
    assert.deepEqual(row.assignee_ids, ['user-abel']);
});

test('a completed to-do with no completion date falls back to the import moment', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => ({ ...completedProviderTodo, completion: null }),
        now: '2026-08-26T00:00:00.000Z',
        options: { mirrorCompletion: true },
    });

    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.rows[0].completed_at, '2026-08-26T00:00:00.000Z');
});

test('the row builder refuses a to-do the provider does not confirm', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => ({ ...completedProviderTodo, title: '   ' }),
        now: '2026-08-26T00:00:00.000Z',
    });

    assert.equal(built.ok, false);
    if (built.ok) return;
    assert.equal(built.status, 403);
});

/**
 * The bulk import screen's own wiring, not the builder's defaults.
 *
 * Its to-dos used to land as `todo` with `completed_at` null however finished
 * they were in Basecamp, so a backfilled project arrived looking entirely
 * outstanding and the client's feed showed one "tasks imported" line for the
 * lot of it.
 */
test('the bulk importer mirrors completion and announces it on the day it happened', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    let insertedRows: Array<Record<string, unknown>> = [];
    const completions: unknown[] = [];
    const assigneeLookups: Array<{ organizationId: string; personIds: number[] }> = [];

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => completedProviderTodo as never,
        resolveAssignees: async (organizationId, personIds) => {
            assigneeLookups.push({ organizationId, personIds });
            return new Map([[5001, 'user-abel']]);
        },
        createWriter: () => ({
            insertTasks: async rows => { insertedRows = rows; return null; },
            logActivity: async () => {},
            logCompletions: async payload => { completions.push(...payload.completions); },
        }),
        now: () => '2026-08-26T00:00:00.000Z',
    });

    const response = await post(new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            organizationId: 'org-a',
            clientId: 'client-a',
            tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        }),
    }));

    assert.equal(response.status, 200);
    // The SERVER-derived organization, never the request body's.
    assert.deepEqual(assigneeLookups, [{ organizationId: 'org-a', personIds: [5001] }]);
    assert.equal(insertedRows[0].status, 'done');
    assert.equal(insertedRows[0].completed_at, '2026-08-14T17:20:00.000Z');
    assert.deepEqual(insertedRows[0].assignee_ids, ['user-abel']);
    assert.deepEqual(completions, [
        { title: 'XERF landing page', completedAt: '2026-08-14T17:20:00.000Z' },
    ]);
});

test('a chunk that failed to insert announces no completions', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const completions: unknown[] = [];

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(),
        isConfigured: () => true,
        getTodo: async () => completedProviderTodo as never,
        resolveAssignees: async () => new Map([[5001, 'user-abel']]),
        createWriter: () => ({
            insertTasks: async () => 'insert failed',
            logActivity: async () => {},
            logCompletions: async payload => { completions.push(...payload.completions); },
        }),
        now: () => '2026-08-26T00:00:00.000Z',
    });

    const response = await post(new Request('https://seo-ops.test/api/integrations/basecamp/import-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            organizationId: 'org-a',
            clientId: 'client-a',
            tasks: [{ basecampTodoId: 77, basecampProjectId: 202 }],
        }),
    }));

    // Asserted so this cannot pass vacuously: a 500 would also record no
    // completions, and would say nothing about the insert-failure path.
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 0, errors: ['insert failed'] });

    // Announcing work that was never imported would put a completion in the
    // client's feed for a task that does not exist.
    assert.deepEqual(completions, []);
});

test('an imported to-do remembers which list it came from', async () => {
    const { buildBasecampTaskRows } = await loadRouteModule();
    const built = await buildBasecampTaskRows({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202, basecampTodolistId: 45 }],
        organizationId: 'org-a',
        clientId: 'client-a',
        userId: 'user-1',
        getTodo: async () => ({ id: 77, title: 'Set Up Empire Cookies', description: '', due_on: null }),
        now: '2026-10-15T00:00:00.000Z',
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.deepEqual(built.rows[0].custom_fields, { basecamp_source_todolist_id: '45' });
});

/**
 * To-do 10211418597. 'Send for approval' is done; 'Publish on website' is
 * open and due 2026-10-30. A trashed step and a step from another to-do are
 * not part of this checklist.
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
    {
        id: 9,
        title: 'Someone else\'s step',
        completed: false,
        parent: { id: 42, type: 'Todo' },
    },
];

test('Basecamp steps import as children of the to-do, and a re-import does not duplicate them', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const stored: Array<{
        id: string;
        basecampTodoId: number;
        stage: string | null;
        parentTaskId: string | null;
        row: Record<string, unknown>;
    }> = [];
    const completions: Array<{ title: string; completedAt: string }> = [];
    const assigneeLookups: number[][] = [];
    let sequence = 0;

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(['47747763']),
        isConfigured: () => true,
        getTodo: async () => ({
            id: 10211418597,
            title: 'Website FAQs',
            description: '',
            due_on: null,
            completed: false,
            assignees: [{ id: 5001 }],
            steps: faqSteps,
        }),
        getSteps: async () => faqSteps,
        resolveAssignees: async (_organizationId, personIds) => {
            assigneeLookups.push(personIds);
            return new Map([[5001, 'user-abel']]);
        },
        createWriter: () => ({
            async insertTasks(rows) {
                for (const row of rows) {
                    sequence += 1;
                    const isChild = typeof row.parent_task_id === 'string';
                    stored.push({
                        id: isChild ? `step-${sequence}` : `parent-${sequence}`,
                        basecampTodoId: Number(row.basecamp_todo_id),
                        stage: typeof row.stage === 'string' ? row.stage : 'backlog',
                        parentTaskId: isChild ? String(row.parent_task_id) : null,
                        row,
                    });
                }
                return null;
            },
            async findRecordings(_organizationId, _clientId, recordingIds) {
                const wanted = new Set(recordingIds);
                return stored
                    .filter(record => wanted.has(record.basecampTodoId))
                    .map(record => ({
                        id: record.id,
                        basecampTodoId: record.basecampTodoId,
                        stage: record.stage,
                        parentTaskId: record.parentTaskId,
                    }));
            },
            async logActivity() {},
            async logCompletions(payload) { completions.push(...payload.completions); },
        }),
        now: () => '2026-10-16T21:00:00.000Z',
    });

    const importRequest = () => request({
        tasks: [{ basecampTodoId: 10211418597, basecampProjectId: 47747763 }],
    });

    const response = await post(importRequest());
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 3, errors: [] });
    assert.deepEqual(assigneeLookups, [[5001, 9999]]);

    const parent = stored.find(record => record.parentTaskId == null);
    const publish = stored.find(record => record.row.title === 'Publish on website');
    const approval = stored.find(record => record.row.title === 'Send for approval');
    assert.ok(parent && publish && approval);
    assert.equal(stored.length, 3);

    assert.equal(publish.parentTaskId, parent.id);
    assert.equal(approval.parentTaskId, parent.id);
    assert.equal(publish.row.parent_task_id, parent.id);
    assert.equal(publish.row.client_id, 'client-a');
    assert.equal(approval.row.client_id, 'client-a');
    assert.equal(publish.row.organization_id, 'org-a');
    assert.equal(publish.stage, 'backlog');
    assert.equal(publish.row.stage, 'backlog');
    assert.equal(publish.row.status, 'todo');
    assert.equal(publish.row.due_date, '2026-10-30');
    assert.equal(publish.row.completed_at, null);
    assert.deepEqual(publish.row.assignee_ids, []);
    assert.equal(approval.row.status, 'done');
    assert.equal(approval.row.completed_at, '2026-08-17T21:40:17.999Z');
    assert.deepEqual(approval.row.assignee_ids, ['user-abel']);
    assert.equal(approval.row.basecamp_todo_id, 10211450455);
    assert.equal(publish.row.basecamp_todo_id, 10211449969);
    assert.equal(Object.hasOwn(publish.row, 'recurrence'), false);
    assert.equal(Object.hasOwn(publish.row, 'start_date'), false);
    assert.equal(timeTrackingTaskId(
        { id: publish.id, parentTaskId: parent.id, title: 'Publish on website' },
        { title: 'Website FAQs' },
    ), parent.id);
    assert.deepEqual(
        stored.filter(record => record.parentTaskId).map(record => record.row.title),
        ['Publish on website', 'Send for approval'],
    );
    assert.deepEqual(completions, [
        { title: 'Send for approval', completedAt: '2026-08-17T21:40:17.999Z' },
    ]);

    const again = await post(importRequest());
    assert.equal(again.status, 200);
    assert.deepEqual(await responseBody(again), { imported: 0, errors: [] });
    assert.equal(stored.length, 3);
    assert.equal(completions.length, 1);
});

test('steps attached to an existing to-do take that task\'s stage', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const stored = [{
        id: 'task-faqs',
        basecampTodoId: 10211418597,
        stage: 'onboarding',
        parentTaskId: null as string | null,
        row: { title: 'Website FAQs' } as Record<string, unknown>,
    }];

    const post = createBasecampImportTasksPost({
        authorizeClient: async () => authorized,
        createAccessSource: () => externalSource(['47747763']),
        isConfigured: () => true,
        getTodo: async () => ({
            id: 10211418597,
            title: 'Website FAQs',
            description: '',
            due_on: null,
            completed: false,
            assignees: [],
        }),
        getSteps: async () => faqSteps,
        resolveAssignees: async () => new Map(),
        createWriter: () => ({
            async insertTasks(rows) {
                for (const row of rows) {
                    stored.push({
                        id: `step-${stored.length}`,
                        basecampTodoId: Number(row.basecamp_todo_id),
                        stage: typeof row.stage === 'string' ? row.stage : 'backlog',
                        parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
                        row,
                    });
                }
                return null;
            },
            async findRecordings(_organizationId, _clientId, recordingIds) {
                const wanted = new Set(recordingIds);
                return stored
                    .filter(record => wanted.has(record.basecampTodoId))
                    .map(record => ({
                        id: record.id,
                        basecampTodoId: record.basecampTodoId,
                        stage: record.stage,
                        parentTaskId: record.parentTaskId,
                    }));
            },
            async logActivity() {},
            async logCompletions() {},
        }),
        now: () => '2026-10-16T21:00:00.000Z',
    });

    const response = await post(request({
        tasks: [{ basecampTodoId: 10211418597, basecampProjectId: 47747763 }],
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { imported: 2, errors: [] });
    const children = stored.filter(record => record.parentTaskId);
    assert.equal(children.length, 2);
    assert.ok(children.every(child => child.parentTaskId === 'task-faqs' && child.row.stage === 'onboarding'));
});

test('a non-numeric source list is refused before the provider is called', async () => {
    const { createBasecampImportTasksPost } = await loadRouteModule();
    const post = createBasecampImportTasksPost({
        authorizeClient: async () => { throw new Error('authorization must not run'); },
        createAccessSource: () => { throw new Error('project source must not be created'); },
        isConfigured: () => { throw new Error('provider configuration must not be read'); },
        getTodo: async () => { throw new Error('provider must not be called'); },
        createWriter: () => { throw new Error('writer must not be created'); },
        resolveAssignees: async () => { throw new Error('assignees must not be resolved'); },
        now: () => '2026-10-15T00:00:00.000Z',
    });
    const response = await post(request({
        tasks: [{ basecampTodoId: 77, basecampProjectId: 202, basecampTodolistId: 'not-a-list' }],
    }));
    assert.equal(response.status, 400);
});
