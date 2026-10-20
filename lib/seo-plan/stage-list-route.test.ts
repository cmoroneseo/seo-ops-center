import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionOrganization } from '../reports/session-org.ts';
import { readClientStageList, type StageListReadDependencies } from './stage-list-route.ts';
import type { StageListTask } from './stage-list.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';

const task: StageListTask = {
    id: 'setup',
    title: 'SEO Setup',
    status: 'todo',
    stage: 'onboarding',
    position: 1,
    parentTaskId: null,
    createdAt: '2026-01-02T00:00:00.000Z',
    category: null,
    basecamp: false,
    recurring: false,
};

function deps(overrides: Partial<StageListReadDependencies> = {}): StageListReadDependencies & { loads: string[] } {
    const loads: string[] = [];
    return {
        loads,
        session: async () => ({ ok: true, userId: 'user-1', organizationId: org, role: 'member' }),
        enabled: () => true,
        load: async (organizationId, id) => {
            loads.push(`${organizationId}:${id}`);
            return [task];
        },
        ...overrides,
    };
}

test('a malformed client id never reads tasks', async () => {
    const dependencies = deps();
    const result = await readClientStageList('not-a-uuid', dependencies);
    assert.equal(result.status, 400);
    assert.equal(dependencies.loads.length, 0);
    assert.equal(JSON.stringify(result.body).includes('not-a-uuid'), false);
});

test('an anonymous session never reads tasks', async () => {
    let enabledCalls = 0;
    const dependencies = deps({
        session: async (): Promise<SessionOrganization> => ({ ok: false, status: 401, error: 'Unauthorized' }),
        enabled: () => {
            enabledCalls += 1;
            return true;
        },
    });
    const result = await readClientStageList(clientId, dependencies);
    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: 'Unauthorized' });
    assert.equal(enabledCalls, 0);
    assert.equal(dependencies.loads.length, 0);
});

test('a flag that is off does not read tasks', async () => {
    const dependencies = deps({ enabled: organizationId => organizationId === other });
    const result = await readClientStageList(clientId, dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'Not found' });
    assert.equal(dependencies.loads.length, 0);
});

test('the load uses the session organization, not a caller-supplied one', async () => {
    const dependencies = deps();
    const result = await readClientStageList(` ${clientId.toUpperCase()} `, dependencies);
    assert.equal(result.status, 200);
    if (result.status !== 200) return;
    assert.deepEqual(result.body.tasks, [task]);
    assert.deepEqual(dependencies.loads, [`${org}:${clientId.toUpperCase()}`]);
    assert.equal(dependencies.loads.some(load => load.startsWith(other)), false);
});

test('a client outside the session organization is not found', async () => {
    const dependencies = deps({
        load: async () => null,
    });
    const result = await readClientStageList(clientId, dependencies);
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'Not found' });
});

test('the account id is only a read-only link hint', async () => {
    const present = await readClientStageList(clientId, deps({ basecampAccountId: ' 4242 ' }));
    assert.equal(present.status, 200);
    if (present.status === 200) assert.equal(present.body.basecampAccountId, '4242');
    const absent = await readClientStageList(clientId, deps({ basecampAccountId: '  ' }));
    assert.equal(absent.status, 200);
    if (absent.status === 200) assert.equal(absent.body.basecampAccountId, null);
});

test('a read failure does not return the underlying message', async () => {
    const dependencies = deps({
        load: async () => {
            throw new Error('provider payload token sk_live_secret');
        },
    });
    const result = await readClientStageList(clientId, dependencies);
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { error: 'Could not load tasks' });
    assert.equal(JSON.stringify(result.body).includes('sk_live'), false);
    assert.equal(JSON.stringify(result.body).includes('token'), false);
});
