import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionOrganization } from '../reports/session-org.ts';
import { reorderStageTasks, stepOrderParentIds, type StageReorderDependencies } from './stage-reorder-route.ts';
import type { StageReorderWrite } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
const userId = 'user-1';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',

        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const loaded: StageListTask[] = [
    task({ id: '208dbc36-1111-4111-8111-111111111111', title: 'SEO Setup', position: 1 }),
    task({
        id: '208dbc36-2222-4222-8222-222222222222',
        title: 'Add keywords',
        position: 1,
        parentTaskId: '208dbc36-1111-4111-8111-111111111111',
    }),
    task({
        id: '208dbc36-3333-4333-8333-333333333333',
        title: 'Set Up Empire Cookies',
        position: 2,
        parentTaskId: '208dbc36-1111-4111-8111-111111111111',
    }),
    task({ id: '208dbc36-4444-4444-8444-444444444444', title: 'Create SEO Roadmap', position: 2 }),
    task({ id: '208dbc36-5555-4555-8555-555555555555', title: 'Review robots.txt', position: 1 }),
];

const setup = loaded[0].id;
const keywords = loaded[1].id;
const cookies = loaded[2].id;
const roadmap = loaded[3].id;
const robots = loaded[4].id;

function deps(overrides: Partial<StageReorderDependencies> = {}) {
    const calls = {
        enabled: [] as string[],
        loads: [] as string[],
        writes: [] as { organizationId: string; clientId: string; writes: StageReorderWrite[] }[],
    };
    const dependencies: StageReorderDependencies = {
        session: async () => ({ ok: true, userId, organizationId: org, role: 'member' }),
        enabled: organizationId => {
            calls.enabled.push(organizationId);
            return true;
        },
        load: async (organizationId, id) => {
            calls.loads.push(`${organizationId}:${id}`);
            return loaded;
        },
        rewrite: async (organizationId, id, writes) => {
            calls.writes.push({ organizationId, clientId: id, writes: [...writes] });
            return writes.map(write => {
                const current = loaded.find(item => item.id === write.id);
                return task({
                    id: write.id,
                    title: current?.title ?? 'Task',
                    position: write.position,
                    parentTaskId: write.parentTaskId,
                    recurring: current?.recurring ?? false,
                });
            });
        },
        ...overrides,
    };
    return { dependencies, calls };
}

const moveRoadmap = {
    taskId: roadmap,

    parentTaskId: null,
    index: 0,
    organizationId: other,
    clientId: other,
    role: 'owner',
    position: 99,
    writes: [{ id: roadmap, position: 1 }],
};

test('a malformed client id never reads the session or writes', async () => {
    const { dependencies, calls } = deps();
    let sessions = 0;
    dependencies.session = async () => {
        sessions += 1;
        return { ok: true, userId, organizationId: org, role: 'member' };
    };
    const result = await reorderStageTasks('not-a-uuid', moveRoadmap, dependencies);
    assert.equal(result.status, 400);
    assert.equal(sessions, 0);
    assert.equal(calls.loads.length, 0);
    assert.equal(calls.writes.length, 0);
    assert.equal(JSON.stringify(result.body).includes('not-a-uuid'), false);
});

test('an anonymous session never writes', async () => {
    const { dependencies, calls } = deps({
        session: async (): Promise<SessionOrganization> => ({ ok: false, status: 401, error: 'Unauthorized' }),
    });
    const result = await reorderStageTasks(clientId, moveRoadmap, dependencies);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Unauthorized' });
    assert.equal(calls.enabled.length, 0);
    assert.equal(calls.loads.length, 0);
    assert.equal(calls.writes.length, 0);
});

test('a flag that is off does not write', async () => {
    const { dependencies, calls } = deps({ enabled: () => false });
    const result = await reorderStageTasks(clientId, moveRoadmap, dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'Not found' });
    assert.equal(calls.loads.length, 0);
    assert.equal(calls.writes.length, 0);
});

test('a viewer cannot move tasks', async () => {
    const { dependencies, calls } = deps({
        session: async () => ({ ok: true, userId, organizationId: org, role: 'viewer' }),
    });
    const result = await reorderStageTasks(clientId, moveRoadmap, dependencies);
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: 'Forbidden' });
    assert.equal(calls.loads.length, 0);
    assert.equal(calls.writes.length, 0);
});

test('a move uses the session organization and rewrites affected siblings once', async () => {
    const { dependencies, calls } = deps();
    const result = await reorderStageTasks(` ${clientId.toUpperCase()} `, moveRoadmap, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.equal(calls.loads.length, 1);
    assert.equal(calls.loads[0], `${org}:${clientId.toUpperCase()}`);
    assert.equal(calls.writes.length, 1);
    assert.equal(calls.writes[0].organizationId, org);
    assert.equal(calls.writes[0].clientId, clientId.toUpperCase());
    const byId = new Map(calls.writes[0].writes.map(write => [write.id, write]));
    assert.equal(byId.get(roadmap)?.position, 1);
    assert.equal(byId.get(roadmap)?.parentTaskId, null);
    assert.equal(byId.get(setup)?.position, 2);
    assert.equal(byId.get(robots)?.position, 3);
    assert.equal(JSON.stringify(calls.writes).includes(other), false);
    assert.equal(JSON.stringify(calls.writes).includes('"position":99'), false);
});

test('nesting and un-nesting are decided by the server, one level deep', async () => {
    const nest = deps();
    const nested = await reorderStageTasks(clientId, {
        taskId: robots,

        parentTaskId: setup,
        index: 9,
        position: 1,
    }, nest.dependencies);
    assert.equal(nested.status, 200);
    assert.equal(nest.calls.writes.length, 1);
    const robotsWrite = nest.calls.writes[0].writes.find(write => write.id === robots);
    assert.equal(robotsWrite?.parentTaskId, setup);
    assert.equal(robotsWrite?.position, 3);

    const tooDeep = deps();
    const rejected = await reorderStageTasks(clientId, {
        taskId: robots,

        parentTaskId: keywords,
        index: 0,
    }, tooDeep.dependencies);
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.body, { error: 'Tasks can only nest one level deep' });
    assert.equal(tooDeep.calls.writes.length, 0);

    const pillar = deps();
    const nestedPillar = await reorderStageTasks(clientId, {
        taskId: setup,

        parentTaskId: robots,
        index: 0,
    }, pillar.dependencies);
    assert.equal(nestedPillar.status, 400);
    assert.deepEqual(nestedPillar.body, { error: 'Tasks can only nest one level deep' });
    assert.equal(pillar.calls.writes.length, 0);
});

test('a rewrite failure returns one error and does not expose the underlying message', async () => {
    let calls = 0;
    const { dependencies } = deps({
        rewrite: async () => {
            calls += 1;
            throw new Error('provider payload token sk_live_secret');
        },
    });
    const result = await reorderStageTasks(clientId, moveRoadmap, dependencies);
    assert.equal(calls, 1);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not move tasks' });
    assert.equal(JSON.stringify(result.body).includes('sk_live'), false);
    assert.equal(JSON.stringify(result.body).includes('token'), false);
});

test('a short rewrite is a failure, not a partial order', async () => {
    let calls = 0;
    const { dependencies } = deps({
        rewrite: async () => {
            calls += 1;
            return [];
        },
    });
    const result = await reorderStageTasks(clientId, moveRoadmap, dependencies);
    assert.equal(calls, 1);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not move tasks' });
    if (result.status === 200) assert.fail('partial tasks were returned');
});

test('changing parent pushes even when the task does not qualify for Basecamp', async () => {
    const backlogParent = '208dbc36-6666-4666-8666-666666666666';
    const { dependencies } = deps({
        load: async () => [
            ...loaded,
            task({ id: backlogParent, title: 'Citations', position: 2 }),
        ],
    });
    const pushes: string[] = [];
    dependencies.pushPlanTask = async taskId => {
        pushes.push(taskId);
    };
    const under = await reorderStageTasks(clientId, {
        taskId: robots,

        parentTaskId: backlogParent,
        index: 0,
    }, dependencies);
    assert.equal(under.status, 200);
    assert.deepEqual(pushes, [robots]);

    const same = deps();
    const samePushes: string[] = [];
    same.dependencies.pushPlanTask = async taskId => {
        samePushes.push(taskId);
    };
    const stayed = await reorderStageTasks(clientId, {
        taskId: robots,

        parentTaskId: null,
        index: 0,
    }, same.dependencies);
    assert.equal(stayed.status, 200);
    assert.deepEqual(samePushes, []);
});

test('reordering subtasks pushes the parent step order, and a top-level move does not', async () => {
    const { dependencies } = deps();
    const parents: string[] = [];
    dependencies.syncStepOrder = async parentId => {
        parents.push(parentId);
    };
    const nested = await reorderStageTasks(clientId, {
        taskId: cookies,

        parentTaskId: setup,
        index: 0,
    }, dependencies);
    assert.equal(nested.status, 200);
    assert.deepEqual(parents, [setup]);

    const top = deps();
    const topParents: string[] = [];
    top.dependencies.syncStepOrder = async parentId => {
        topParents.push(parentId);
    };
    const moved = await reorderStageTasks(clientId, {
        taskId: roadmap,

        parentTaskId: null,
        index: 0,
    }, top.dependencies);
    assert.equal(moved.status, 200);
    assert.deepEqual(topParents, []);

    const same = deps();
    const sameParents: string[] = [];
    same.dependencies.syncStepOrder = async parentId => {
        sameParents.push(parentId);
    };
    const stayed = await reorderStageTasks(clientId, {
        taskId: keywords,

        parentTaskId: setup,
        index: 0,
    }, same.dependencies);
    assert.equal(stayed.status, 200);
    assert.deepEqual(sameParents, []);
});

test('Move under pushes step order for the new parent and the old one', () => {
    const backlogParent = '208dbc36-6666-4666-8666-666666666666';
    const tasks = [
        ...loaded,
        task({ id: backlogParent, title: 'Citations', position: 2 }),
    ];
    const ids = stepOrderParentIds(tasks, {
        taskId: keywords,

        parentTaskId: backlogParent,
        index: 0,
    }, [
        { id: keywords, position: 1, parentTaskId: backlogParent },
        { id: cookies, position: 1, parentTaskId: setup },
    ]);
    assert.deepEqual(ids, [setup, backlogParent]);
    assert.deepEqual(stepOrderParentIds(loaded, {
        taskId: roadmap,

        parentTaskId: null,
        index: 0,
    }, []), []);
});
