import type {
    SiteIdentityDecisionKind,
    SiteIdentityReasonCode,
} from '../types.ts';

type ReviewDecisionKind = Exclude<SiteIdentityDecisionKind, 'reopen'>;

export interface IdentityDecisionFormState {
    confirmOpen: boolean;
    selectedCandidateId: string;
    decisionKind?: ReviewDecisionKind;
    reasonCode: SiteIdentityReasonCode | '';
    note: string;
    saveError: string;
}

export type IdentityDecisionFormAction =
    | { type: 'select_candidate'; candidateId: string }
    | { type: 'choose_decision'; decisionKind: ReviewDecisionKind }
    | { type: 'set_reason'; reasonCode: SiteIdentityReasonCode | '' }
    | { type: 'set_note'; note: string }
    | { type: 'set_confirmation'; open: boolean }
    | { type: 'set_save_error'; message: string }
    | { type: 'conflict_reset' }
    | { type: 'saved_reset' };

export const initialIdentityDecisionFormState: IdentityDecisionFormState = {
    confirmOpen: false,
    selectedCandidateId: '',
    decisionKind: undefined,
    reasonCode: '',
    note: '',
    saveError: '',
};

export function identityDecisionFormReducer(
    state: IdentityDecisionFormState,
    action: IdentityDecisionFormAction,
): IdentityDecisionFormState {
    switch (action.type) {
        case 'select_candidate':
            return {
                ...state,
                confirmOpen: false,
                selectedCandidateId: action.candidateId,
                saveError: '',
            };
        case 'choose_decision':
            return {
                ...state,
                confirmOpen: false,
                decisionKind: action.decisionKind,
                reasonCode: '',
                note: '',
                saveError: '',
            };
        case 'set_reason':
            return { ...state, reasonCode: action.reasonCode, saveError: '' };
        case 'set_note':
            return { ...state, note: action.note, saveError: '' };
        case 'set_confirmation':
            return { ...state, confirmOpen: action.open };
        case 'set_save_error':
            return { ...state, saveError: action.message };
        case 'conflict_reset':
            return { ...initialIdentityDecisionFormState };
        case 'saved_reset':
            return {
                ...initialIdentityDecisionFormState,
                selectedCandidateId: state.selectedCandidateId,
            };
    }
}
