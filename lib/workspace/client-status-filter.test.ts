import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CLIENT_STATUS_FILTER, matchesClientStatus } from './client-status-filter';

test('default client list includes newly saved onboarding clients alongside active clients', () => {
    assert.equal(matchesClientStatus('Onboarding', DEFAULT_CLIENT_STATUS_FILTER), true);
    assert.equal(matchesClientStatus('Active', DEFAULT_CLIENT_STATUS_FILTER), true);
    assert.equal(matchesClientStatus('Paused', DEFAULT_CLIENT_STATUS_FILTER), false);
    assert.equal(matchesClientStatus('Cancelled', DEFAULT_CLIENT_STATUS_FILTER), false);
});

test('explicit status filters remain available without changing the client lifecycle', () => {
    assert.equal(matchesClientStatus('Onboarding', 'Active'), false);
    assert.equal(matchesClientStatus('Onboarding', 'Onboarding'), true);
    assert.equal(matchesClientStatus('Active', 'Onboarding'), false);
    assert.equal(matchesClientStatus('Paused', 'Paused'), true);
    assert.equal(matchesClientStatus('Cancelled', 'Cancelled'), true);
    for (const status of ['Active', 'Onboarding', 'Paused', 'Cancelled'] as const) {
        assert.equal(matchesClientStatus(status, 'All'), true);
    }
});
