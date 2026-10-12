'use client';

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { MapOutgoingLink, MapScopeExclusion, TopicalMapRecord } from '@/lib/types';
import {
    countWords,
    displayText,
    displayWordRange,
    EMPTY_SPEC,
    parseSpecPatch,
    SOURCE_TITLE,
    type SpecFieldPatch,
} from '@/lib/topical-map/spec';
import { dateFieldPatch, textFieldPatch, wordRangePatch, type TextSpecField } from '@/lib/topical-map/spec-save';
import { PILL_CLASS, SOURCE_STYLES } from './constants';
import { cn } from '@/lib/utils';

const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground';
const fieldClass = 'mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

interface SpecSectionProps {
    draft: TopicalMapRecord;
    saved: SpecFieldPatch;
    readOnly: boolean;
    saveLabel: string;
    onDraft: (patch: Partial<TopicalMapRecord>) => void;
    onSave: (patch: SpecFieldPatch) => Promise<void>;
}

function countValue(value: number | undefined): string {
    if (value == null || value <= 0) return '';
    return String(value);
}

function savedText(saved: SpecFieldPatch, field: TextSpecField): string | null {
    const value = saved[field];
    return typeof value === 'string' ? value : null;
}

export function SpecSection({ draft, saved, readOnly, saveLabel, onDraft, onSave }: SpecSectionProps) {
    const [answerError, setAnswerError] = useState('');
    const [angleError, setAngleError] = useState('');
    const [rangeError, setRangeError] = useState('');
    const [dateError, setDateError] = useState('');
    const range = useRef({
        min: draft.wordCountMin > 0 ? String(draft.wordCountMin) : '',
        max: draft.wordCountMax > 0 ? String(draft.wordCountMax) : '',
    });
    const answer = draft.answerFirst60 ?? '';
    const words = countWords(answer);

    const save = async (patch: SpecFieldPatch) => {
        const parsed = parseSpecPatch(patch);
        if (!parsed.ok) {
            if (patch.answerFirst60 !== undefined) setAnswerError(parsed.error);
            if (patch.uniqueAngle !== undefined) setAngleError(parsed.error);
            if (patch.wordCountMin !== undefined || patch.wordCountMax !== undefined) setRangeError(parsed.error);
            if (patch.scheduledFor !== undefined) setDateError(parsed.error);
            return;
        }
        if (patch.answerFirst60 !== undefined) setAnswerError('');
        if (patch.uniqueAngle !== undefined) setAngleError('');
        if (patch.wordCountMin !== undefined || patch.wordCountMax !== undefined) setRangeError('');
        if (patch.scheduledFor !== undefined) setDateError('');
        await onSave(parsed.patch);
    };

    const commitText = (event: 'change' | 'blur', field: TextSpecField, value: string) => {
        onDraft({ [field]: value });
        const patch = textFieldPatch(event, field, value, savedText(saved, field));
        if (patch) void save(patch);
    };

    const commitDate = (value: string) => {
        onDraft({ scheduledFor: value });
        const result = dateFieldPatch(value, typeof saved.scheduledFor === 'string' ? saved.scheduledFor : null);
        if (!result.ok) {
            setDateError(result.error);
            return;
        }
        setDateError('');
        if (result.patch) void save(result.patch);
    };

    const commitRange = () => {
        void save(wordRangePatch(range.current.min, range.current.max));
    };

    const commitExclusions = (items: MapScopeExclusion[]) => {
        const cleaned = items.filter(item => item.url.trim());
        void save({ scopeExclusions: cleaned });
    };

    const commitLinks = (items: MapOutgoingLink[]) => {
        const cleaned = items.filter(item => item.anchorText.trim() && item.destinationUrl.trim());
        void save({ outgoingLinks: cleaned });
    };

    return (
        <section aria-label="Page spec" className="space-y-4 border-t border-border/60 pt-5">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spec</h3>
                <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{saveLabel}</p>
            </div>

            <div>
                <label htmlFor="spec-query" className={labelClass}>Target query</label>
                <input
                    id="spec-query"
                    value={draft.targetQuery}
                    placeholder={EMPTY_SPEC}
                    disabled={readOnly}
                    onChange={event => commitText('change', 'targetQuery', event.target.value)}
                    onBlur={event => commitText('blur', 'targetQuery', event.currentTarget.value)}
                    className={fieldClass}
                />
            </div>

            <div>
                <p className={labelClass}>Word range</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                    {displayWordRange(draft.wordCountMin, draft.wordCountMax)}
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                    <input
                        aria-label="Word range minimum"
                        inputMode="numeric"
                        value={countValue(draft.wordCountMin)}
                        placeholder={EMPTY_SPEC}
                        disabled={readOnly}
                        onChange={event => {
                            const raw = event.target.value.replace(/\D/g, '');
                            range.current.min = raw;
                            onDraft({ wordCountMin: raw ? Number(raw) : 0 });
                        }}
                        onBlur={commitRange}
                        className={fieldClass}
                    />
                    <input
                        aria-label="Word range maximum"
                        inputMode="numeric"
                        value={countValue(draft.wordCountMax)}
                        placeholder={EMPTY_SPEC}
                        disabled={readOnly}
                        onChange={event => {
                            const raw = event.target.value.replace(/\D/g, '');
                            range.current.max = raw;
                            onDraft({ wordCountMax: raw ? Number(raw) : 0 });
                        }}
                        onBlur={commitRange}
                        className={fieldClass}
                    />
                </div>
                {rangeError && <p role="alert" className="mt-1 text-xs text-red-500">{rangeError}</p>}
            </div>

            <div>
                <label htmlFor="spec-answer" className={labelClass}>Answer in the first 60 words</label>
                <textarea
                    id="spec-answer"
                    value={answer}
                    placeholder={EMPTY_SPEC}
                    disabled={readOnly}
                    rows={4}
                    aria-invalid={answerError ? true : undefined}
                    aria-describedby="spec-answer-count"
                    onChange={event => {
                        commitText('change', 'answerFirst60', event.target.value);
                        if (answerError && countWords(event.target.value) <= 60) setAnswerError('');
                    }}
                    onBlur={event => commitText('blur', 'answerFirst60', event.currentTarget.value)}
                    className={fieldClass}
                />
                <p id="spec-answer-count" className={cn('mt-1 text-xs', words > 60 ? 'text-red-500' : 'text-muted-foreground')}>
                    {words === 0 ? 'Up to 60 words' : `${words} of 60 words`}
                </p>
                {answerError && <p role="alert" className="mt-1 text-xs text-red-500">{answerError}</p>}
            </div>

            <div>
                <label htmlFor="spec-angle" className={labelClass}>Unique angle</label>
                <textarea
                    id="spec-angle"
                    value={draft.uniqueAngle ?? ''}
                    placeholder={EMPTY_SPEC}
                    disabled={readOnly}
                    rows={3}
                    onChange={event => commitText('change', 'uniqueAngle', event.target.value)}
                    onBlur={event => commitText('blur', 'uniqueAngle', event.currentTarget.value)}
                    className={fieldClass}
                />
                {angleError && <p role="alert" className="mt-1 text-xs text-red-500">{angleError}</p>}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label htmlFor="spec-date" className={labelClass}>Scheduled for</label>
                    <input
                        id="spec-date"
                        type="date"
                        value={draft.scheduledFor ?? ''}
                        placeholder={EMPTY_SPEC}
                        disabled={readOnly}
                        onChange={event => commitDate(event.target.value)}
                        onBlur={event => commitDate(event.currentTarget.value)}
                        className={fieldClass}
                    />
                    {dateError && <p role="alert" className="mt-1 text-xs text-red-500">{dateError}</p>}
                </div>
                <div>
                    <label htmlFor="spec-status" className={labelClass}>Spec status</label>
                    <select
                        id="spec-status"
                        value={draft.specStatus ?? ''}
                        disabled={readOnly}
                        onChange={event => {
                            const specStatus = event.target.value === 'draft' || event.target.value === 'ready' ? event.target.value : null;
                            onDraft({ specStatus: specStatus ?? undefined });
                            void save({ specStatus });
                        }}
                        className={fieldClass}
                    >
                        <option value="">{EMPTY_SPEC}</option>
                        <option value="draft">Draft</option>
                        <option value="ready">Ready</option>
                    </select>
                </div>
            </div>

            <div>
                <p className={labelClass}>Source</p>
                <div className="mt-1.5">
                    {draft.source ? (
                        <span title={SOURCE_TITLE[draft.source]} className={cn(PILL_CLASS, SOURCE_STYLES[draft.source])}>
                            {draft.source}
                        </span>
                    ) : (
                        <span className="text-sm text-muted-foreground">{EMPTY_SPEC}</span>
                    )}
                </div>
            </div>

            <ExclusionList
                items={draft.scopeExclusions}
                readOnly={readOnly}
                onChange={items => onDraft({ scopeExclusions: items })}
                onCommit={commitExclusions}
            />
            <LinkList
                items={draft.outgoingLinks}
                readOnly={readOnly}
                onChange={items => onDraft({ outgoingLinks: items })}
                onCommit={commitLinks}
            />
        </section>
    );
}

function ExclusionList({
    items, readOnly, onChange, onCommit,
}: {
    items: MapScopeExclusion[];
    readOnly: boolean;
    onChange: (items: MapScopeExclusion[]) => void;
    onCommit: (items: MapScopeExclusion[]) => void;
}) {
    const latest = useRef(items);
    const change = (next: MapScopeExclusion[]) => {
        latest.current = next;
        onChange(next);
    };
    return (
        <div>
            <p className={labelClass}>Stays out of</p>
            {items.length === 0 && <p className="mt-1.5 text-sm text-muted-foreground">{EMPTY_SPEC}</p>}
            <ul className="mt-1.5 space-y-2">
                {items.map((item, index) => (
                    <li key={index} className="flex items-start gap-2">
                        <input
                            aria-label={`Stays out of ${index + 1}`}
                            value={item.url}
                            placeholder={EMPTY_SPEC}
                            disabled={readOnly}
                            onChange={event => {
                                change(latest.current.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry));
                            }}
                            onBlur={() => onCommit(latest.current)}
                            className={fieldClass}
                        />
                        <input
                            aria-label={`Stays out of reason ${index + 1}`}
                            value={item.reason ?? ''}
                            placeholder="Reason"
                            disabled={readOnly}
                            onChange={event => {
                                const reason = event.target.value;
                                change(latest.current.map((entry, entryIndex) => entryIndex === index ? { ...entry, reason } : entry));
                            }}
                            onBlur={() => onCommit(latest.current)}
                            className={fieldClass}
                        />
                        {!readOnly && (
                            <button
                                type="button"
                                aria-label={`Remove stays out of ${index + 1}`}
                                onClick={() => {
                                    const next = items.filter((_, entryIndex) => entryIndex !== index);
                                    change(next);
                                    onCommit(next);
                                }}
                                className="mt-1.5 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {!readOnly && (
                <button
                    type="button"
                    onClick={() => change([...items, { url: '' }])}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Plus className="h-3.5 w-3.5" /> Add a page or topic
                </button>
            )}
            {items.length > 0 && items.every(item => !item.url.trim()) && (
                <p className="sr-only">{displayText('')}</p>
            )}
        </div>
    );
}

function LinkList({
    items, readOnly, onChange, onCommit,
}: {
    items: MapOutgoingLink[];
    readOnly: boolean;
    onChange: (items: MapOutgoingLink[]) => void;
    onCommit: (items: MapOutgoingLink[]) => void;
}) {
    const latest = useRef(items);
    const change = (next: MapOutgoingLink[]) => {
        latest.current = next;
        onChange(next);
    };
    return (
        <div>
            <p className={labelClass}>Planned links</p>
            {items.length === 0 && <p className="mt-1.5 text-sm text-muted-foreground">{EMPTY_SPEC}</p>}
            <ul className="mt-1.5 space-y-2">
                {items.map((item, index) => (
                    <li key={index} className="flex items-start gap-2">
                        <input
                            aria-label={`Planned link anchor ${index + 1}`}
                            value={item.anchorText}
                            placeholder={EMPTY_SPEC}
                            disabled={readOnly}
                            onChange={event => {
                                change(latest.current.map((entry, entryIndex) => entryIndex === index ? { ...entry, anchorText: event.target.value } : entry));
                            }}
                            onBlur={() => onCommit(latest.current)}
                            className={fieldClass}
                        />
                        <input
                            aria-label={`Planned link destination ${index + 1}`}
                            value={item.destinationUrl}
                            placeholder="/path or title"
                            disabled={readOnly}
                            onChange={event => {
                                change(latest.current.map((entry, entryIndex) => entryIndex === index ? { ...entry, destinationUrl: event.target.value } : entry));
                            }}
                            onBlur={() => onCommit(latest.current)}
                            className={fieldClass}
                        />
                        {!readOnly && (
                            <button
                                type="button"
                                aria-label={`Remove planned link ${index + 1}`}
                                onClick={() => {
                                    const next = items.filter((_, entryIndex) => entryIndex !== index);
                                    change(next);
                                    onCommit(next);
                                }}
                                className="mt-1.5 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
            {!readOnly && (
                <button
                    type="button"
                    onClick={() => change([...items, { anchorText: '', destinationUrl: '' }])}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Plus className="h-3.5 w-3.5" /> Add a link
                </button>
            )}
        </div>
    );
}
