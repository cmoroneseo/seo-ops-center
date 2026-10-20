import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionOrganization } from '../reports/session-org.ts';
import { createStageTasks, type StageAddDependencies } from './stage-add-route.ts';
import type { StageAddParent } from './stage-add-db.ts';
import type { StageListTask } from './stage-list.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
const parentId = '208dbc36-1111-4111-8111-111111111111';
const userId = 'user-1';

function taskFromRow(row: Record<string, unknown>, index: number): StageListTask {
    return {
        id: `task-${index + 1}`,
        title: String(row.title),
        status: 'todo',
        stage: String(row.stage),
        position: typeof row.position === 'number' ? row.position : null,
        parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
        createdAt: '2026-10-16T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
    };
}

function deps(overrides: Partial<StageAddDependencies> = {}) {
    const calls = {
        enabled: [] as string[],
        clients: [] as string[],
        parents: [] as string[],
        positions: [] as string[],
        rows: [] as Record<string, unknown>[],
        pushes: [] as string[],
        logs: [] as { organizationId: string; clientId: string; userId: string; title: string; parentTitle?: string }[],
    };
    const dependencies: StageAddDependencies = {
        session: async () => ({ ok: true, userId, organizationId: org, role: 'member' }),
        enabled: organizationId => {
            calls.enabled.push(organizationId);
            return true;
        },
        now: () => '2026-10-16T17:00:00.000Z',
        loadClient: async (organizationId, id) => {
            calls.clients.push(`${organizationId}:${id}`);
            return true;
        },
        loadParent: async (organizationId, id, parentTaskId) => {
            calls.parents.push(`${organizationId}:${id}:${parentTaskId}`);
            const parent: StageAddParent = { title: 'SEO Setup', stage: 'onboarding', parentTaskId: null };
            return parent;
        },
        maxPosition: async (organizationId, id, stage, parentTaskId) => {
            calls.positions.push(`${organizationId}:${id}:${stage}:${parentTaskId ?? ''}`);
            return parentTaskId ? 9 : 4;
        },
        insertTasks: async rows => {
            calls.rows.push(...rows);
            return rows.map(taskFromRow);
        },
        pushToBasecamp: taskId => {
            calls.pushes.push(taskId);
        },
        logCreated: async event => {
            calls.logs.push({
                organizationId: event.organizationId,
                clientId: event.clientId,
                userId: event.userId,
                title: event.task.title,
                parentTitle: event.parentTitle,
            });
        },
        ...overrides,
    };
    return { dependencies, calls };
}

const body = {
    stage: 'backlog',
    titles: [' Review robots.txt ', 'Check HTTPS'],
    organizationId: other,
    clientId: other,
    createdBy: 'attacker',
    syncToBasecamp: true,
};

test('a malformed client id never reads the session or writes', async () => {
    const { dependencies, calls } = deps();
    let sessions = 0;
    dependencies.session = async () => {
        sessions += 1;
        return { ok: true, userId, organizationId: org, role: 'member' };
    };
    const result = await createStageTasks('not-a-uuid', body, dependencies);
    assert.equal(result.status, 400);
    assert.equal(sessions, 0);
    assert.equal(calls.rows.length, 0);
    assert.equal(JSON.stringify(result.body).includes('not-a-uuid'), false);
});

test('an anonymous session never writes', async () => {
    const { dependencies, calls } = deps({
        session: async (): Promise<SessionOrganization> => ({ ok: false, status: 401, error: 'Unauthorized' }),
    });
    const result = await createStageTasks(clientId, body, dependencies);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Unauthorized' });
    assert.equal(calls.enabled.length, 0);
    assert.equal(calls.clients.length, 0);
    assert.equal(calls.rows.length, 0);
});

test('a flag that is off does not write', async () => {
    const { dependencies, calls } = deps({ enabled: () => false });
    const result = await createStageTasks(clientId, body, dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'Not found' });
    assert.equal(calls.clients.length, 0);
    assert.equal(calls.rows.length, 0);
});

test('a viewer cannot create tasks', async () => {
    const { dependencies, calls } = deps({
        session: async () => ({ ok: true, userId, organizationId: org, role: 'viewer' }),
    });
    const result = await createStageTasks(clientId, body, dependencies);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: 'Forbidden' });
    assert.equal(calls.clients.length, 0);
    assert.equal(calls.rows.length, 0);
    assert.equal(calls.pushes.length, 0);
});

test('titles are created at the end of the stage for the session organization', async () => {
    const { dependencies, calls } = deps();
    const result = await createStageTasks(` ${clientId.toUpperCase()} `, body, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.deepEqual(result.body.tasks.map(task => task.title), ['Review robots.txt', 'Check HTTPS']);
    assert.deepEqual(result.body.tasks.map(task => task.position), [5, 6]);
    assert.deepEqual(calls.clients, [`${org}:${clientId.toUpperCase()}`]);
    assert.deepEqual(calls.positions, [`${org}:${clientId.toUpperCase()}:backlog:`]);
    assert.equal(calls.rows.length, 2);
    assert.equal(calls.rows[0].organization_id, org);
    assert.equal(calls.rows[0].client_id, clientId.toUpperCase());
    assert.equal(calls.rows[0].title, 'Review robots.txt');
    assert.equal(calls.rows[0].stage, 'backlog');
    assert.equal(calls.rows[0].position, 5);
    assert.equal(calls.rows[1].position, 6);
    assert.equal(calls.rows[0].sort_order, 0);
    assert.equal(calls.rows[1].sort_order, 1);
    assert.equal(calls.rows[0].status, 'todo');
    assert.equal(calls.rows[0].priority, 'medium');
    assert.equal(calls.rows[0].created_by, userId);
    assert.equal(calls.rows[0].parent_task_id, undefined);
    assert.equal(calls.rows[0].due_date, undefined);
    assert.deepEqual(calls.rows[0].status_history, [{ status: 'todo', at: '2026-10-16T17:00:00.000Z', by: userId }]);
    assert.equal(Object.hasOwn(calls.rows[0], 'basecamp_todo_id'), false);
    assert.equal(calls.rows.some(row => row.organization_id === other || row.client_id === other || row.created_by === 'attacker'), false);
    assert.equal(calls.pushes.length, 0);
    assert.deepEqual(calls.logs.map(log => log.title), ['Review robots.txt', 'Check HTTPS']);
    assert.equal(calls.logs[0].organizationId, org);
    assert.equal(calls.logs[0].clientId, clientId.toUpperCase());
    assert.equal(calls.logs[0].userId, userId);
    assert.equal(calls.logs[0].parentTitle, undefined);
});

test('an empty stage starts at position 1', async () => {
    const { dependencies, calls } = deps({
        maxPosition: async () => null,
    });
    const result = await createStageTasks(clientId, { stage: 'onboarding', titles: ['One', 'Two'] }, dependencies);
    assert.equal(result.status, 200);
    assert.deepEqual(calls.rows.map(row => row.position), [1, 2]);
    assert.deepEqual(calls.rows.map(row => row.stage), ['onboarding', 'onboarding']);
});

test('a subtask is placed at the end of the pillar and keeps the pillar stage', async () => {
    const { dependencies, calls } = deps();
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        titles: ['Connect Search Console'],
        parentTaskId: parentId,
        organizationId: other,
    }, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.equal(result.body.tasks[0].stage, 'onboarding');
    assert.equal(result.body.tasks[0].position, 10);
    assert.equal(result.body.tasks[0].parentTaskId, parentId);
    assert.equal(calls.rows[0].stage, 'onboarding');
    assert.equal(calls.rows[0].position, 10);
    assert.equal(calls.rows[0].parent_task_id, parentId);
    assert.deepEqual(calls.positions, [`${org}:${clientId}:onboarding:${parentId}`]);
    assert.equal(calls.logs[0].parentTitle, 'SEO Setup');
    assert.equal(calls.rows[0].organization_id, org);
});

test('a subtask cannot be nested under another subtask', async () => {
    const { dependencies, calls } = deps({
        loadParent: async () => ({ title: 'Add keywords', stage: 'onboarding', parentTaskId: 'setup' }),
    });
    const result = await createStageTasks(clientId, {
        stage: 'onboarding',
        titles: ['Too deep'],
        parentTaskId: parentId,
    }, dependencies);
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: 'That task cannot have subtasks' });
    assert.equal(calls.rows.length, 0);
});

test('a client or pillar outside the session organization is not found', async () => {
    const missingClient = deps({ loadClient: async () => false });
    const clientResult = await createStageTasks(clientId, body, missingClient.dependencies);
    assert.equal(clientResult.status, 404);
    assert.equal(missingClient.calls.rows.length, 0);

    const missingParent = deps({ loadParent: async () => null });
    const parentResult = await createStageTasks(clientId, {
        stage: 'onboarding',
        titles: ['Connect Search Console'],
        parentTaskId: parentId,
    }, missingParent.dependencies);
    assert.equal(parentResult.status, 404);
    assert.equal(missingParent.calls.rows.length, 0);
});

test('rejected titles never insert', async () => {
    const { dependencies, calls } = deps();
    const empty = await createStageTasks(clientId, { stage: 'backlog', titles: ['  '] }, dependencies);
    const huge = await createStageTasks(clientId, { stage: 'nope', titles: ['Title'] }, dependencies);
    const many = await createStageTasks(clientId, {
        stage: 'backlog',
        titles: Array.from({ length: 41 }, (_, index) => `Task ${index}`),
    }, dependencies);
    assert.equal(empty.status, 400);
    assert.equal(huge.status, 400);
    assert.equal(many.status, 400);
    assert.equal(calls.rows.length, 0);
    assert.equal(calls.clients.length, 0);
});

test('an undated backlog task does not push, and leaving backlog does', async () => {
    const backlog = deps();
    await createStageTasks(clientId, body, backlog.dependencies);
    assert.deepEqual(backlog.calls.pushes, []);

    const dated = deps();
    const withDate = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        items: [{ title: 'One', depth: 0 }, { title: 'Two', depth: 0 }],
    }, dated.dependencies);
    assert.equal(withDate.status, 200);
    assert.deepEqual(dated.calls.pushes, ['task-1', 'task-2']);

    const onboarding = deps();
    const left = await createStageTasks(clientId, { stage: 'onboarding', titles: ['Kickoff'] }, onboarding.dependencies);
    assert.equal(left.status, 200);
    assert.deepEqual(onboarding.calls.pushes, ['task-1']);
});

test('a Basecamp push failure still returns the created tasks', async () => {
    const { dependencies, calls } = deps({
        pushToBasecamp: () => {
            throw new Error('basecamp down');
        },
    });
    const result = await createStageTasks(clientId, { stage: 'onboarding', titles: ['One'] }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(calls.rows.length, 1);
});

test('a feed failure still returns the created tasks', async () => {
    const { dependencies, calls } = deps({
        logCreated: async () => {
            throw new Error('feed down');
        },
    });
    const result = await createStageTasks(clientId, { stage: 'backlog', titles: ['One'] }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(calls.rows.length, 1);
});

test('a subtask line stores the live URL and a task line without one stays a title', async () => {
    const { dependencies, calls } = deps();
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        titles: ['Chino service page https://example.com/chino', 'Review robots.txt'],
        parentTaskId: parentId,
    }, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.deepEqual(result.body.tasks.map(task => task.title), ['Chino service page', 'Review robots.txt']);
    assert.equal(calls.rows[0].title, 'Chino service page');
    assert.equal(calls.rows[0].published_url, 'https://example.com/chino');
    assert.equal(calls.rows[1].title, 'Review robots.txt');
    assert.equal(Object.hasOwn(calls.rows[1], 'published_url'), false);
});

test('a top-level task keeps a pasted URL in the title', async () => {
    const { dependencies, calls } = deps();
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        titles: ['Check https://example.com/chino'],
    }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(calls.rows[0].title, 'Check https://example.com/chino');
    assert.equal(Object.hasOwn(calls.rows[0], 'published_url'), false);
});

test('one request creates pillars first, then links each subtask to its own pillar', async () => {
    const batches: Record<string, unknown>[][] = [];
    const { dependencies, calls } = deps({
        insertTasks: async rows => {
            batches.push(rows.map(row => ({ ...row })));
            calls.rows.push(...rows);
            return rows.map((row, index) => ({
                id: `created-${batches.length}-${index + 1}`,
                title: String(row.title),
                status: 'todo',
                stage: String(row.stage),
                position: typeof row.position === 'number' ? row.position : null,
                parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
                createdAt: '2026-10-16T00:00:00.000Z',
                category: null,
                basecamp: false,
                recurring: false,
                ...(typeof row.due_date === 'string' || row.due_date === null ? { dueDate: row.due_date as string | null } : {}),
            }));
        },
    });
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        organizationId: other,
        syncToBasecamp: true,
        items: [
            { title: ' Citations round 2 ', depth: 0 },
            { title: 'Houzz photos', depth: 1 },
            { title: 'Porch.com listing', depth: 1 },
            { title: 'Update GBP holiday hours', depth: 0 },
            { title: 'Confirm the hours', depth: 1 },
            { title: 'Add financing FAQ', depth: 0 },
        ],
    }, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.deepEqual(result.body.tasks.map(task => task.title), [
        'Citations round 2',
        'Houzz photos',
        'Porch.com listing',
        'Update GBP holiday hours',
        'Confirm the hours',
        'Add financing FAQ',
    ]);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches[0].map(row => row.title), [
        'Citations round 2',
        'Update GBP holiday hours',
        'Add financing FAQ',
    ]);
    assert.deepEqual(batches[0].map(row => row.position), [5, 6, 7]);
    assert.deepEqual(batches[0].map(row => row.stage), ['backlog', 'backlog', 'backlog']);
    assert.deepEqual(batches[0].map(row => row.due_date), ['2026-10-31', '2026-10-31', '2026-10-31']);
    assert.deepEqual(batches[0].map(row => row.assignee_ids), [[], [], []]);
    assert.equal(batches[0].every(row => row.status === 'todo' && row.estimated_hours === undefined), true);
    assert.equal(batches[0].every(row => row.parent_task_id === undefined), true);
    assert.equal(batches[0].some(row => row.organization_id === other || row.created_by === 'attacker'), false);
    assert.deepEqual(batches[1].map(row => [row.title, row.parent_task_id, row.position, row.due_date]), [
        ['Houzz photos', 'created-1-1', 1, '2026-10-31'],
        ['Porch.com listing', 'created-1-1', 2, '2026-10-31'],
        ['Confirm the hours', 'created-1-2', 1, '2026-10-31'],
    ]);
    assert.deepEqual(result.body.tasks.map(task => task.parentTaskId), [
        null,
        'created-1-1',
        'created-1-1',
        null,
        'created-1-2',
        null,
    ]);
    assert.deepEqual(calls.positions, [`${org}:${clientId}:backlog:`]);
    assert.equal(calls.parents.length, 0);
    assert.deepEqual(calls.pushes, [
        'created-1-1',
        'created-2-1',
        'created-2-2',
        'created-1-2',
        'created-2-3',
        'created-1-3',
    ]);
    assert.deepEqual(calls.logs.map(log => [log.title, log.parentTitle]), [
        ['Citations round 2', undefined],
        ['Houzz photos', 'Citations round 2'],
        ['Porch.com listing', 'Citations round 2'],
        ['Update GBP holiday hours', undefined],
        ['Confirm the hours', 'Update GBP holiday hours'],
        ['Add financing FAQ', undefined],
    ]);
});

test('onboarding and backlog chips write the stage and leave the due date empty', async () => {
    const onboarding = deps();
    const onboardingResult = await createStageTasks(clientId, {
        stage: 'onboarding',
        dueDate: null,
        items: [{ title: 'Connect Search Console', depth: 0 }],
    }, onboarding.dependencies);
    assert.equal(onboardingResult.status, 200);
    assert.equal(onboarding.calls.rows[0].stage, 'onboarding');
    assert.equal(onboarding.calls.rows[0].due_date, null);
    assert.deepEqual(onboarding.calls.rows[0].assignee_ids, []);

    const backlog = deps();
    const backlogResult = await createStageTasks(clientId, {
        stage: 'backlog',
        items: [{ title: 'Someday', depth: 0 }],
    }, backlog.dependencies);
    assert.equal(backlogResult.status, 200);
    assert.equal(backlog.calls.rows[0].stage, 'backlog');
    assert.equal(backlog.calls.rows[0].due_date, null);
});

test('a leading subtask is promoted, and a child insert failure removes the pillars', async () => {
    const promoted = deps();
    const promotedResult = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        items: [
            { title: 'Orphan', depth: 1 },
            { title: 'Sibling', depth: 0 },
        ],
    }, promoted.dependencies);
    assert.equal(promotedResult.status, 200);
    assert.equal(promoted.calls.rows.length, 2);
    assert.equal(promoted.calls.rows.every(row => row.parent_task_id === undefined), true);

    const deleted: string[][] = [];
    let inserts = 0;
    const failed = deps({
        insertTasks: async rows => {
            inserts += 1;
            if (inserts > 1) throw new Error('child write failed token sk_live_secret');
            return rows.map((row, index) => ({
                id: `pillar-${index + 1}`,
                title: String(row.title),
                status: 'todo',
                stage: 'backlog',
                position: typeof row.position === 'number' ? row.position : null,
                parentTaskId: null,
                createdAt: '2026-10-16T00:00:00.000Z',
                category: null,
                basecamp: false,
                recurring: false,
            }));
        },
        deleteTasks: async ids => {
            deleted.push(ids);
        },
    });
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        items: [
            { title: 'Citations', depth: 0 },
            { title: 'Houzz', depth: 1 },
        ],
    }, failed.dependencies);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not add tasks' });
    assert.equal(JSON.stringify(result.body).includes('sk_live'), false);
    assert.deepEqual(deleted, [['pillar-1']]);
    assert.equal(failed.calls.pushes.length, 0);
    assert.equal(failed.calls.logs.length, 0);
});

test('a dated paste pushes every created row, including subtasks', async () => {
    let created = 0;
    const { dependencies, calls } = deps({
        insertTasks: async rows => rows.map(row => {
            created += 1;
            return {
                id: `task-${created}`,
                title: String(row.title),
                status: 'todo',
                stage: String(row.stage),
                position: typeof row.position === 'number' ? row.position : null,
                parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
                createdAt: '2026-10-16T00:00:00.000Z',
                category: null,
                basecamp: false,
                recurring: false,
            };
        }),
    });
    const result = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        items: [
            { title: 'Citations', depth: 0 },
            { title: 'Houzz', depth: 1 },
        ],
    }, dependencies);
    assert.equal(result.status, 200);
    assert.deepEqual(calls.pushes, ['task-1', 'task-2']);
});

test('a bad due date or an oversized paste never inserts', async () => {
    const { dependencies, calls } = deps();
    const badDay = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-02-31',
        items: [{ title: 'Citations', depth: 0 }],
    }, dependencies);
    const many = await createStageTasks(clientId, {
        stage: 'backlog',
        dueDate: '2026-10-31',
        items: Array.from({ length: 41 }, (_, index) => ({ title: `Task ${index}`, depth: 0 })),
    }, dependencies);
    const long = await createStageTasks(clientId, {
        stage: 'onboarding',
        items: [{ title: 'x'.repeat(301), depth: 0 }],
    }, dependencies);
    const deep = await createStageTasks(clientId, {
        stage: 'backlog',
        items: [{ title: 'Too deep', depth: 2 }],
    }, dependencies);
    assert.equal(badDay.status, 400);
    assert.equal(many.status, 400);
    assert.deepEqual(many.body, { error: 'Add up to 40 tasks at a time.' });
    assert.equal(long.status, 400);
    assert.equal(deep.status, 400);
    assert.equal(calls.rows.length, 0);
    assert.equal(calls.clients.length, 0);
});

test('a write failure does not return the underlying message', async () => {
    const { dependencies } = deps({
        insertTasks: async () => {
            throw new Error('provider payload token sk_live_secret');
        },
    });
    const result = await createStageTasks(clientId, { stage: 'backlog', titles: ['Review robots.txt'] }, dependencies);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not add tasks' });
    assert.equal(JSON.stringify(result.body).includes('sk_live'), false);
    assert.equal(JSON.stringify(result.body).includes('token'), false);
});
