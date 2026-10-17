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
    stage: 'month_1',
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
    assert.deepEqual(calls.positions, [`${org}:${clientId.toUpperCase()}:month_1:`]);
    assert.equal(calls.rows.length, 2);
    assert.equal(calls.rows[0].organization_id, org);
    assert.equal(calls.rows[0].client_id, clientId.toUpperCase());
    assert.equal(calls.rows[0].title, 'Review robots.txt');
    assert.equal(calls.rows[0].stage, 'month_1');
    assert.equal(calls.rows[0].position, 5);
    assert.equal(calls.rows[1].position, 6);
    assert.equal(calls.rows[0].sort_order, 0);
    assert.equal(calls.rows[1].sort_order, 1);
    assert.equal(calls.rows[0].status, 'todo');
    assert.equal(calls.rows[0].priority, 'medium');
    assert.equal(calls.rows[0].created_by, userId);
    assert.equal(calls.rows[0].parent_task_id, undefined);
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
    const result = await createStageTasks(clientId, { stage: 'month_2', titles: ['One', 'Two'] }, dependencies);
    assert.equal(result.status, 200);
    assert.deepEqual(calls.rows.map(row => row.position), [1, 2]);
    assert.deepEqual(calls.rows.map(row => row.stage), ['month_2', 'month_2']);
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
    const empty = await createStageTasks(clientId, { stage: 'month_1', titles: ['  '] }, dependencies);
    const huge = await createStageTasks(clientId, { stage: 'nope', titles: ['Title'] }, dependencies);
    const many = await createStageTasks(clientId, {
        stage: 'month_1',
        titles: Array.from({ length: 41 }, (_, index) => `Task ${index}`),
    }, dependencies);
    assert.equal(empty.status, 400);
    assert.equal(huge.status, 400);
    assert.equal(many.status, 400);
    assert.equal(calls.rows.length, 0);
    assert.equal(calls.clients.length, 0);
});

test('a caller-supplied sync flag does not push, and an explicit server sync pushes each new task', async () => {
    const off = deps();
    await createStageTasks(clientId, body, off.dependencies);
    assert.deepEqual(off.calls.pushes, []);

    const on = deps({ syncToBasecamp: true });
    const result = await createStageTasks(clientId, { stage: 'backlog', titles: ['One', 'Two'] }, on.dependencies);
    assert.equal(result.status, 200);
    assert.deepEqual(on.calls.pushes, ['task-1', 'task-2']);
});

test('a Basecamp push failure still returns the created tasks', async () => {
    const { dependencies, calls } = deps({
        syncToBasecamp: true,
        pushToBasecamp: () => {
            throw new Error('basecamp down');
        },
    });
    const result = await createStageTasks(clientId, { stage: 'backlog', titles: ['One'] }, dependencies);
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
        stage: 'month_1',
        titles: ['Check https://example.com/chino'],
    }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(calls.rows[0].title, 'Check https://example.com/chino');
    assert.equal(Object.hasOwn(calls.rows[0], 'published_url'), false);
});

test('a write failure does not return the underlying message', async () => {
    const { dependencies } = deps({
        insertTasks: async () => {
            throw new Error('provider payload token sk_live_secret');
        },
    });
    const result = await createStageTasks(clientId, { stage: 'month_1', titles: ['Review robots.txt'] }, dependencies);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not add tasks' });
    assert.equal(JSON.stringify(result.body).includes('sk_live'), false);
    assert.equal(JSON.stringify(result.body).includes('token'), false);
});
