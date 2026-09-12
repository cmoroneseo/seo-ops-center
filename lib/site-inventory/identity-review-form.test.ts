import assert from 'node:assert/strict';
import test from 'node:test';

import {
    identityDecisionFormReducer,
    initialIdentityDecisionFormState,
} from './identity-review-form.ts';

test('conflict reset clears every stale decision-form field', () => {
    const state = identityDecisionFormReducer({
        confirmOpen: true,
        selectedCandidateId: 'page-stale-target',
        decisionKind: 'claim_into',
        reasonCode: 'redirect_alias',
        note: 'Stale reviewer note',
        saveError: 'Stale save error',
    }, { type: 'conflict_reset' });

    assert.deepEqual(state, {
        confirmOpen: false,
        selectedCandidateId: '',
        decisionKind: undefined,
        reasonCode: '',
        note: '',
        saveError: '',
    });
});

test('decision form edits are represented in one executable state', () => {
    const actions = [
        { type: 'select_candidate', candidateId: 'page-target' } as const,
        { type: 'choose_decision', decisionKind: 'keep_separate' } as const,
        { type: 'set_reason', reasonCode: 'distinct_intent' } as const,
        { type: 'set_note', note: 'Separate service purpose.' } as const,
        { type: 'set_confirmation', open: true } as const,
        { type: 'set_save_error', message: 'Save failed' } as const,
    ];
    const state = actions.reduce(identityDecisionFormReducer, initialIdentityDecisionFormState);

    assert.deepEqual(state, {
        confirmOpen: true,
        selectedCandidateId: 'page-target',
        decisionKind: 'keep_separate',
        reasonCode: 'distinct_intent',
        note: 'Separate service purpose.',
        saveError: 'Save failed',
    });
});

test('saved reset clears completed decision fields without discarding candidate context', () => {
    const state = identityDecisionFormReducer({
        confirmOpen: true,
        selectedCandidateId: 'page-current-target',
        decisionKind: 'needs_research',
        reasonCode: 'conflicting_signals',
        note: 'Reviewed current signals.',
        saveError: 'Old error',
    }, { type: 'saved_reset' });

    assert.deepEqual(state, {
        confirmOpen: false,
        selectedCandidateId: 'page-current-target',
        decisionKind: undefined,
        reasonCode: '',
        note: '',
        saveError: '',
    });
});
