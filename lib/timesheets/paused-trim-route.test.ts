import assert from 'node:assert/strict';
import test from 'node:test';
import { createPausedTrimPatch } from './paused-trim-route.ts';

type Deps = Parameters<typeof createPausedTrimPatch>[0];
const LOG = '22222222-2222-4222-8222-222222222222';
const FIRST = { startedAt: '2026-11-24T13:00:00Z', endedAt: '2026-11-24T14:00:00Z', note: 'First stretch' };
const LAST = { startedAt: '2026-11-24T15:00:00Z', endedAt: '2026-11-24T16:00:00Z', note: 'Last stretch' };
const NOW = '2026-11-24T17:00:00.000Z';

function world(role: string | null = 'owner', status = 'paused', botKeyId: string | null = 'bot') {
    const writes: Parameters<Deps['save']>[1][] = [];
    const authChecks: string[][] = [];
    const entry = {
        id: LOG, organizationId: 'canonical-org', botKeyId, status, startedAt: null,
        elapsedSeconds: 9000, description: 'Original', userId: 'bot-user', createdAt: FIRST.startedAt,
    };
    const log: NonNullable<Awaited<ReturnType<Deps['loadTime']>>> = {
        ...entry, botKeyId: botKeyId ?? 'bot', trimmedAt: null, previousSource: null, segments: [],
        pausedAt: LAST.endedAt, stretches: [FIRST, LAST], carriedSeconds: 1800,
    };
    const deps: Deps = {
        authenticate: async () => ({ id: 'session-user' }),
        async findLog(id) { return id === entry.id ? entry : null; },
        async membership(orgId, userId) { authChecks.push([orgId, userId]); return role; },
        async loadTime() { return log; },
        async save(_log, input) {
            writes.push(input);
            Object.assign(log, input.time, { source: input.source });
            return true;
        },
        now: () => new Date(NOW),
    };
    return {
        writes, authChecks, log, deps,
        patch: (hours: unknown) => createPausedTrimPatch(deps)(new Request('http://localhost/trim', {
            method: 'PATCH',
            body: JSON.stringify({
                hours, description: ' Corrected description ', organizationId: 'browser-org', userId: 'browser-user',
            }),
        }), LOG),
    };
}

test('paused edit removes the end, saves description and audit, and performs only a paused write', async () => {
    const { writes, authChecks, patch, log } = world();
    const response = await patch(1.25);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'paused' });
    assert.deepEqual(authChecks, [['canonical-org', 'session-user']]);
    assert.equal(log.status, 'paused');
    assert.equal(writes.length, 1);
    const [write] = writes;
    assert.equal(write.description, 'Corrected description');
    assert.equal(write.elapsedSeconds, 4500);
    assert.equal(write.hours, 1.25);
    assert.deepEqual(write.time, {
        carriedSeconds: 1800, stretches: [{ ...FIRST, endedAt: '2026-11-24T13:45:00.000Z' }],
    });
    assert.deepEqual(write.audit, { fromSeconds: 9000, at: NOW, userId: 'session-user', botKeyId: null });
});

test('admin can re-trim from the original pause and restore a removed stretch with its note', async () => {
    const { writes, patch } = world('admin');
    assert.equal((await patch(0.25)).status, 200);
    assert.deepEqual(writes[0].time, { carriedSeconds: 900, stretches: [] });
    assert.equal((await patch(2.5)).status, 200);
    assert.deepEqual(writes[1].time.stretches, [FIRST, LAST]);
    assert.equal(writes[1].audit.fromSeconds, 9000);
    const response = await patch(2.51);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, "Can't be more than the 2.5 h this timer actually ran.");
    assert.equal(writes.length, 2);
});

test('zero, negative, non-numeric and excessive hours return errors before writing', async () => {
    const { writes, patch } = world();
    for (const hours of [0, -1, '1', null]) assert.equal((await patch(hours)).status, 400);
    assert.equal((await patch(3)).status, 422);
    assert.deepEqual(writes, []);
});

test('only an owner or admin in the entry’s organization may trim, and only paused bot rows', async () => {
    for (const role of ['member', 'viewer', null]) {
        const { patch, writes } = world(role);
        assert.equal((await patch(1)).status, 403);
        assert.deepEqual(writes, []);
    }
    const signedOut = world();
    signedOut.deps.authenticate = async () => null;
    assert.equal((await signedOut.patch(1)).status, 401);
    for (const fixture of [world('owner', 'logged'), world('owner', 'in_progress'), world('owner', 'paused', null)]) {
        assert.equal((await fixture.patch(1)).status, 409);
        assert.deepEqual(fixture.writes, []);
    }
});

test('a pause changed during the edit returns a conflict', async () => {
    const { deps, patch } = world();
    deps.save = async () => false;
    assert.equal((await patch(1)).status, 409);
});

test('an authorized trim returns 503 before saving when audit columns are missing', async () => {
    for (const code of ['42703', 'PGRST204']) {
        const { deps, patch, writes } = world();
        deps.loadTime = async () => { throw { code }; };
        const response = await patch(1);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { error: 'Trim needs a database update.' });
        assert.deepEqual(writes, []);
    }
});
