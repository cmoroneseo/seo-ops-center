import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createTimesheetEntryImporter,
    isTimesheetEntryKind,
    parseTimesheetRecordingUrl,
    type ImportedEntryInput,
    type ProviderTimesheetEntry,
    type TimesheetImportDependencies,
} from './timesheet-webhook-route.ts';

const ACCOUNT = '1234567';
const ENTRY_URL = `https://3.basecampapi.com/${ACCOUNT}/buckets/48599958/timesheet_entries/9001.json`;

function providerEntry(overrides: Partial<ProviderTimesheetEntry> = {}): ProviderTimesheetEntry {
    return {
        id: '9001',
        date: '2026-08-24',
        hours: 1.5,
        description: 'Keyword mapping',
        updatedAt: '2026-08-24T18:00:00Z',
        bucketId: '48599958',
        parentId: '777',
        parentType: 'Timesheet',
        creatorId: '55501',
        ...overrides,
    };
}

interface Recorded {
    upserts: ImportedEntryInput[];
    voids: string[];
}

function harness(options: {
    entry?: ProviderTimesheetEntry | 'missing' | 'unavailable';
    client?: { organizationId: string; clientId: string } | null;
    member?: { userId: string } | null;
    task?: { taskId: string; clientId: string | null } | null;
    configured?: boolean;
} = {}) {
    const recorded: Recorded = { upserts: [], voids: [] };
    const dependencies: TimesheetImportDependencies = {
        expectedAccountId: ACCOUNT,
        now: () => '2026-08-24T18:05:00Z',
        provider: {
            isConfigured: () => options.configured ?? true,
            getTimesheetEntry: async () => options.entry ?? providerEntry(),
        },
        store: {
            async findClientForProject() {
                return options.client === undefined
                    ? { organizationId: 'org-1', clientId: 'client-a' }
                    : options.client;
            },
            async findMemberForPerson() {
                return options.member === undefined ? { userId: 'user-abel' } : options.member;
            },
            async findTaskForTodo() {
                return options.task ?? null;
            },
            async upsertImportedEntry(input) {
                recorded.upserts.push(input);
                return 'created';
            },
            async voidImportedEntry(entryId) {
                recorded.voids.push(entryId);
                return 'voided';
            },
        },
    };
    return { recorded, importer: createTimesheetEntryImporter(dependencies) };
}

function delivery(overrides: Partial<{ kind: string; recordingId: string; recordingUrl: string }> = {}) {
    return {
        kind: 'timesheet_entry_created',
        recordingId: '9001',
        recordingUrl: ENTRY_URL,
        ...overrides,
    };
}

test('timesheet entry kinds are recognized, todo kinds are not', () => {
    assert.equal(isTimesheetEntryKind('timesheet_entry_created'), true);
    assert.equal(isTimesheetEntryKind('timesheet_entry_changed'), true);
    assert.equal(isTimesheetEntryKind('timesheet_entry_trashed'), true);
    assert.equal(isTimesheetEntryKind('todo_completed'), false);
    assert.equal(isTimesheetEntryKind(''), false);
});

test('only a canonical timesheet-entry recording URL parses', () => {
    assert.deepEqual(parseTimesheetRecordingUrl(ENTRY_URL, ACCOUNT), {
        projectId: '48599958',
        entryId: '9001',
    });
    assert.equal(parseTimesheetRecordingUrl(ENTRY_URL, '9999999'), null);
    assert.equal(
        parseTimesheetRecordingUrl(`http://3.basecampapi.com/${ACCOUNT}/buckets/1/timesheet_entries/2.json`, ACCOUNT),
        null,
    );
    assert.equal(
        parseTimesheetRecordingUrl(`https://evil.example.com/${ACCOUNT}/buckets/1/timesheet_entries/2.json`, ACCOUNT),
        null,
    );
    assert.equal(
        parseTimesheetRecordingUrl(`https://3.basecampapi.com/${ACCOUNT}/buckets/1/todos/2.json`, ACCOUNT),
        null,
    );
});

test('a created entry imports as a mapped ledger row from provider state', async () => {
    const { importer, recorded } = harness();
    const outcome = await importer(delivery());

    assert.equal(outcome.status, 200);
    assert.equal(outcome.result, 'created');
    assert.equal(recorded.upserts.length, 1);
    assert.deepEqual(recorded.upserts[0], {
        basecampEntryId: '9001',
        basecampProjectId: '48599958',
        basecampRecordingId: '777',
        organizationId: 'org-1',
        clientId: 'client-a',
        taskId: null,
        userId: 'user-abel',
        date: '2026-08-24',
        hours: 1.5,
        description: 'Keyword mapping',
        importStatus: 'mapped',
        providerUpdatedAt: '2026-08-24T18:00:00Z',
        importedAt: '2026-08-24T18:05:00Z',
    });
});

test('payload fields are never trusted — only the verified provider entry is written', async () => {
    const { importer, recorded } = harness({
        entry: providerEntry({ date: '2026-08-01', hours: 9, description: 'real work' }),
    });
    await importer({
        ...delivery(),
        // A hostile payload claiming different values must have no effect.
        recordingUrl: ENTRY_URL,
    });

    assert.equal(recorded.upserts[0].date, '2026-08-01');
    assert.equal(recorded.upserts[0].hours, 9);
    assert.equal(recorded.upserts[0].description, 'real work');
});

test('an update event reconciles the same row rather than adding one', async () => {
    const { importer, recorded } = harness();
    await importer(delivery({ kind: 'timesheet_entry_changed' }));
    await importer(delivery({ kind: 'timesheet_entry_changed' }));

    assert.equal(recorded.upserts.length, 2);
    assert.equal(recorded.upserts[0].basecampEntryId, recorded.upserts[1].basecampEntryId);
    assert.equal(recorded.voids.length, 0);
});

test('a duplicate delivery of the same entry is idempotent at the upsert key', async () => {
    const { importer, recorded } = harness();
    await importer(delivery());
    await importer(delivery());

    assert.deepEqual(
        [...new Set(recorded.upserts.map(upsert => upsert.basecampEntryId))],
        ['9001'],
    );
});

test('an SEO PM entry echoed back through Basecamp updates the existing row', async () => {
    const { importer, recorded } = harness();
    const outcome = await importer(delivery());

    // The upsert key is the provider entry id, so a locally created row that
    // already carries this id is reconciled, never duplicated.
    assert.equal(recorded.upserts[0].basecampEntryId, '9001');
    assert.equal(outcome.status, 200);
});

test('an entry attached to a synced to-do carries the task linkage', async () => {
    const { importer, recorded } = harness({
        entry: providerEntry({ parentType: 'Todo', parentId: '4242' }),
        task: { taskId: 'task-9', clientId: 'client-a' },
    });
    await importer(delivery());

    assert.equal(recorded.upserts[0].taskId, 'task-9');
    assert.equal(recorded.upserts[0].basecampRecordingId, '4242');
    assert.equal(recorded.upserts[0].importStatus, 'mapped');
});

test('an unknown person produces a needs_context row with no guessed member', async () => {
    const { importer, recorded } = harness({ member: null });
    const outcome = await importer(delivery());

    assert.equal(outcome.result, 'created');
    assert.equal(recorded.upserts[0].userId, null);
    assert.equal(recorded.upserts[0].importStatus, 'needs_context');
});

test('an entry on a to-do we do not track still imports without guessing a task', async () => {
    const { importer, recorded } = harness({
        entry: providerEntry({ parentType: 'Todo', parentId: '4242' }),
        task: null,
    });
    await importer(delivery());

    assert.equal(recorded.upserts[0].taskId, null);
    assert.equal(recorded.upserts[0].importStatus, 'needs_context');
});

test('an unmapped Basecamp project is skipped, not guessed into a client', async () => {
    const { importer, recorded } = harness({ client: null });
    const outcome = await importer(delivery());

    assert.equal(outcome.status, 200);
    assert.equal(outcome.result, 'skipped:unmapped-project');
    assert.equal(recorded.upserts.length, 0);
});

test('a deleted provider entry voids the row instead of destroying history', async () => {
    const { importer, recorded } = harness({ entry: 'missing' });
    const outcome = await importer(delivery({ kind: 'timesheet_entry_trashed' }));

    assert.equal(outcome.status, 200);
    assert.equal(outcome.result, 'voided');
    assert.deepEqual(recorded.voids, ['9001']);
    assert.equal(recorded.upserts.length, 0);
});

test('a trash event whose entry is still live is re-verified, not blindly voided', async () => {
    const { importer, recorded } = harness();
    const outcome = await importer(delivery({ kind: 'timesheet_entry_trashed' }));

    assert.equal(recorded.voids.length, 0);
    assert.equal(outcome.result, 'created');
});

test('provider failure is retryable, never a silent skip', async () => {
    const { importer, recorded } = harness({ entry: 'unavailable' });
    const outcome = await importer(delivery());

    assert.equal(outcome.status, 503);
    assert.equal(outcome.result, 'retry:provider-unavailable');
    assert.equal(recorded.upserts.length, 0);
    assert.equal(recorded.voids.length, 0);
});

test('an unconfigured provider is retryable rather than trusting the payload', async () => {
    const { importer, recorded } = harness({ configured: false });
    const outcome = await importer(delivery());

    assert.equal(outcome.status, 503);
    assert.equal(recorded.upserts.length, 0);
});

test('a non-canonical recording URL is rejected as a provenance mismatch', async () => {
    const { importer, recorded } = harness();
    const outcome = await importer(delivery({
        recordingUrl: `https://3.basecampapi.com/${ACCOUNT}/buckets/1/todos/9001.json`,
    }));

    assert.equal(outcome.status, 403);
    assert.equal(recorded.upserts.length, 0);
});

test('a recording id that disagrees with the canonical URL is rejected', async () => {
    const { importer, recorded } = harness();
    const outcome = await importer(delivery({ recordingId: '9002' }));

    assert.equal(outcome.status, 403);
    assert.equal(recorded.upserts.length, 0);
});

test('a provider entry from a different bucket than the URL is rejected', async () => {
    const { importer, recorded } = harness({ entry: providerEntry({ bucketId: '999' }) });
    const outcome = await importer(delivery());

    assert.equal(outcome.status, 403);
    assert.equal(recorded.upserts.length, 0);
});
