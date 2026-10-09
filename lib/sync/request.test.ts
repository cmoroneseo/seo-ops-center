import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeSyncRequest } from './request';

const id = 'ab3ea11c-787a-46e7-acd0-3713cf813d88';
const now = new Date('2026-09-10T12:00:00Z');
const allow = async () => ({ ok: true as const, organizationId: 'org-a', clientId: id });
const post = (body: unknown, token?: string) => new Request('https://app.test/api/sync/metrics', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: token ? { authorization: `Bearer ${token}` } : {},
});

test('cron bearer can run globally without dashboard cookies', async () => {
    const result = await authorizeSyncRequest(
        new Request('https://app.test/api/sync/metrics', { headers: { authorization: 'Bearer secret' } }),
        'secret',
        async () => { throw new Error('must not request session'); },
        now,
    );
    assert.equal(result.organizationId, undefined);
    assert.equal(result.month, '2026-09');
    assert.deepEqual(result.months, ['2026-09']);
    assert.equal(result.trigger, 'cron');
});

test('missing or wrong cron secret rejects GET even with an authorized session', async () => {
    for (const secret of [undefined, 'secret']) {
        await assert.rejects(
            authorizeSyncRequest(new Request('https://app.test/api/sync/metrics'), secret, allow, now),
            { status: 401 },
        );
    }
});

test('manual sync cannot request all clients or cross tenant boundaries', async () => {
    await assert.rejects(authorizeSyncRequest(post({}), 'secret', allow, now), { status: 400 });
    await assert.rejects(
        authorizeSyncRequest(post({ clientId: id }), 'secret', async () => ({ ok: false, status: 403, error: 'Forbidden' }), now),
        { status: 403 },
    );
    assert.deepEqual(await authorizeSyncRequest(post({ clientId: id }), 'secret', allow, now), {
        clientId: id,
        month: '2026-09',
        months: ['2026-09'],
        organizationId: 'org-a',
        trigger: 'manual',
    });
});

test('reject invalid and future months before running sync', async () => {
    for (const month of ['2026-13', '2026-10', 'garbage']) {
        await assert.rejects(authorizeSyncRequest(post({ clientId: id, month }), 'secret', allow, now), { status: 400 });
    }
});

test('the default month is the Pacific month, including just before daylight saving ends', async () => {
    const early = new Date('2026-11-01T06:30:00Z');
    const result = await authorizeSyncRequest(post({ clientId: id }), 'secret', allow, early);
    assert.equal(result.month, '2026-10');
    assert.deepEqual(result.months, ['2026-10']);
    assert.equal(result.trigger, 'manual');
});

test('a cron without a month re-syncs the previous month through Pacific day 7', async () => {
    const cron = (at: string) => authorizeSyncRequest(
        new Request('https://app.test/api/sync/metrics', { headers: { authorization: 'Bearer secret' } }),
        'secret',
        async () => { throw new Error('must not request session'); },
        new Date(at),
    );
    assert.deepEqual((await cron('2026-11-03T18:00:00Z')).months, ['2026-11', '2026-10']);
    assert.deepEqual((await cron('2026-11-07T20:00:00Z')).months, ['2026-11', '2026-10']);
    assert.deepEqual((await cron('2026-11-08T20:00:00Z')).months, ['2026-11']);
    assert.deepEqual((await cron('2026-11-09T18:00:00Z')).months, ['2026-11']);
});

test('an explicit cron month is not expanded to the previous month', async () => {
    const result = await authorizeSyncRequest(
        post({ month: '2026-08' }, 'secret'),
        'secret',
        async () => { throw new Error('must not request session'); },
        new Date('2026-11-03T18:00:00Z'),
    );
    assert.deepEqual(result.months, ['2026-08']);
    assert.equal(result.trigger, 'cron');
});
