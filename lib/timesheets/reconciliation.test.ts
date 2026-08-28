import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTimesheet, type ProviderEntry, type LocalEntry } from './reconciliation.ts';

function provider(fingerprint: string, hours: number, over: Partial<ProviderEntry> = {}): ProviderEntry {
    return { fingerprint, hours, date: '2026-08-04', projectName: 'Pipe It Right', person: 'Abel Miranda', ...over };
}
function local(id: string, fingerprint: string | null, hours: number, over: Partial<LocalEntry> = {}): LocalEntry {
    return {
        id, fingerprint, hours, date: '2026-08-04',
        clientName: 'Pipe It Right Plumbing', description: null, importStatus: 'pending_review', ...over,
    };
}

test('a clean import balances', () => {
    const result = reconcileTimesheet(
        [provider('a', 0.5), provider('b', 0.2)],
        [local('1', 'a', 0.5), local('2', 'b', 0.2)],
    );
    assert.equal(result.matched.length, 2);
    assert.equal(result.balanced, true);
    assert.equal(result.providerHours, 0.7);
    assert.equal(result.localHours, 0.7);
    assert.equal(result.matchedHours, 0.7);
});

test('an entry Basecamp has and we do not is surfaced, not silently dropped', () => {
    // The import missing a row is the failure this view exists to catch.
    const result = reconcileTimesheet([provider('a', 0.5), provider('b', 0.2)], [local('1', 'a', 0.5)]);
    assert.deepEqual(result.providerOnly.map(p => p.fingerprint), ['b']);
    assert.equal(result.balanced, false);
});

test('an entry we hold that Basecamp no longer has is surfaced', () => {
    const result = reconcileTimesheet([provider('a', 0.5)], [local('1', 'a', 0.5), local('2', 'b', 0.2)]);
    assert.deepEqual(result.localOnly.map(l => l.id), ['2']);
    assert.equal(result.balanced, false);
});

test('time authored here never matches and is reported as ours', () => {
    // No fingerprint means it did not come from Basecamp, so pairing it with a
    // provider row would be a fabricated link.
    const result = reconcileTimesheet([provider('a', 0.5)], [local('1', null, 2)]);
    assert.equal(result.matched.length, 0);
    assert.deepEqual(result.localOnly.map(l => l.id), ['1']);
    assert.deepEqual(result.providerOnly.map(p => p.fingerprint), ['a']);
});

test('a fingerprint pairs once, so a repeat cannot fake a balance', () => {
    // Two provider rows sharing a fingerprint must not both claim the one
    // local row and leave the totals looking reconciled.
    const result = reconcileTimesheet([provider('a', 0.5), provider('a', 0.5)], [local('1', 'a', 0.5)]);
    assert.equal(result.matched.length, 1);
    assert.equal(result.providerOnly.length, 1);
    assert.equal(result.balanced, false);
});

test('hours are summed independently on each side', () => {
    // Reporting matched hours as though they were the total is how a missing
    // row hides: the number would still look right.
    const result = reconcileTimesheet([provider('a', 4), provider('b', 6.5)], [local('1', 'a', 4)]);
    assert.equal(result.providerHours, 10.5);
    assert.equal(result.localHours, 4);
    assert.equal(result.matchedHours, 4);
});

test('empty on both sides is balanced rather than an error', () => {
    const result = reconcileTimesheet([], []);
    assert.equal(result.balanced, true);
    assert.equal(result.providerHours, 0);
});

test('fractional hours do not drift', () => {
    const result = reconcileTimesheet(
        [provider('a', 0.1), provider('b', 0.2)],
        [local('1', 'a', 0.1), local('2', 'b', 0.2)],
    );
    assert.equal(result.providerHours, 0.3);
});
