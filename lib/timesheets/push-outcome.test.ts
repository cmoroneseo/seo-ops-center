import test from 'node:test';
import assert from 'node:assert/strict';
import { PUSH_OUTCOME_MESSAGE, pushOutcomeFor } from './push-outcome.ts';

test('a successful push reports pushed', () => {
    assert.equal(pushOutcomeFor(200, { success: true }), 'pushed');
    assert.equal(pushOutcomeFor(200, {}), 'pushed');
});

test('the common case — client has no Basecamp project — is named, not swallowed', () => {
    // Only a minority of clients have a project bound, so the push route
    // answers 409 far more often than it succeeds.
    assert.equal(
        pushOutcomeFor(409, { error: 'Task has no authorized Basecamp project' }),
        'no_project',
    );
});

test('a link/config mismatch reads as the same configuration problem', () => {
    assert.equal(
        pushOutcomeFor(409, { error: 'Task Basecamp link does not match its client configuration' }),
        'no_project',
    );
});

test('a permission refusal is distinguished from a configuration problem', () => {
    assert.equal(pushOutcomeFor(403, { error: 'Forbidden' }), 'forbidden');
});

test('an unconfigured integration is reported from either signal', () => {
    assert.equal(pushOutcomeFor(503, { error: 'Basecamp not configured' }), 'not_configured');
    assert.equal(pushOutcomeFor(503, { configured: false }), 'not_configured');
    // The route can answer 200 while reporting it is not configured.
    assert.equal(pushOutcomeFor(200, { configured: false }), 'not_configured');
});

test('a request that never completed is a push failure, not a task failure', () => {
    assert.equal(pushOutcomeFor(null, null), 'failed');
});

test('a 200 that reports success:false is a failure, not a pass', () => {
    assert.equal(pushOutcomeFor(200, { success: false }), 'failed');
});

test('unexpected statuses fail closed rather than claiming success', () => {
    assert.equal(pushOutcomeFor(500, null), 'failed');
    assert.equal(pushOutcomeFor(404, { error: 'Task not found' }), 'failed');
    assert.equal(pushOutcomeFor(400, { error: 'action and taskId are required' }), 'failed');
});

test('every non-success outcome has a message, and each says the task was created', () => {
    for (const outcome of ['no_project', 'forbidden', 'not_configured', 'failed'] as const) {
        const message = PUSH_OUTCOME_MESSAGE[outcome];
        assert.ok(message, `missing message for ${outcome}`);
        // The task DID save — the row must never imply otherwise.
        assert.match(message, /Task created/);
    }
});
