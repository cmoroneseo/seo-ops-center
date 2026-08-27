import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isNonWorkTab, carriesClient, quickCreateTitle, quickCreateClientId,
} from './quick-create-kinds.ts';

test('a break needs no title typed', () => {
    // Demanding one puts friction on the exact action we want taken rather
    // than skipped — a gap left unnamed is the outcome this prevents.
    assert.equal(quickCreateTitle('break', ''), 'Break');
    assert.equal(quickCreateTitle('break', '   '), 'Break');
});

test('anything typed still wins over the default', () => {
    assert.equal(quickCreateTitle('break', 'School pickup'), 'School pickup');
});

test('work types still require a title', () => {
    for (const tab of ['event', 'focus', 'ooo', 'task'] as const) {
        assert.equal(quickCreateTitle(tab, ''), null, tab);
    }
});

test('a break never carries a client', () => {
    // Not billable, not budget, not delivery. Whatever the picker last showed,
    // it must not ride along.
    assert.equal(carriesClient('break'), false);
    assert.equal(quickCreateClientId('break', 'client-a'), undefined);
});

test('work types keep their client', () => {
    assert.equal(quickCreateClientId('event', 'client-a'), 'client-a');
    assert.equal(quickCreateClientId('event', ''), undefined);
});

test('only break is non-work', () => {
    assert.equal(isNonWorkTab('break'), true);
    for (const tab of ['event', 'focus', 'task'] as const) {
        assert.equal(isNonWorkTab(tab), false, tab);
    }
    // OOO is absence, not a break; it keeps its existing behavior untouched.
    assert.equal(isNonWorkTab('ooo'), false);
});
