import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeSyncRequest } from './request';
const id = 'ab3ea11c-787a-46e7-acd0-3713cf813d88';
const now = new Date('2026-09-10T12:00:00Z');
const allow = async () => ({ ok: true as const, organizationId: 'org-a', clientId: id });
const post = (body: unknown, token?: string) => new Request('https://app.test/api/sync/metrics', { method: 'POST', body: JSON.stringify(body), headers: token ? { authorization: `Bearer ${token}` } : {} });
test('cron bearer can run globally without dashboard cookies', async () => {
    const result = await authorizeSyncRequest(new Request('https://app.test/api/sync/metrics', { headers: { authorization: 'Bearer secret' } }), 'secret', async () => { throw new Error('must not request session'); }, now);
    assert.equal(result.organizationId, undefined); assert.equal(result.month, '2026-09');
});
test('missing or wrong cron secret rejects GET even with an authorized session', async () => {
    for (const secret of [undefined, 'secret']) await assert.rejects(authorizeSyncRequest(new Request('https://app.test/api/sync/metrics'), secret, allow, now), {status:401});
});
test('manual sync cannot request all clients or cross tenant boundaries', async () => {
    await assert.rejects(authorizeSyncRequest(post({}), 'secret', allow, now), {status:400});
    await assert.rejects(authorizeSyncRequest(post({clientId:id}), 'secret', async () => ({ok:false, status:403,error:'Forbidden'}), now), {status:403});
    assert.deepEqual(await authorizeSyncRequest(post({clientId:id}), 'secret', allow, now), {clientId:id,month:'2026-09',organizationId:'org-a'});
});
test('reject invalid and future months before running sync', async () => {
    for (const month of ['2026-13','2026-10','garbage']) await assert.rejects(authorizeSyncRequest(post({clientId:id,month}), 'secret', allow, now), {status:400});
});
