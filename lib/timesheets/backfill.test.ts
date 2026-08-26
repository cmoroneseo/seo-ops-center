import test from 'node:test';
import assert from 'node:assert/strict';
import { createCsvBackfill, type BackfillDependencies } from './backfill.ts';
import type { ImportedEntryInput } from '../basecamp/timesheet-webhook-route.ts';

const HEADER = 'Date,Person,Hours,Project,Item,Notes,Created';
const CSV = [
    HEADER,
    '2026-08-06,Abel Miranda,4.5,Scott Cole Plumbing,,"",2026-08-07T19:51:38Z',
    '2026-08-07,Abel Miranda,1.0,Marketing Empire Group HQ,,"",2026-08-07T19:51:46Z',
    '2026-08-06,Abel Miranda,0.4,Superior Patios,,"",2026-08-07T19:51:28Z',
    '2026-08-01,Abel Miranda,2.0,Dead Project,,"",2026-08-01T10:00:00Z',
].join('\n');

function harness(options: { csv?: string | 'unavailable'; manager?: boolean } = {}) {
    const written: ImportedEntryInput[] = [];
    const runs: { id: string; patch: Record<string, unknown> }[] = [];

    const dependencies: BackfillDependencies = {
        now: () => '2026-08-25T12:00:00Z',
        async authorize() {
            return options.manager === false
                ? { ok: false, status: 403, error: 'Forbidden' }
                : {
                    ok: true,
                    organizationId: 'org-1',
                    actorUserId: 'user-carlos',
                    targetUserId: 'user-abel',
                    basecampPersonId: '39146116',
                };
        },
        async listProjectRoles() {
            return [
                { basecampProjectId: '38327950', basecampProjectName: 'Scott Cole Plumbing', role: 'client', clientId: 'client-scott' },
                { basecampProjectId: '27062278', basecampProjectName: 'Marketing Empire Group HQ', role: 'internal', clientId: null },
                { basecampProjectId: '99999999', basecampProjectName: 'Dead Project', role: 'ignored', clientId: null },
            ];
        },
        async fetchCsv() {
            return options.csv ?? CSV;
        },
        async startRun() { return { id: 'run-1' }; },
        async finishRun(id, patch) { runs.push({ id, patch }); },
        async upsertImportedEntry(input) {
            written.push(input);
            return 'created';
        },
    };

    return { written, runs, backfill: createCsvBackfill(dependencies) };
}

const request = { userId: 'user-abel', from: '2026-08-01', to: '2026-08-31' };

test('a client project imports against its client', async () => {
    const { backfill, written } = harness();
    const outcome = await backfill(request);

    assert.equal(outcome.status, 200);
    const scott = written.find(entry => entry.hours === 4.5);
    assert.equal(scott?.clientId, 'client-scott');
    assert.equal(scott?.importStatus, 'needs_context');
    assert.equal(scott?.userId, 'user-abel');
});

test('an internal project imports with no client', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    const hq = written.find(entry => entry.hours === 1);
    assert.equal(hq?.clientId, null);
    assert.equal(hq?.importStatus, 'needs_context');
});

test('an unknown project still imports, for a human decision', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    const patios = written.find(entry => entry.hours === 0.4);
    assert.ok(patios, 'unknown project must not be silently dropped');
    assert.equal(patios.clientId, null);
});

test('an ignored project is skipped', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    assert.equal(written.find(entry => entry.hours === 2), undefined);
});

test('every imported row carries a fingerprint and no entry id', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    for (const entry of written) {
        assert.match(entry.importFingerprint ?? '', /^[0-9a-f]{32}$/);
        assert.equal(entry.basecampEntryId, '');
    }
});

test('the run receipt records scanned, imported, and skipped', async () => {
    const { backfill, runs } = harness();
    await backfill(request);

    assert.deepEqual(runs[0].patch, {
        status: 'complete', scanned: 4, imported: 3, skipped: 1, error: null,
    });
});

test('a non-manager never reaches Basecamp', async () => {
    const { backfill, written } = harness({ manager: false });
    const outcome = await backfill(request);

    assert.equal(outcome.status, 403);
    assert.deepEqual(written, []);
});

test('a malformed range is rejected before any work', async () => {
    const { backfill, written } = harness();

    assert.equal((await backfill({ ...request, from: 'August' })).status, 400);
    assert.equal((await backfill({ ...request, to: '2026-07-01' })).status, 400);
    assert.deepEqual(written, []);
});

test('a provider outage fails the run rather than reporting success', async () => {
    const { backfill, runs } = harness({ csv: 'unavailable' });
    const outcome = await backfill(request);

    assert.equal(outcome.status, 503);
    assert.equal(runs[0].patch.status, 'failed');
});

test('re-running is safe because identity comes from the fingerprint', async () => {
    const { backfill, written } = harness();
    await backfill(request);
    await backfill(request);

    const fingerprints = written.map(entry => entry.importFingerprint);
    assert.equal(new Set(fingerprints).size, 3);
    assert.equal(written.length, 6);
});
