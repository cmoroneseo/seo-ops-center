'use client';

import { useId, useRef, useState } from 'react';
import { stageAddTitlesError, titlesFromStageAddEnter } from '@/lib/seo-plan/stage-add-lines';
import { readSubtaskPaste } from '@/lib/seo-plan/subtask-paste';
import { subtaskLinesError } from '@/lib/tasks/live-url';

/**
 * One subtask on Enter. A multi-line paste waits for a confirm that shows
 * the count. Focus stays in the field so the next title can be typed.
 */
export function PlanSubtaskAdd({
    onAdd,
}: {
    onAdd: (titles: string[]) => Promise<void>;
}) {
    const [value, setValue] = useState('');
    const [preview, setPreview] = useState<{ lines: string[]; titles: string[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const errorId = useId();
    const previewId = useId();
    const previewError = preview ? subtaskLinesError(preview.lines, stageAddTitlesError) : null;

    async function submit(titles: string[], source: 'field' | 'preview') {
        if (busyRef.current) return;
        const problem = subtaskLinesError(titles, stageAddTitlesError);
        if (problem) {
            setError(problem);
            return;
        }
        const previous = value;
        const previousPreview = preview;
        if (source === 'field') setValue('');
        busyRef.current = true;
        setBusy(true);
        setError(null);
        try {
            await onAdd(titles);
            if (source === 'preview') setPreview(null);
        } catch {
            if (source === 'field') setValue(previous);
            else setPreview(previousPreview);
            setError(titles.length > 1 ? 'Could not add those subtasks.' : 'Could not add that subtask.');
        } finally {
            busyRef.current = false;
            setBusy(false);
            // The field stays enabled, so focus can remain for the next title.
            inputRef.current?.focus();
        }
    }

    function cancelPreview() {
        setPreview(null);
        setError(null);
        inputRef.current?.focus();
    }

    return (
        <div
            data-plan-subtask-add-root
            onKeyDown={event => {
                if (event.key !== 'Escape' || !preview) return;
                event.preventDefault();
                event.stopPropagation();
                cancelPreview();
            }}
        >
            <input
                ref={inputRef}
                type="text"
                value={value}
                placeholder="Add subtask"
                aria-label="Add subtask"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : preview ? previewId : undefined}
                data-plan-subtask-add
                autoComplete="off"
                onChange={event => {
                    setValue(event.target.value);
                    if (error) setError(null);
                }}
                onKeyDown={event => {
                    if (event.nativeEvent.isComposing || busyRef.current) return;
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    if (preview && !value.trim()) {
                        if (!previewError) void submit(preview.lines, 'preview');
                        return;
                    }
                    const titles = titlesFromStageAddEnter(value);
                    if (!titles) return;
                    void submit(titles, 'field');
                }}
                onPaste={event => {
                    if (busyRef.current) return;
                    const pasted = readSubtaskPaste(event.clipboardData.getData('text'));
                    if (pasted.kind === 'none') return;
                    event.preventDefault();
                    setError(null);
                    if (pasted.kind === 'line') {
                        setValue(pasted.title);
                        return;
                    }
                    setPreview({ lines: pasted.lines, titles: pasted.titles });
                }}
                className="w-full rounded-md border border-dashed border-[#3a3a40] bg-transparent px-2 py-1 text-[12px] text-[#cfcfd4] outline-none placeholder:text-[#6d6d75] focus-visible:ring-2 focus-visible:ring-[#ec4899]"
            />
            {error && (
                <p id={errorId} role="alert" data-plan-subtask-error className="mt-1 text-[11px] text-[#f87171]">{error}</p>
            )}
            {preview && (
                <div
                    id={previewId}
                    role="region"
                    aria-label="Subtask paste preview"
                    data-plan-subtask-preview
                    className="mt-1 rounded-md border border-[#2a2a2e] bg-[#141416] p-2"
                >
                    <p data-plan-subtask-count={preview.titles.length} className="text-[12px] text-[#ececee]">
                        Add {preview.titles.length} {preview.titles.length === 1 ? 'subtask' : 'subtasks'}?
                    </p>
                    <ul className="mt-1 max-h-28 overflow-auto">
                        {preview.titles.map((title, index) => (
                            <li key={`${index}:${title}`} data-plan-subtask-line={index} className="truncate py-0.5 text-[12px] text-[#cfcfd4]">
                                {title}
                            </li>
                        ))}
                    </ul>
                    {previewError && <p className="mt-1 text-[11px] text-[#f87171]">{previewError}</p>}
                    <div className="mt-1.5 flex gap-2">
                        <button
                            type="button"
                            data-plan-subtask-confirm
                            disabled={busy || Boolean(previewError)}
                            onClick={() => { if (!previewError) void submit(preview.lines, 'preview'); }}
                            className="rounded bg-[#ec4899] px-2 py-1 text-[11px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-40"
                        >
                            Add {preview.titles.length} {preview.titles.length === 1 ? 'subtask' : 'subtasks'}
                        </button>
                        <button
                            type="button"
                            data-plan-subtask-cancel
                            onClick={cancelPreview}
                            className="rounded border border-[#2a2a2e] px-2 py-1 text-[11px] text-[#cfcfd4] hover:text-white"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
