'use client';

import { useId, useRef, useState } from 'react';
import {
    PLAN_ADD_CHIP_DEFAULT,
    cyclePlanAddChip,
    planAddDestination,
    planAddPreviewMeta,
    planAddPreviewTitle,
    resolvePlanAddMonth,
    type PlanAddChip,
} from '@/lib/seo-plan/plan-add';
import {
    linesFromStageAddPaste,
    stageAddLineRole,
    stageAddLinesWithout,
    stageAddTitlesError,
    titlesFromStageAddEnter,
    type StageAddLine,
} from '@/lib/seo-plan/stage-add-lines';
import { STAGE_LIST_TIME_ZONE } from '@/lib/seo-plan/this-month';
import { cn } from '@/lib/utils';

/**
 * One add line for the whole client plan.
 *
 * Mounted at the top of StagePlanListView, in place of the per-stage and
 * per-pillar bars. The month control should pass `month` (YYYY-MM) and can
 * move this component under that header:
 *
 *   <PlanAddLine
 *     month={selectedMonth}
 *     timeZone={orgTimeZone}
 *     onAdd={submission => createTasks(submission)}
 *   />
 *
 * `onAdd` receives stage `backlog` or `onboarding`, the chip's due date
 * (null for Backlog and Onboarding), and lines of depth 0 or 1. Depth 1 is
 * a subtask of the nearest depth-0 line above it. The input is `data-plan-add`
 * for a later `c` shortcut.
 */
export interface PlanAddSubmission {
    stage: 'onboarding' | 'backlog';
    dueDate: string | null;
    items: StageAddLine[];
}

export function PlanAddLine({
    month,
    timeZone = STAGE_LIST_TIME_ZONE,
    now,
    onAdd,
}: {
    /** YYYY-MM. Omitted until the month control exists; then the current month in `timeZone`. */
    month?: string;
    timeZone?: string;
    /** Test seam. Defaults to the current time. */
    now?: Date;
    onAdd: (input: PlanAddSubmission) => Promise<void>;
}) {
    const [value, setValue] = useState('');
    const [chip, setChip] = useState<PlanAddChip>(PLAN_ADD_CHIP_DEFAULT);
    const [preview, setPreview] = useState<StageAddLine[] | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const errorId = useId();
    const menuId = useId();
    const previewId = useId();
    const resolvedMonth = resolvePlanAddMonth(month, now ?? new Date(), timeZone);
    const destination = planAddDestination(chip, resolvedMonth);
    const gate = preview ? planAddPreviewTitle(preview) : null;

    async function submit(items: StageAddLine[], source: 'field' | 'preview') {
        const problem = stageAddTitlesError(items.map(item => item.title));
        if (problem && problem !== 'Enter a title.') {
            setError(problem);
            return;
        }
        if (items.length === 0) return;
        const place = planAddDestination(chip, resolvedMonth);
        const previous = value;
        if (source === 'field') setValue('');
        setBusy(true);
        setError(null);
        setMenuOpen(false);
        try {
            await onAdd({ stage: place.stage, dueDate: place.dueDate, items });
            setChip(PLAN_ADD_CHIP_DEFAULT);
            setPreview(null);
            setValue('');
        } catch {
            if (source === 'field') setValue(previous);
            setError(items.length > 1 ? "Couldn't add those tasks." : "Couldn't add that task.");
        } finally {
            setBusy(false);
            inputRef.current?.focus();
        }
    }

    function cancelPreview() {
        setPreview(null);
        setError(null);
        inputRef.current?.focus();
    }

    function dropLine(index: number) {
        if (!preview) return;
        const next = stageAddLinesWithout(preview, index);
        setError(null);
        if (next.length <= 1) {
            setPreview(null);
            setValue(next[0]?.title ?? '');
            inputRef.current?.focus();
            return;
        }
        setPreview(next);
    }

    return (
        <div
            ref={rootRef}
            data-plan-add-root
            className="relative"
            onKeyDown={event => {
                if (event.key !== 'Escape') return;
                if (menuOpen) {
                    setMenuOpen(false);
                    return;
                }
                if (preview) {
                    event.preventDefault();
                    cancelPreview();
                }
            }}
        >
            <div className={cn(
                'flex h-10 items-center gap-2 rounded-[10px] border border-border bg-card px-3',
                'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40',
                busy && 'opacity-60',
            )}>
                <span className="w-4 text-center text-base text-primary" aria-hidden="true">+</span>
                <input
                    ref={inputRef}
                    data-plan-add
                    type="text"
                    value={value}
                    disabled={busy}
                    placeholder="Add task. Paste a list to add several."
                    aria-label="Add task"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    autoComplete="off"
                    onChange={event => {
                        setValue(event.target.value);
                        if (error) setError(null);
                    }}
                    onKeyDown={event => {
                        if (event.nativeEvent.isComposing) return;
                        if (event.key === 'Tab' && !event.shiftKey) {
                            event.preventDefault();
                            setChip(current => cyclePlanAddChip(current));
                            setMenuOpen(false);
                            return;
                        }
                        if (event.key === 'Escape') return;
                        if (event.key !== 'Enter' || busy) return;
                        event.preventDefault();
                        if (preview) {
                            if (planAddPreviewTitle(preview).canSubmit) void submit(preview, 'preview');
                            return;
                        }
                        const titles = titlesFromStageAddEnter(value);
                        if (!titles) return;
                        void submit([{ title: titles[0], depth: 0 }], 'field');
                    }}
                    onPaste={event => {
                        if (busy) return;
                        const lines = linesFromStageAddPaste(event.clipboardData.getData('text'));
                        if (!lines) return;
                        event.preventDefault();
                        setPreview(lines);
                        setError(null);
                        setMenuOpen(false);
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                />
                <button
                    type="button"
                    data-plan-add-chip={chip}
                    data-plan-add-due={destination.dueDate ?? ''}
                    data-plan-add-label={destination.label}
                    aria-haspopup="listbox"
                    aria-expanded={menuOpen}
                    aria-controls={menuId}
                    title="Tab cycles: due end of month, Backlog, Onboarding"
                    onClick={() => setMenuOpen(open => !open)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <ChipLabel chip={chip} label={destination.label} />
                    <span aria-hidden="true">▾</span>
                </button>
                <kbd className="hidden text-[11px] text-muted-foreground sm:inline" aria-hidden="true">↵</kbd>
            </div>
            {menuOpen && (
                <ul
                    id={menuId}
                    role="listbox"
                    aria-label="Where to add the task"
                    className="absolute right-8 top-11 z-30 w-48 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
                >
                    {(['month', 'backlog', 'onboarding'] as const).map(option => {
                        const choice = planAddDestination(option, resolvedMonth);
                        const selected = option === chip;
                        return (
                            <li key={option} role="presentation">
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    data-plan-add-option={option}
                                    onClick={() => {
                                        setChip(option);
                                        setMenuOpen(false);
                                        inputRef.current?.focus();
                                    }}
                                    className={cn(
                                        'flex w-full items-center px-3 py-1.5 text-left text-[13px] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                                        selected && 'text-primary',
                                    )}
                                >
                                    {choice.label}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            {error && (
                <p id={errorId} role="alert" data-plan-add-error className="mt-1 text-xs text-destructive">{error}</p>
            )}
            {preview && gate && (
                <div
                    id={previewId}
                    role="region"
                    aria-label="Paste preview"
                    data-plan-add-preview
                    className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[10px] border border-border bg-card shadow-xl"
                >
                    <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-xs">
                        <b data-plan-add-preview-title className="font-semibold">{gate.title}</b>
                        <span className="text-[11px] text-muted-foreground">{planAddPreviewMeta(preview, destination.meta)}</span>
                    </div>
                    <ul className="max-h-64 overflow-auto py-1">
                        {preview.map((line, index) => {
                            const role = stageAddLineRole(preview, index);
                            return (
                                <li
                                    key={`${index}:${line.title}`}
                                    data-plan-add-line={index}
                                    data-depth={line.depth}
                                    data-pillar={role === 'pillar' ? 'true' : undefined}
                                    className={cn(
                                        'group flex items-center gap-2 px-3 py-1.5 text-[13px]',
                                        line.depth === 1 && 'pl-8',
                                    )}
                                >
                                    <span
                                        aria-hidden="true"
                                        className={cn(
                                            'h-3.5 w-3.5 shrink-0 border border-zinc-500',
                                            role === 'pillar' ? 'rounded-full' : 'rounded',
                                        )}
                                    />
                                    <span className="min-w-0 flex-1 truncate">{line.title}</span>
                                    {role === 'pillar' && (
                                        <span className="rounded border border-border px-1.5 text-[10px] text-muted-foreground">pillar</span>
                                    )}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${line.title}`}
                                        onClick={() => dropLine(index)}
                                        className="ml-auto text-muted-foreground opacity-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 group-focus-within:opacity-100"
                                    >
                                        ×
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                        <span className="min-w-0 flex-1">Indented lines become subtasks of the line above.</span>
                        <button
                            type="button"
                            onClick={cancelPreview}
                            className="rounded-md border border-border px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Cancel <kbd>esc</kbd>
                        </button>
                        <button
                            type="button"
                            data-plan-add-submit
                            disabled={!gate.canSubmit || busy}
                            onClick={() => { if (gate.canSubmit) void submit(preview, 'preview'); }}
                            className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Add {preview.length} {preview.length === 1 ? 'task' : 'tasks'} <span aria-hidden="true">↵</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function ChipLabel({ chip, label }: { chip: PlanAddChip; label: string }) {
    if (chip === 'month') {
        const date = label.replace(/^Due\s+/, '');
        return <span>Due <span className="font-semibold text-foreground">{date}</span></span>;
    }
    if (chip === 'backlog') {
        return <span>Backlog <span className="font-semibold text-foreground">no date</span></span>;
    }
    return <span className="font-semibold text-foreground">Onboarding</span>;
}
