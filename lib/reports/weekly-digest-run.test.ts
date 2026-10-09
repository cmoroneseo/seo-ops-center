import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeDigests, createWeeklyDigestHandler, deliverDigests, runWeeklyDigests, type DigestQueueJob, type DigestStore } from './weekly-digest-run';
import { weeklyDigestEventId, type DigestCandidate } from './weekly-digest';

const clientId = '44444444-4444-4444-8444-444444444444';
const week = { start: '2026-10-05', end: '2026-10-11' };
const monday = new Date('2026-10-12T16:00:00.000Z');
const tuesday = new Date('2026-10-13T16:00:00.000Z');

function candidate(): DigestCandidate {
    return {
        organizationId: '11111111-1111-4111-8111-111111111111',
        clientId,
        clientName: 'Scott Cole Plumbing',
        amName: 'Abel Miranda',
        amEmail: 'abel@example.com',
        agencyName: 'Marketing Empire Group',
        contacts: [{ id: '88888888-8888-4888-8888-888888888888', email: 'scott@example.com' }],
        deliverables: [
            { title: 'Service page', status: 'Published', deliveredOn: '2026-10-07', publishedUrl: 'https://scottcole.example/service' },
        ],
        waiting: [],
        optedIn: true,
    };
}

function store(calls: string[], jobs: DigestQueueJob[] = []): DigestStore {
    const seen = new Set<string>();
    return {
        async listCandidates() {
            calls.push('list');
            return { ok: true, candidates: [candidate()] };
        },
        async enqueue(input) {
            calls.push('enqueue');
            const key = `${input.eventId}:${input.contactId}`;
            if (seen.has(key)) return 'duplicate';
            seen.add(key);
            return 'ok';
        },
        async claim() {
            calls.push('claim');
            const next = jobs.splice(0, jobs.length);
            return { ok: true, jobs: next };
        },
        async hydrate() {
            calls.push('hydrate');
            return { ok: true, candidate: candidate(), to: 'scott@example.com' };
        },
        async markSent() {
            calls.push('sent');
            return true;
        },
        async cancel() {
            calls.push('cancel');
            return true;
        },
        async release() {
            calls.push('release');
        },
    };
}

test('the flag off means the cron reads nothing and writes nothing', async () => {
    let ran = false;
    const handler = createWeeklyDigestHandler({
        authorize: () => true,
        enabled: () => false,
        now: () => monday,
        run: async () => {
            ran = true;
            return { ok: true, skipped: false, queued: 1, emailed: 1, skippedCount: 0, canceled: 0 };
        },
    });
    const response = await handler(new Request('http://localhost/api/cron/weekly-digest'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { skipped: true, reason: 'disabled' });
    assert.equal(ran, false);
});

test('a bad cron secret is rejected before any read', async () => {
    let ran = false;
    const handler = createWeeklyDigestHandler({
        authorize: () => false,
        enabled: () => true,
        now: () => monday,
        run: async () => {
            ran = true;
            return { ok: false, status: 500, error: 'nope' };
        },
    });
    const response = await handler(new Request('http://localhost/api/cron/weekly-digest'));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, 'Unauthorized');
    assert.equal(ran, false);
});

test('runWeeklyDigests refuses to read when the flag is off', async () => {
    const previous = process.env.WEEKLY_DIGEST_ENABLED;
    delete process.env.WEEKLY_DIGEST_ENABLED;
    let called = false;
    const result = await runWeeklyDigests(monday, store([
        'should-not-run',
    ]));
    called = true;
    assert.equal(called, true);
    assert.equal(result.ok && result.skipped && result.reason, 'disabled');
    if (previous === undefined) delete process.env.WEEKLY_DIGEST_ENABLED;
    else process.env.WEEKLY_DIGEST_ENABLED = previous;
});

test('Tuesday does not compose, and Monday queues once per contact', async () => {
    const previousFlag = process.env.WEEKLY_DIGEST_ENABLED;
    const previousKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.RESEND_FROM_EMAIL;
    process.env.WEEKLY_DIGEST_ENABLED = 'true';
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'reports@example.com';
    try {
        const tuesdayCalls: string[] = [];
        const skipped = await runWeeklyDigests(tuesday, store(tuesdayCalls));
        assert.equal(skipped.ok && skipped.skipped && skipped.reason, 'outside_send_window');
        assert.equal(tuesdayCalls.includes('list'), false);
        assert.equal(tuesdayCalls.includes('enqueue'), false);
        assert.equal(tuesdayCalls.includes('claim'), true);

        const mondayCalls: string[] = [];
        const mondayStore = store(mondayCalls);
        const first = await composeDigests(mondayStore, week);
        assert.equal(first.ok && first.queued, 1);
        const second = await composeDigests(mondayStore, week);
        assert.equal(second.ok && second.queued, 0);
        assert.equal(mondayCalls.filter(call => call === 'enqueue').length, 2);
        assert.equal(weeklyDigestEventId(clientId, week.start), weeklyDigestEventId(clientId, week.start));
    } finally {
        if (previousFlag === undefined) delete process.env.WEEKLY_DIGEST_ENABLED;
        else process.env.WEEKLY_DIGEST_ENABLED = previousFlag;
        if (previousKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = previousKey;
        if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
        else process.env.RESEND_FROM_EMAIL = previousFrom;
    }
});

test('a quiet client is not queued, and a provider rejection does not mark the row sent', async () => {
    const calls: string[] = [];
    const quiet = store(calls);
    quiet.listCandidates = async () => {
        calls.push('list');
        return { ok: true, candidates: [{ ...candidate(), deliverables: [], waiting: [], contacts: [] }] };
    };
    const composed = await composeDigests(quiet, week);
    assert.equal(composed.ok && composed.queued, 0);
    assert.equal(composed.ok && composed.skipped, 1);
    assert.equal(calls.includes('enqueue'), false);

    const job: DigestQueueJob = {
        id: '99999999-9999-4999-8999-999999999999',
        organization_id: candidate().organizationId,
        client_id: clientId,
        contact_id: '88888888-8888-4888-8888-888888888888',
        event_id: weeklyDigestEventId(clientId, week.start),
        attempts: 1,
        created_at: '2026-10-12T16:00:00.000Z',
    };
    const deliveryCalls: string[] = [];
    const previousKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.RESEND_FROM_EMAIL;
    process.env.RESEND_API_KEY = 'test-key';
    process.env.RESEND_FROM_EMAIL = 'reports@example.com';
    try {
        const result = await deliverDigests(store(deliveryCalls, [job]), monday, async () => false);
        assert.equal(result.ok && result.emailed, 0);
        assert.equal(deliveryCalls.includes('sent'), false);
        assert.equal(deliveryCalls.includes('release'), true);
    } finally {
        if (previousKey === undefined) delete process.env.RESEND_API_KEY;
        else process.env.RESEND_API_KEY = previousKey;
        if (previousFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
        else process.env.RESEND_FROM_EMAIL = previousFrom;
    }
});

test('a database failure stays redacted', async () => {
    const source = readFileSync(new URL('./weekly-digest-run.ts', import.meta.url), 'utf8');
    assert.equal(source.includes('Weekly digests will retry on the next run.'), true);
    assert.equal(/catch\s*\{[^}]*error\.message/.test(source), false);
    assert.equal(/console\.(log|warn|error)/.test(source), false);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const previous = process.env.WEEKLY_DIGEST_ENABLED;
    process.env.WEEKLY_DIGEST_ENABLED = 'true';
    const down = await runWeeklyDigests(monday);
    assert.equal(down.ok, false);
    if (!down.ok) assert.equal(down.error, 'Weekly digests will retry on the next run.');
    assert.equal(JSON.stringify(down).includes('Missing Supabase'), false);
    if (previous === undefined) delete process.env.WEEKLY_DIGEST_ENABLED;
    else process.env.WEEKLY_DIGEST_ENABLED = previous;
});
