import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTimesheetReconciler,
    type ReconcileDependencies,
    type ReconcileProviderEntry,
} from './timesheet-reconcile.ts';

const ACCOUNT = '5338018';

function entry(id: string, date: string): ReconcileProviderEntry {
    return { id, date };
}

function harness(options: {
    entries?: ReconcileProviderEntry[] | 'unavailable';
    authorized?: { organizationId: string; projectId: string } | { status: number; error: string };
    maxRangeDays?: number;
} = {}) {
    const imported: string[] = [];
    const authorized = options.authorized ?? { organizationId: 'org-1', projectId: '48599958' };

    const dependencies: ReconcileDependencies = {
        expectedAccountId: ACCOUNT,
        maxRangeDays: options.maxRangeDays ?? 62,
        async authorize() {
            return 'organizationId' in authorized
                ? { ok: true, ...authorized }
                : { ok: false, ...authorized };
        },
        provider: {
            async listTimesheetEntries() {
                return options.entries ?? [entry('9001', '2026-08-03'), entry('9002', '2026-08-20')];
            },
        },
        async importEntry(delivery) {
            imported.push(delivery.recordingUrl);
            return { status: 200, result: 'created', body: { ok: true } };
        },
    };

    return { imported, reconcile: createTimesheetReconciler(dependencies) };
}

const request = { clientId: 'client-a', from: '2026-08-01', to: '2026-08-31' };

test('reconciliation replays provider entries through the webhook importer', async () => {
    const { reconcile, imported } = harness();
    const outcome = await reconcile(request);

    assert.equal(outcome.status, 200);
    assert.deepEqual(imported, [
        `https://3.basecampapi.com/${ACCOUNT}/buckets/48599958/timesheet_entries/9001.json`,
        `https://3.basecampapi.com/${ACCOUNT}/buckets/48599958/timesheet_entries/9002.json`,
    ]);
    assert.deepEqual(outcome.body, { ok: true, scanned: 2, imported: 2, failed: 0 });
});

test('reconciling twice is idempotent because the importer dedupes on entry id', async () => {
    const { reconcile, imported } = harness();
    await reconcile(request);
    await reconcile(request);

    assert.equal(imported.length, 4);
    assert.equal(new Set(imported).size, 2);
});

test('entries outside the requested range are not replayed', async () => {
    const { reconcile, imported } = harness({
        entries: [entry('in', '2026-08-15'), entry('before', '2026-07-31'), entry('after', '2026-09-01')],
    });
    const outcome = await reconcile(request);

    assert.equal(imported.length, 1);
    assert.match(imported[0], /timesheet_entries\/in\.json$/);
    assert.equal((outcome.body as { scanned: number }).scanned, 1);
});

test('an unauthorized caller never reaches the provider', async () => {
    const { reconcile, imported } = harness({ authorized: { status: 403, error: 'Forbidden' } });
    const outcome = await reconcile(request);

    assert.equal(outcome.status, 403);
    assert.deepEqual(imported, []);
});

test('reconciliation is scoped to the authorized client project only', async () => {
    const { reconcile, imported } = harness();
    await reconcile({ ...request, clientId: 'client-a' });

    // The project comes from the authorization result, never from the caller.
    for (const url of imported) {
        assert.match(url, /\/buckets\/48599958\//);
    }
});

test('a missing or malformed range is rejected', async () => {
    const { reconcile } = harness();

    assert.equal((await reconcile({ ...request, from: '' })).status, 400);
    assert.equal((await reconcile({ ...request, from: '08/01/2026' })).status, 400);
    assert.equal((await reconcile({ ...request, to: '2026-07-01' })).status, 400);
});

test('an unbounded range is rejected rather than sweeping all history', async () => {
    const { reconcile } = harness({ maxRangeDays: 31 });
    const outcome = await reconcile({ clientId: 'client-a', from: '2026-01-01', to: '2026-12-31' });

    assert.equal(outcome.status, 400);
    assert.match(String((outcome.body as { error: string }).error), /range/i);
});

test('a provider outage reports a retryable failure', async () => {
    const { reconcile, imported } = harness({ entries: 'unavailable' });
    const outcome = await reconcile(request);

    assert.equal(outcome.status, 503);
    assert.deepEqual(imported, []);
});

test('one failing entry does not abort the whole sweep', async () => {
    let calls = 0;
    const reconcile = createTimesheetReconciler({
        expectedAccountId: ACCOUNT,
        maxRangeDays: 62,
        async authorize() {
            return { ok: true, organizationId: 'org-1', projectId: '48599958' };
        },
        provider: {
            async listTimesheetEntries() {
                return [entry('a', '2026-08-03'), entry('b', '2026-08-04'), entry('c', '2026-08-05')];
            },
        },
        async importEntry() {
            calls += 1;
            return calls === 2
                ? { status: 503, result: 'retry:provider-unavailable', body: { error: 'x' } }
                : { status: 200, result: 'created', body: { ok: true } };
        },
    });

    const outcome = await reconcile(request);

    assert.equal(outcome.status, 200);
    assert.deepEqual(outcome.body, { ok: true, scanned: 3, imported: 2, failed: 1 });
});
