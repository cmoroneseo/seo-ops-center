'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    DESCRIPTION_AUTOSAVE_MS,
    descriptionAutosaveStep,
    idleDescriptionAutosave,
    type DescriptionAction,
    type DescriptionAutosave,
    type DescriptionPhase,
} from './description-save';

/**
 * Debounce a description, flush it on unmount (route change included), and keep
 * the latest text when a save returns after the writer kept typing.
 */
export function useDescriptionAutosave({
    savedText,
    resetKey,
    persist,
    debounceMs = DESCRIPTION_AUTOSAVE_MS,
}: {
    savedText: string;
    resetKey: string;
    persist: (text: string) => Promise<boolean>;
    debounceMs?: number;
}): {
    text: string;
    phase: DescriptionPhase;
    edit: (text: string) => void;
    flush: () => void;
    retry: () => void;
} {
    const [state, setState] = useState<DescriptionAutosave>(() => idleDescriptionAutosave(savedText));
    const stateRef = useRef(state);
    stateRef.current = state;
    const persistRef = useRef(persist);
    persistRef.current = persist;
    const generation = useRef(0);
    const debounceRef = useRef(debounceMs);
    debounceRef.current = debounceMs;

    const apply = useCallback((action: DescriptionAction, token = generation.current) => {
        const step = descriptionAutosaveStep(stateRef.current, action, debounceRef.current);
        stateRef.current = step.state;
        setState(step.state);
        if (!step.save) return;
        const text = step.save;
        void persistRef.current(text).then(ok => {
            if (token !== generation.current) return;
            apply(ok ? { type: 'succeed', text } : { type: 'fail', text }, token);
        });
    }, []);

    useEffect(() => {
        if (state.phase !== 'pending' || state.dueAt == null) return;
        const wait = Math.max(0, state.dueAt - Date.now());
        const token = generation.current;
        const timer = window.setTimeout(() => apply({ type: 'tick', now: Date.now() }, token), wait);
        return () => window.clearTimeout(timer);
    }, [state.phase, state.dueAt, state.text, apply]);

    useEffect(() => {
        const token = ++generation.current;
        apply({ type: 'reset', text: savedText }, token);
        return () => {
            const step = descriptionAutosaveStep(stateRef.current, { type: 'flush', now: Date.now() }, debounceRef.current);
            stateRef.current = step.state;
            if (step.save) void persistRef.current(step.save);
        };
        // savedText is read for the task being opened. Later edits must not reset the field.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetKey, apply]);

    const edit = useCallback((text: string) => apply({ type: 'edit', text, now: Date.now() }), [apply]);
    const flush = useCallback(() => apply({ type: 'flush', now: Date.now() }), [apply]);
    const retry = useCallback(() => apply({ type: 'retry' }), [apply]);

    return { text: state.text, phase: state.phase, edit, flush, retry };
}
