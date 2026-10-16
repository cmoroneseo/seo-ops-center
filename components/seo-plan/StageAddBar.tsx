'use client';

import { useId, useRef, useState } from 'react';
import {
    stageAddTitlesError,
    titlesFromStageAddEnter,
    titlesFromStageAddPaste,
} from '@/lib/seo-plan/stage-add-lines';

/**
 * One title on Enter. Several pasted lines become several tasks, in order.
 * The field stays put when the save fails so the title can be tried again.
 */
export function StageAddBar({
    label,
    placeholder,
    stage,
    parentTaskId,
    onAdd,
}: {
    label: string;
    placeholder: string;
    stage: string;
    parentTaskId?: string;
    onAdd: (titles: string[]) => Promise<void>;
}) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const errorId = useId();

    async function submit(titles: string[], fromField: boolean) {
        const problem = stageAddTitlesError(titles);
        if (problem) {
            setError(problem);
            return;
        }
        const previous = value;
        if (fromField) setValue('');
        setBusy(true);
        setError(null);
        try {
            await onAdd(titles);
        } catch {
            if (fromField) setValue(previous);
            setError(titles.length > 1 ? 'Could not add those tasks.' : 'Could not add that task.');
        } finally {
            setBusy(false);
            inputRef.current?.focus();
        }
    }

    return (
        <div>
            <input
                ref={inputRef}
                type="text"
                value={value}
                disabled={busy}
                placeholder={placeholder}
                aria-label={label}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                data-add={stage}
                {...(parentTaskId ? { 'data-add-parent': parentTaskId } : {})}
                autoComplete="off"
                onChange={event => {
                    setValue(event.target.value);
                    if (error) setError(null);
                }}
                onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing || busy) return;
                    event.preventDefault();
                    const titles = titlesFromStageAddEnter(value);
                    if (!titles) return;
                    void submit(titles, true);
                }}
                onPaste={event => {
                    if (busy) return;
                    const titles = titlesFromStageAddPaste(event.clipboardData.getData('text'));
                    if (!titles) return;
                    event.preventDefault();
                    void submit(titles, false);
                }}
                className="w-full min-w-0 rounded-lg border border-border bg-card px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
            />
            {error && (
                <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">{error}</p>
            )}
        </div>
    );
}
