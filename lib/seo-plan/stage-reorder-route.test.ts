import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionOrganization } from '../reports/session-org.ts';
import { reorderStageTasks, type StageReorderDependencies } from './stage-reorder-route.ts';
import type { StageReorderWrite } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
const userId = 'user-1';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'onboarding',
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
    task({ id: '208dbc36-5555-4555-8555-555555555555', title: 'Review robots.txt', stage: 'backlog', position: 1 }),
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
                    stage: write.stage,
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
    stage: 'backlog',
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
    assert.equal(byId.get(roadmap)?.stage, 'backlog');
    assert.equal(byId.get(roadmap)?.position, 1);
    assert.equal(byId.get(roadmap)?.parentTaskId, null);
    assert.equal(byId.has(setup), false);
    assert.equal(byId.get(robots)?.position, 2);
    assert.equal(byId.get(robots)?.stage, 'backlog');
    assert.equal(result.body.tasks.find(item => item.id === roadmap)?.stage, 'backlog');
    assert.equal(JSON.stringify(calls.writes).includes(other), false);
    assert.equal(JSON.stringify(calls.writes).includes('"position":99'), false);
});

test('moving a pillar rewrites its subtasks in the same call', async () => {
    const { dependencies, calls } = deps();
    const result = await reorderStageTasks(clientId, {
        taskId: setup,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
    }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(calls.writes.length, 1);
    const byId = new Map(calls.writes[0].writes.map(write => [write.id, write]));
    assert.equal(byId.get(setup)?.stage, 'backlog');
    assert.equal(byId.get(keywords)?.stage, 'backlog');
    assert.equal(byId.get(keywords)?.parentTaskId, setup);
    assert.equal(byId.get(cookies)?.stage, 'backlog');
    assert.equal(byId.get(cookies)?.parentTaskId, setup);
    assert.equal(byId.get(cookies)?.position, 2);
    assert.equal(byId.get(roadmap)?.position, 1);
    assert.equal(byId.get(roadmap)?.stage, 'onboarding');
});

test('nesting and un-nesting are decided by the server, one level deep', async () => {
    const nest = deps();
    const nested = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
        parentTaskId: setup,
        index: 9,
        position: 1,
    }, nest.dependencies);
    assert.equal(nested.status, 200);
    assert.equal(nest.calls.writes.length, 1);
    const robotsWrite = nest.calls.writes[0].writes.find(write => write.id === robots);
    assert.equal(robotsWrite?.parentTaskId, setup);
    assert.equal(robotsWrite?.stage, 'onboarding');
    assert.equal(robotsWrite?.position, 3);

    const tooDeep = deps();
    const rejected = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'onboarding',
        parentTaskId: keywords,
        index: 0,
    }, tooDeep.dependencies);
    assert.equal(rejected.status, 400);
    assert.deepEqual(rejected.body, { error: 'Tasks can only nest one level deep' });
    assert.equal(tooDeep.calls.writes.length, 0);

    const pillar = deps();
    const nestedPillar = await reorderStageTasks(clientId, {
        taskId: setup,
        stage: 'backlog',
        parentTaskId: robots,
        index: 0,
    }, pillar.dependencies);
    assert.equal(nestedPillar.status, 400);
    assert.deepEqual(nestedPillar.body, { error: 'A pillar moves with its subtasks and cannot be nested' });
    assert.equal(pillar.calls.writes.length, 0);
});

test('a no-op does not write, and a missing task or client is not found', async () => {
    const same = deps();
    const unchanged = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
    }, same.dependencies);
    assert.equal(unchanged.status, 200);
    if (unchanged.status === 200) assert.deepEqual(unchanged.body.tasks, []);
    assert.equal(same.calls.writes.length, 0);

    const missingTask = deps();
    const taskResult = await reorderStageTasks(clientId, {
        taskId: '99999999-9999-4999-8999-999999999999',
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
    }, missingTask.dependencies);
    assert.equal(taskResult.status, 404);
    assert.equal(missingTask.calls.writes.length, 0);

    const missingClient = deps({ load: async () => null });
    const clientResult = await reorderStageTasks(clientId, moveRoadmap, missingClient.dependencies);
    assert.equal(clientResult.status, 404);
    assert.equal(missingClient.calls.writes.length, 0);
});

test('a rejected move never writes', async () => {
    const { dependencies, calls } = deps();
    const bad = await reorderStageTasks(clientId, { taskId: robots, stage: 'month_9', parentTaskId: null, index: 0 }, dependencies);
    const fractional = await reorderStageTasks(clientId, { taskId: robots, stage: 'backlog', parentTaskId: null, index: 1.5 }, dependencies);
    assert.equal(bad.status, 400);
    assert.equal(fractional.status, 400);
    assert.equal(calls.loads.length, 0);
    assert.equal(calls.writes.length, 0);
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

test('a dragged due date is stored and pushed, and a bad date is refused', async () => {
    const dated = deps();
    const dues: { taskId: string; dueDate: string | null }[] = [];
    const pushes: string[] = [];
    dated.dependencies.setDue = async (_organizationId, _clientId, taskId, dueDate) => {
        dues.push({ taskId, dueDate });
    };
    dated.dependencies.pushPlanTask = async taskId => {
        pushes.push(taskId);
    };
    const result = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
        dueDate: '2026-10-31',
    }, dated.dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.equal(dated.calls.writes.length, 0);
    assert.deepEqual(dues, [{ taskId: robots, dueDate: '2026-10-31' }]);
    assert.deepEqual(pushes, [robots]);
    assert.equal(result.body.tasks.find(item => item.id === robots)?.dueDate, '2026-10-31');

    const cleared = deps();
    const clears: Array<string | null> = [];
    const clearPushes: string[] = [];
    cleared.dependencies.setDue = async (_organizationId, _clientId, _taskId, dueDate) => {
        clears.push(dueDate);
    };
    cleared.dependencies.pushPlanTask = async taskId => {
        clearPushes.push(taskId);
    };
    const clear = await reorderStageTasks(clientId, {
        taskId: roadmap,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
        dueDate: null,
    }, cleared.dependencies);
    assert.equal(clear.status, 200);
    if (clear.status === 200) assert.equal(clear.body.tasks.find(item => item.id === roadmap)?.dueDate, null);
    assert.deepEqual(clears, [null]);
    assert.deepEqual(clearPushes, []);

    const onboarded = deps();
    const onboardPushes: string[] = [];
    onboarded.dependencies.pushPlanTask = async taskId => {
        onboardPushes.push(taskId);
    };
    const leftBacklog = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'onboarding',
        parentTaskId: null,
        index: 0,
    }, onboarded.dependencies);
    assert.equal(leftBacklog.status, 200);
    assert.deepEqual(onboardPushes, [robots]);

    const invalid = deps();
    let setCalls = 0;
    invalid.dependencies.setDue = async () => { setCalls += 1; };
    const refused = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
        dueDate: 'October 31',
    }, invalid.dependencies);
    assert.equal(refused.status, 400);
    assert.equal(invalid.calls.loads.length, 0);
    assert.equal(setCalls, 0);

    const missing = deps();
    const blocked = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
        dueDate: '2026-10-31',
    }, missing.dependencies);
    assert.equal(blocked.status, 500);
    assert.equal(missing.calls.writes.length, 0);
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
            task({ id: backlogParent, title: 'Citations', stage: 'backlog', position: 2 }),
        ],
    });
    const pushes: string[] = [];
    dependencies.pushPlanTask = async taskId => {
        pushes.push(taskId);
    };
    const under = await reorderStageTasks(clientId, {
        taskId: robots,
        stage: 'backlog',
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
        stage: 'backlog',
        parentTaskId: null,
        index: 0,
    }, same.dependencies);
    assert.equal(stayed.status, 200);
    assert.deepEqual(samePushes, []);
});
