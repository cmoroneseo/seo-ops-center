import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportedEntry, type ExistingLedgerRow } from './timesheet-import-merge.ts';
import type { ImportedEntryInput } from './timesheet-webhook-route.ts';

function incoming(overrides: Partial<ImportedEntryInput> = {}): ImportedEntryInput {
    return {
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
        ...overrides,
    };
}

function existing(overrides: Partial<ExistingLedgerRow> = {}): ExistingLedgerRow {
    return {
        source: 'basecamp',
        importStatus: 'mapped',
        clientId: 'client-a',
        taskId: null,
        userId: 'user-abel',
        ...overrides,
    };
}

test('a brand new row is written exactly as imported, marked basecamp', () => {
    const merged = mergeImportedEntry(null, incoming());

    assert.equal(merged.source, 'basecamp');
    assert.equal(merged.import_status, 'mapped');
    assert.equal(merged.user_id, 'user-abel');
    assert.equal(merged.client_id, 'client-a');
    assert.equal(merged.voided_at, null);
});

test('an existing imported row takes the provider values', () => {
    const merged = mergeImportedEntry(
        existing(),
        incoming({ hours: 2.25, description: 'Revised', date: '2026-08-25' }),
    );

    assert.equal(merged.hours, 2.25);
    assert.equal(merged.description, 'Revised');
    assert.equal(merged.date, '2026-08-25');
    assert.equal(merged.source, 'basecamp');
});

test('an SEO PM row echoed back keeps its native source', () => {
    const merged = mergeImportedEntry(
        existing({ source: 'seo_pm' }),
        incoming(),
    );

    // The row was created here and pushed out; the echo is provider
    // confirmation, not a change of origin.
    assert.equal(merged.source, 'seo_pm');
});

test('an echo never nulls out the attribution a native row already had', () => {
    const merged = mergeImportedEntry(
        existing({ source: 'seo_pm', userId: 'user-carlos', clientId: 'client-a', taskId: 'task-1' }),
        incoming({ userId: null, clientId: null, taskId: null, importStatus: 'needs_context' }),
    );

    assert.equal(merged.user_id, 'user-carlos');
    assert.equal(merged.client_id, 'client-a');
    assert.equal(merged.task_id, 'task-1');
    assert.equal(merged.import_status, 'mapped');
});

test('an echo of an unresolvable person does not push a native row into review', () => {
    const merged = mergeImportedEntry(
        existing({ source: 'seo_pm' }),
        incoming({ userId: null, importStatus: 'needs_context' }),
    );

    assert.equal(merged.import_status, 'mapped');
});

test('a manager-resolved import is not re-broken by a later provider update', () => {
    const merged = mergeImportedEntry(
        existing({ source: 'basecamp', importStatus: 'mapped', userId: 'user-abel', clientId: 'client-a' }),
        incoming({ userId: null, importStatus: 'needs_context', clientId: null }),
    );

    assert.equal(merged.import_status, 'mapped');
    assert.equal(merged.user_id, 'user-abel');
    assert.equal(merged.client_id, 'client-a');
});

test('a still-unresolved import stays in review and takes any new resolution', () => {
    const stillBroken = mergeImportedEntry(
        existing({ importStatus: 'needs_context', userId: null, clientId: null }),
        incoming({ userId: null, clientId: null, importStatus: 'needs_context' }),
    );
    assert.equal(stillBroken.import_status, 'needs_context');

    const nowResolved = mergeImportedEntry(
        existing({ importStatus: 'needs_context', userId: null, clientId: null }),
        incoming({ userId: 'user-abel', clientId: 'client-a', importStatus: 'mapped' }),
    );
    assert.equal(nowResolved.import_status, 'mapped');
    assert.equal(nowResolved.user_id, 'user-abel');
});

test('a returning provider entry clears a prior void', () => {
    const merged = mergeImportedEntry(
        existing({ importStatus: 'voided' }),
        incoming(),
    );

    assert.equal(merged.voided_at, null);
    assert.equal(merged.import_status, 'mapped');
});

test('provider provenance is always refreshed', () => {
    const merged = mergeImportedEntry(existing({ source: 'seo_pm' }), incoming());

    assert.equal(merged.provider_updated_at, '2026-08-24T18:00:00Z');
    assert.equal(merged.imported_at, '2026-08-24T18:05:00Z');
    assert.equal(merged.basecamp_entry_id, 9001);
    assert.equal(merged.basecamp_recording_id, 777);
    assert.equal(merged.basecamp_sync_error, null);
});
