import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIssues, isReadyToSubmit, type ReviewableRow } from './import-issues.ts';

function row(overrides: Partial<ReviewableRow> = {}): ReviewableRow {
    return {
        id: 'log-1',
        userId: 'user-abel',
        clientId: 'client-a',
        isInternal: false,
        activityKey: 'technical_audit',
        taskId: 'task-1',
        importStatus: 'needs_context',
        ...overrides,
    };
}

test('a complete row has no issues and can be submitted', () => {
    assert.deepEqual(deriveIssues(row()), []);
    assert.equal(isReadyToSubmit(row()), true);
});

test('a row with no mapped member is an issue', () => {
    assert.deepEqual(deriveIssues(row({ userId: null })), ['no_member']);
    assert.equal(isReadyToSubmit(row({ userId: null })), false);
});

test('a row with a mapped member does not report no_member', () => {
    assert.equal(deriveIssues(row()).includes('no_member'), false);
});

test('a missing client is an issue', () => {
    assert.deepEqual(deriveIssues(row({ clientId: null })), ['no_client']);
    assert.equal(isReadyToSubmit(row({ clientId: null })), false);
});

test('explicitly internal work needs no client', () => {
    const internal = row({ clientId: null, isInternal: true });

    assert.deepEqual(deriveIssues(internal), []);
    assert.equal(isReadyToSubmit(internal), true);
});

test('a missing activity is an issue — this is the common case', () => {
    assert.deepEqual(deriveIssues(row({ activityKey: null })), ['no_activity']);
    assert.equal(isReadyToSubmit(row({ activityKey: null })), false);
});

test('an empty-string activity counts as missing', () => {
    assert.deepEqual(deriveIssues(row({ activityKey: '' })), ['no_activity']);
});

test('a missing task link is advisory and never blocks', () => {
    const unlinked = row({ taskId: null });

    assert.deepEqual(deriveIssues(unlinked), ['no_task_link']);
    assert.equal(isReadyToSubmit(unlinked), true);
});

test('issues accumulate in a stable order', () => {
    assert.deepEqual(
        deriveIssues(row({ userId: null, clientId: null, activityKey: null, taskId: null })),
        ['no_member', 'no_client', 'no_activity', 'no_task_link'],
    );
});

test('an already-mapped row reports no issues, even with no member', () => {
    assert.deepEqual(deriveIssues(row({ importStatus: 'mapped', taskId: null, userId: null })), []);
    assert.equal(isReadyToSubmit(row({ importStatus: 'mapped' })), false);
});

test('a voided row reports no issues and cannot be submitted, even with no member', () => {
    assert.deepEqual(deriveIssues(row({ importStatus: 'voided', activityKey: null, userId: null })), []);
    assert.equal(isReadyToSubmit(row({ importStatus: 'voided' })), false);
});

test('a row already awaiting review cannot be submitted again', () => {
    assert.equal(isReadyToSubmit(row({ importStatus: 'pending_review' })), false);
});
