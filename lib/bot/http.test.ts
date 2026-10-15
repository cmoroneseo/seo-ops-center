import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBotMetric, type BotAuditEvent, type BotHandlerDeps } from './http';
import { authorizeBotToken, type BotTokenRecord } from './auth';
import { generateBotToken, hashBotToken, botTokenMatches } from './token';
import { parseBotQuery } from './query';
import { aggregateGa4, aggregateGsc, chooseProperty } from './aggregate';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-15T12:00:00.000Z');

function record(overrides: Partial<BotTokenRecord> = {}): BotTokenRecord {
    return {
        id: '55555555-5555-4555-8555-555555555555',
        organizationId: ORG,
        tokenHash: '',
        scopes: ['ga4.read', 'gsc.read'],
        clientIds: [],
        expiresAt: '2027-01-01T00:00:00.000Z',
        revokedAt: null,
        rateLimitPerMinute: 2,
        ...overrides,
    };
}

function deps(token: ReturnType<typeof generateBotToken>, row = record({ tokenHash: token.hash })): {
    audits: BotAuditEvent[];
    loads: string[];
    deps: BotHandlerDeps;
} {
    const audits: BotAuditEvent[] = [];
    const loads: string[] = [];
    return {
        audits,
        loads,
        deps: {
            now: () => NOW,
            async findToken(prefix) {
                return prefix === token.prefix ? row : null;
            },
            async consumeQuota() {
                return { allowed: true, limit: 2, remaining: 1, retryAfterSeconds: 0 };
            },
            async audit(event) {
                audits.push(event);
            },
            async findClient(organizationId, clientId) {
                if (organizationId === ORG && clientId === CLIENT) return { id: CLIENT };
                return null;
            },
            async loadGa4() {
                loads.push('ga4');
                return {
                    configuredProperty: 'properties/15',
                    rows: [
                        { day: '2026-10-14', property: 'properties/15', organicSessions: 2, sessions: 5, engagedSessions: 1, keyEvents: null },
                        { day: '2026-10-15', property: 'properties/15', organicSessions: 3, sessions: null, engagedSessions: 1, keyEvents: 4 },
                        { day: '2026-10-15', property: 'properties/99', organicSessions: 100, sessions: 100, engagedSessions: 100, keyEvents: 100 },
                    ],
                };
            },
            async loadGsc() {
                loads.push('gsc');
                return {
                    configuredProperty: 'sc-domain:example.com',
                    rows: [
                        { day: '2026-10-14', property: 'sc-domain:example.com', clicks: 1, impressions: 10, position: 4 },
                        { day: '2026-10-15', property: 'sc-domain:example.com', clicks: 1, impressions: 30, position: 2 },
                    ],
                };
            },
            async readLiveGa4() {
                loads.push('live-ga4');
                return { ok: true, property: 'properties/15', totals: { organicSessions: 1, sessions: 2, engagedSessions: 1, keyEvents: 0 } };
            },
            async readLiveGsc() {
                loads.push('live-gsc');
                return { ok: true, property: 'sc-domain:example.com', totals: { clicks: 1, impressions: 2, ctr: 0.5, position: 3 } };
            },
        },
    };
}

function call(route: 'ga4' | 'gsc', token: string, query: string, handlerDeps: BotHandlerDeps) {
    return handleBotMetric(route, new Request(`https://app.example/api/bot/${route}?${query}`, {
        headers: { authorization: `Bearer ${token}` },
    }), handlerDeps);
}

test('a matching hash accepts and a mismatch or short hash rejects', () => {
    const issued = generateBotToken();
    assert.equal(botTokenMatches(issued.token, issued.hash), true);
    assert.equal(botTokenMatches(issued.token, hashBotToken('socbot_aaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')), false);
    assert.equal(botTokenMatches(issued.token, 'abc'), false);
    const ok = authorizeBotToken({
        authorizationHeader: `Bearer ${issued.token}`,
        record: record({ tokenHash: issued.hash }),
        now: NOW,
        scope: 'ga4.read',
    });
    assert.equal(ok.ok, true);
    const missed = authorizeBotToken({
        authorizationHeader: `Bearer ${issued.token}`,
        record: null,
        now: NOW,
        scope: 'ga4.read',
    });
    assert.equal(missed.ok, false);
    if (!missed.ok) assert.equal(missed.tokenId, null);
});

test('stored GA4 is org scoped, audited, and omits the bearer', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    const response = await call('ga4', issued.token, `clientId=${CLIENT}&range=7d`, harness.deps);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'stored');
    assert.equal(body.property, 'properties/15');
    assert.equal(body.totals.organicSessions, 5);
    assert.equal(body.totals.sessions, 5);
    assert.equal(body.totals.keyEvents, 4);
    assert.equal(body.expectedDays, 7);
    assert.equal(body.coverageDays, 2);
    assert.equal(body.incomplete, true);
    assert.equal(harness.loads.join(), 'ga4');
    assert.equal(harness.audits[0]?.status, 200);
    assert.equal(harness.audits[0]?.organizationId, ORG);
    assert.equal(harness.audits[0]?.clientId, CLIENT);
    const secret = issued.token.slice(`socbot_${issued.prefix}_`.length);
    assert.equal(secret.length, 43);
    assert.equal(JSON.stringify(harness.audits).includes(secret), false);
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(body).includes('access_token'), false);
});

test('a token cannot read a client outside its organization', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    const response = await call('gsc', issued.token, `clientId=${OTHER}&start=2026-10-01&end=2026-10-02`, harness.deps);
    assert.equal(response.status, 404);
    assert.deepEqual(harness.loads, []);
    assert.equal(harness.audits[0]?.errorCode, 'client_not_found');
    assert.equal(harness.audits[0]?.clientId, null);
});

test('an allowlist blocks clients in the same organization', async () => {
    const issued = generateBotToken();
    const harness = deps(issued, record({ tokenHash: issued.hash, clientIds: [OTHER] }));
    const response = await call('ga4', issued.token, `clientId=${CLIENT}&range=7d`, harness.deps);
    assert.equal(response.status, 403);
    assert.equal(harness.audits[0]?.errorCode, 'client_not_allowed');
    assert.equal(harness.audits[0]?.clientId, CLIENT);
    assert.deepEqual(harness.loads, []);
});

test('rate limit is audited and does not load metrics', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    harness.deps.consumeQuota = async () => ({ allowed: false, limit: 2, remaining: 0, retryAfterSeconds: 17 });
    const response = await call('gsc', issued.token, `clientId=${CLIENT}&range=28d`, harness.deps);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '17');
    assert.equal(harness.audits[0]?.errorCode, 'rate_limited');
    assert.deepEqual(harness.loads, []);
    const body = await response.json();
    assert.equal(body.retryAfterSeconds, 17);
});

test('validation rejects mixed ranges, bad dates, and oversized spans', async () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    assert.equal(parseBotQuery(new URL('https://app.example/api/bot/ga4?clientId=nope'), now).ok, false);
    assert.equal(parseBotQuery(new URL(`https://app.example/api/bot/ga4?clientId=${CLIENT}&range=7d&start=2026-10-01`), now).ok, false);
    assert.equal(parseBotQuery(new URL(`https://app.example/api/bot/ga4?clientId=${CLIENT}&start=2026-02-31&end=2026-03-01`), now).ok, false);
    assert.equal(parseBotQuery(new URL(`https://app.example/api/bot/ga4?clientId=${CLIENT}&start=2025-01-01&end=2026-10-15`), now).ok, false);
    assert.equal(parseBotQuery(new URL(`https://app.example/api/bot/ga4?clientId=${CLIENT}&start=2026-10-16&end=2026-10-16`), now).ok, false);
    const ok = parseBotQuery(new URL(`https://app.example/api/bot/gsc?clientId=${CLIENT}&range=28d`), now);
    assert.equal(ok.ok, true);
    if (ok.ok) {
        assert.equal(ok.query.end, '2026-10-15');
        assert.equal(ok.query.start, '2026-09-18');
        assert.equal(ok.query.source, 'stored');
    }
    const issued = generateBotToken();
    const harness = deps(issued);
    const response = await call('ga4', issued.token, `clientId=${CLIENT}&range=7d&source=stored&extra=1`, harness.deps);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.issues[0].message, 'Unknown parameter');
    assert.equal(JSON.stringify(body).includes('extra'), false);
    assert.equal(harness.audits[0]?.errorCode, 'invalid_query');
});

test('revoked, expired, and wrong-scope tokens are refused before a read', async () => {
    const issued = generateBotToken();
    const revoked = deps(issued, record({ tokenHash: issued.hash, revokedAt: '2026-10-01T00:00:00.000Z' }));
    assert.equal((await call('ga4', issued.token, `clientId=${CLIENT}&range=7d`, revoked.deps)).status, 401);
    assert.equal(revoked.audits[0]?.errorCode, 'revoked');
    const expired = deps(issued, record({ tokenHash: issued.hash, expiresAt: '2026-10-01T00:00:00.000Z' }));
    assert.equal((await call('gsc', issued.token, `clientId=${CLIENT}&range=7d`, expired.deps)).status, 401);
    assert.equal(expired.audits[0]?.errorCode, 'expired');
    const scoped = deps(issued, record({ tokenHash: issued.hash, scopes: ['gsc.read'] }));
    assert.equal((await call('ga4', issued.token, `clientId=${CLIENT}&range=7d`, scoped.deps)).status, 403);
    assert.deepEqual(revoked.loads, []);
    assert.deepEqual(expired.loads, []);
    assert.deepEqual(scoped.loads, []);
});

test('live reads do not echo the Google bearer', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    const secret = 'ya29.live-secret';
    harness.deps.readLiveGsc = async () => ({
        ok: true,
        property: 'sc-domain:example.com',
        totals: { clicks: 1, impressions: 4, ctr: 0.25, position: 2.5 },
    });
    const response = await call('gsc', issued.token, `clientId=${CLIENT}&range=7d&source=live`, harness.deps);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.source, 'live');
    assert.equal(body.granularity, 'range');
    assert.equal(JSON.stringify(body).includes(secret), false);
    assert.equal(JSON.stringify(harness.audits).includes(secret), false);
});

test('stored Search Console position is weighted by impressions', () => {
    const rolled = aggregateGsc([
        { day: '2026-10-14', property: 'sc-domain:example.com', clicks: 1, impressions: 10, position: 4 },
        { day: '2026-10-15', property: 'sc-domain:example.com', clicks: 1, impressions: 30, position: 2 },
    ]);
    assert.equal(rolled.totals.clicks, 2);
    assert.equal(rolled.totals.impressions, 40);
    assert.equal(rolled.totals.position, 2.5);
    assert.equal(rolled.totals.ctr, 0.05);
    assert.equal(aggregateGa4([]).totals.sessions, null);
    assert.deepEqual(chooseProperty(['properties/1', 'properties/2'], null), { ok: false });
    assert.deepEqual(chooseProperty(['properties/1', 'properties/2'], 'properties/1'), { ok: true, property: 'properties/1' });
});

test('a store failure is audited and returns no metrics', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    harness.deps.findClient = async () => {
        throw new Error('database unavailable');
    };
    const response = await call('ga4', issued.token, `clientId=${CLIENT}&range=7d`, harness.deps);
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(body.error, 'Request failed');
    assert.equal(body.totals, undefined);
    assert.equal(harness.audits[0]?.status, 500);
    assert.equal(harness.audits[0]?.errorCode, 'internal');
    assert.equal(harness.audits[0]?.clientId, CLIENT);
    assert.equal(harness.audits[0]?.tokenId, '55555555-5555-4555-8555-555555555555');
});

test('a bad bearer is audited without a token id', async () => {
    const issued = generateBotToken();
    const harness = deps(issued);
    const response = await handleBotMetric('ga4', new Request(`https://app.example/api/bot/ga4?clientId=${CLIENT}&range=7d`, {
        headers: { authorization: 'Bearer not-a-bot-token' },
    }), harness.deps);
    assert.equal(response.status, 401);
    assert.equal(harness.audits[0]?.tokenId, null);
    assert.equal(harness.audits[0]?.errorCode, 'invalid_token');
    assert.equal(JSON.stringify(harness.audits).includes('not-a-bot-token'), false);
});
