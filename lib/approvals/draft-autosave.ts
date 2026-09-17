/**
 * Autosave state for the internal working draft.
 *
 * Import-once means every revision after handoff happens in the app, so the working
 * draft is the only copy of that work — losing it on a stray navigation loses real
 * writing. The rules live here rather than in the component so they can be tested.
 */

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
    /** The newest unsaved payload, or null when everything is persisted. */
    pending: Record<string, unknown> | null;
    status: DraftSaveStatus;
}

export const IDLE_AUTOSAVE: AutosaveState = { pending: null, status: 'idle' };

/** Debounce window. Matches the Notepad editor so the two feel the same. */
export const AUTOSAVE_DEBOUNCE_MS = 800;

export function queueDraftChange(
    state: AutosaveState,
    json: Record<string, unknown>,
    opts: { locked: boolean },
): AutosaveState {
    // A locked document is open for client review, not editing. The server refuses the
    // write anyway; queueing it would just produce a confusing error toast.
    if (opts.locked) return state;
    return { pending: json, status: state.status === 'saving' ? 'saving' : 'idle' };
}

export function beginDraftSave(state: AutosaveState): AutosaveState {
    if (!state.pending) return state;
    return { ...state, status: 'saving' };
}

/**
 * Resolve a completed save.
 *
 * A failure **keeps the pending payload** so the next debounce or the unmount flush
 * retries it. Clearing it on failure would turn a transient network blip into silently
 * lost writing, which is the whole thing this module exists to prevent.
 */
export function resolveDraftSave(
    state: AutosaveState,
    ok: boolean,
    savedPayload?: Record<string, unknown>,
): AutosaveState {
    if (!ok) return { pending: state.pending, status: 'error' };

    // If the writer typed again while the save was in flight, that newer payload is
    // still pending — do not report "saved" and do not drop it.
    if (savedPayload && state.pending && state.pending !== savedPayload) {
        return { pending: state.pending, status: 'idle' };
    }
    return { pending: null, status: 'saved' };
}

export function hasUnsavedWork(state: AutosaveState): boolean {
    return state.pending !== null;
}

/** Copy for the save indicator. Silent autosave is barely better than none. */
export function draftStatusLabel(state: AutosaveState): string | null {
    if (state.status === 'saving') return 'Saving…';
    if (state.status === 'error') return "Couldn't save — retrying";
    if (state.status === 'saved' && !state.pending) return 'Saved';
    if (state.pending) return 'Unsaved changes';
    return null;
}
