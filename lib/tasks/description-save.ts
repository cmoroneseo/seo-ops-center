/** Debounced description save. Typing queues one write; close and unmount flush it. */

export const DESCRIPTION_AUTOSAVE_MS = 500;

export type DescriptionPhase = 'idle' | 'pending' | 'saving' | 'saved' | 'failed';

export interface DescriptionAutosave {
    phase: DescriptionPhase;
    text: string;
    savedText: string;
    dueAt: number | null;
    inflight: string | null;
    failedText: string | null;
}

export type DescriptionAction =
    | { type: 'reset'; text: string }
    | { type: 'edit'; text: string; now: number }
    | { type: 'tick'; now: number }
    | { type: 'flush'; now: number }
    | { type: 'succeed'; text: string }
    | { type: 'fail'; text: string }
    | { type: 'retry' };

export interface DescriptionStep {
    state: DescriptionAutosave;
    /** Text the caller should persist now. Null when this step only updates the editor. */
    save: string | null;
}

export function idleDescriptionAutosave(text: string): DescriptionAutosave {
    return { phase: 'idle', text, savedText: text, dueAt: null, inflight: null, failedText: null };
}

export function descriptionSaveLabel(phase: DescriptionPhase): string | null {
    if (phase === 'pending' || phase === 'saving') return 'Saving…';
    if (phase === 'saved') return 'Saved';
    if (phase === 'failed') return 'Failed to save';
    return null;
}

function saving(state: DescriptionAutosave, text: string): DescriptionStep {
    return {
        state: { ...state, phase: 'saving', inflight: text, dueAt: null, failedText: null },
        save: text,
    };
}

/** One transition. A save is returned at most once per step; a newer edit waits until that write finishes. */
export function descriptionAutosaveStep(
    state: DescriptionAutosave,
    action: DescriptionAction,
    debounceMs = DESCRIPTION_AUTOSAVE_MS,
): DescriptionStep {
    switch (action.type) {
        case 'reset':
            return { state: idleDescriptionAutosave(action.text), save: null };
        case 'edit': {
            const text = action.text;
            if (state.inflight) {
                const unchanged = text === state.savedText || text === state.inflight;
                return {
                    state: {
                        ...state,
                        text,
                        phase: 'saving',
                        dueAt: unchanged ? null : action.now + debounceMs,
                    },
                    save: null,
                };
            }
            if (text === state.savedText) {
                return { state: { ...state, text, phase: 'idle', dueAt: null, failedText: null }, save: null };
            }
            return {
                state: { ...state, text, phase: 'pending', dueAt: action.now + debounceMs, failedText: null },
                save: null,
            };
        }
        case 'tick': {
            if (state.inflight || state.phase !== 'pending' || state.dueAt == null || action.now < state.dueAt) {
                return { state, save: null };
            }
            if (state.text === state.savedText) {
                return { state: { ...state, phase: 'idle', dueAt: null }, save: null };
            }
            return saving(state, state.text);
        }
        case 'flush': {
            if (state.inflight) {
                if (state.text !== state.inflight && state.text !== state.savedText) {
                    return { state: { ...state, dueAt: action.now }, save: null };
                }
                return { state, save: null };
            }
            if (state.text === state.savedText) return { state: { ...state, dueAt: null }, save: null };
            return saving(state, state.text);
        }
        case 'succeed': {
            if (state.inflight !== action.text) return { state, save: null };
            if (state.text !== action.text) return saving({ ...state, savedText: action.text }, state.text);
            return {
                state: {
                    ...state,
                    savedText: action.text,
                    inflight: null,
                    phase: 'saved',
                    dueAt: null,
                    failedText: null,
                },
                save: null,
            };
        }
        case 'fail': {
            if (state.inflight !== action.text) return { state, save: null };
            return {
                state: { ...state, inflight: null, phase: 'failed', failedText: action.text, dueAt: null },
                save: null,
            };
        }
        case 'retry': {
            if (state.inflight || state.text === state.savedText) {
                return {
                    state: state.text === state.savedText
                        ? { ...state, phase: 'idle', failedText: null, dueAt: null }
                        : state,
                    save: null,
                };
            }
            return saving(state, state.text);
        }
        default:
            return { state, save: null };
    }
}
