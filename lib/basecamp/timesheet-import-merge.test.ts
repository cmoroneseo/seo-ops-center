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
        importFingerprint: null,
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
        activityKey: null,
        description: '',
        importFingerprint: null,
        basecampEntryId: null,
        ...overrides,
    };
}

test('a brand new row is written with resolved attribution but still waits for context before it counts', () => {
    const merged = mergeImportedEntry(null, incoming());

    assert.equal(merged.source, 'basecamp');
    assert.equal(merged.import_status, 'needs_context');
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

test('a provider edit never blanks context a member supplied', () => {
    // 13 of 14 Basecamp descriptions are empty. An approved row whose context
    // came from review must not be silently emptied by a provider touch.
    const merged = mergeImportedEntry(
        existing({
            importStatus: 'mapped',
            activityKey: 'keyword_research',
            description: 'Keyword Research — mapped the money pages',
        }),
        incoming({ description: '' }),
    );

    assert.equal(merged.description, 'Keyword Research — mapped the money pages');
    assert.equal(merged.import_status, 'mapped');
    assert.equal(merged.activity_key, 'keyword_research');
});

test('member context survives even a non-empty provider description', () => {
    // Same rule as attribution: an import may add, never remove. A row a member
    // has acted on keeps its context whatever Basecamp now says.
    const merged = mergeImportedEntry(
        existing({
            importStatus: 'pending_review',
            activityKey: 'technical_audit',
            description: 'Technical Audit — crawl + fixes',
        }),
        incoming({ description: 'Revised in Basecamp' }),
    );

    assert.equal(merged.description, 'Technical Audit — crawl + fixes');
});

test('a row with no member context still takes the provider description', () => {
    const merged = mergeImportedEntry(
        existing({ importStatus: 'needs_context', activityKey: null, description: 'stale' }),
        incoming({ description: 'Revised in Basecamp' }),
    );

    assert.equal(merged.description, 'Revised in Basecamp');
});

test('an activity key with an empty description still accepts provider text', () => {
    // Nothing to remove, so filling it in is an addition.
    const merged = mergeImportedEntry(
        existing({ importStatus: 'mapped', activityKey: 'technical_audit', description: '' }),
        incoming({ description: 'Crawl notes' }),
    );

    assert.equal(merged.description, 'Crawl notes');
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

test('a still-unresolved import stays in needs_context, and resolved attribution alone does not promote it to mapped', () => {
    const stillBroken = mergeImportedEntry(
        existing({ importStatus: 'needs_context', userId: null, clientId: null }),
        incoming({ userId: null, clientId: null, importStatus: 'needs_context' }),
    );
    assert.equal(stillBroken.import_status, 'needs_context');

    const attributionResolved = mergeImportedEntry(
        existing({ importStatus: 'needs_context', userId: null, clientId: null }),
        incoming({ userId: 'user-abel', clientId: 'client-a', importStatus: 'mapped' }),
    );
    // Attribution is adopted...
    assert.equal(attributionResolved.user_id, 'user-abel');
    assert.equal(attributionResolved.client_id, 'client-a');
    // ...but without an activity key (context), the row still needs review.
    assert.equal(attributionResolved.import_status, 'needs_context');
});

test('a returning provider entry clears a prior void but still waits for context before it counts', () => {
    const merged = mergeImportedEntry(
        existing({ importStatus: 'voided' }),
        incoming(),
    );

    assert.equal(merged.voided_at, null);
    assert.equal(merged.import_status, 'needs_context');
});

test('provider provenance is always refreshed', () => {
    const merged = mergeImportedEntry(existing({ source: 'seo_pm' }), incoming());

    assert.equal(merged.provider_updated_at, '2026-08-24T18:00:00Z');
    assert.equal(merged.imported_at, '2026-08-24T18:05:00Z');
    assert.equal(merged.basecamp_entry_id, 9001);
    assert.equal(merged.basecamp_recording_id, 777);
    assert.equal(merged.basecamp_sync_error, null);
});

test('a CSV import carries its fingerprint and no entry id', () => {
    const merged = mergeImportedEntry(null, incoming({
        basecampEntryId: '', importFingerprint: 'abc123',
    }));

    assert.equal(merged.import_fingerprint, 'abc123');
    assert.equal(merged.basecamp_entry_id, null);
    assert.equal(merged.import_status, 'needs_context');
});

test('a webhook adopts a fingerprinted row and stamps the entry id', () => {
    const merged = mergeImportedEntry(
        existing({
            source: 'basecamp', importStatus: 'needs_context',
            importFingerprint: 'abc123', userId: 'user-abel', clientId: null,
        }),
        incoming({ basecampEntryId: '9001', importFingerprint: 'abc123' }),
    );

    assert.equal(merged.basecamp_entry_id, 9001);
    assert.equal(merged.import_fingerprint, 'abc123');
});

test('adoption never clears context a member already supplied', () => {
    const merged = mergeImportedEntry(
        existing({
            importStatus: 'pending_review', activityKey: 'technical_audit',
            clientId: 'client-a', userId: 'user-abel',
        }),
        incoming({ basecampEntryId: '9001' }),
    );

    assert.equal(merged.activity_key, 'technical_audit');
    assert.equal(merged.import_status, 'pending_review');
});

test('a provider edit does not drag an approved row back into review', () => {
    const merged = mergeImportedEntry(
        existing({ importStatus: 'mapped', activityKey: 'blog_post', clientId: 'client-a', userId: 'user-abel' }),
        incoming({ importStatus: 'needs_context', userId: null, clientId: null }),
    );

    assert.equal(merged.import_status, 'mapped');
});

test('a brand new webhook row with no fingerprint is unchanged', () => {
    const merged = mergeImportedEntry(null, incoming());

    assert.equal(merged.import_fingerprint, null);
    assert.equal(merged.basecamp_entry_id, 9001);
});

test('re-running the backfill after a webhook adoption keeps the entry id', () => {
    // The exact sequence that used to un-adopt a row and produce a duplicate:
    // backfill writes a fingerprinted row, a webhook adopts it and stamps the
    // entry id, then the backfill is re-run (documented as idempotent) with an
    // empty `basecampEntryId`. If that blanks the id, the next delivery finds
    // nothing by entry id and inserts a second ledger row for the same hours.
    const fingerprint = 'abc123';

    const backfilled = mergeImportedEntry(null, incoming({
        basecampEntryId: '', importFingerprint: fingerprint,
        userId: 'user-abel', clientId: 'client-a',
    }));
    assert.equal(backfilled.basecamp_entry_id, null);
    assert.equal(backfilled.import_fingerprint, fingerprint);

    const adopted = mergeImportedEntry(
        existing({
            source: 'basecamp',
            importStatus: backfilled.import_status,
            clientId: backfilled.client_id,
            userId: backfilled.user_id,
            activityKey: backfilled.activity_key,
            description: backfilled.description,
            importFingerprint: backfilled.import_fingerprint,
            basecampEntryId: backfilled.basecamp_entry_id,
        }),
        incoming({ basecampEntryId: '9001', importFingerprint: fingerprint }),
    );
    assert.equal(adopted.basecamp_entry_id, 9001);
    assert.equal(adopted.import_fingerprint, fingerprint);

    const reBackfilled = mergeImportedEntry(
        existing({
            source: 'basecamp',
            importStatus: adopted.import_status,
            clientId: adopted.client_id,
            userId: adopted.user_id,
            activityKey: adopted.activity_key,
            description: adopted.description,
            importFingerprint: adopted.import_fingerprint,
            basecampEntryId: adopted.basecamp_entry_id,
        }),
        incoming({ basecampEntryId: '', importFingerprint: fingerprint }),
    );

    // Still one row, still adopted — both identities intact.
    assert.equal(reBackfilled.basecamp_entry_id, 9001);
    assert.equal(reBackfilled.import_fingerprint, fingerprint);
});

test('an incoming entry id still wins over a stale stored one', () => {
    const merged = mergeImportedEntry(
        existing({ basecampEntryId: 9001 }),
        incoming({ basecampEntryId: '9002' }),
    );

    assert.equal(merged.basecamp_entry_id, 9002);
});
