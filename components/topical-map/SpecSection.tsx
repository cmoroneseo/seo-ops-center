'use client';

import { useState } from 'react';
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
import { PILL_CLASS, SOURCE_STYLES } from './constants';
import { cn } from '@/lib/utils';

const labelClass = 'text-xs font-medium uppercase tracking-wider text-muted-foreground';
const fieldClass = 'mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring';

interface SpecSectionProps {
    record: TopicalMapRecord;
    draft: TopicalMapRecord;
    readOnly: boolean;
    onDraft: (patch: Partial<TopicalMapRecord>) => void;
    onSave: (patch: SpecFieldPatch) => Promise<void>;
}

function countValue(value: number | undefined): string {
    if (value == null || value <= 0) return '';
    return String(value);
}

export function SpecSection({ record, draft, readOnly, onDraft, onSave }: SpecSectionProps) {
    const [answerError, setAnswerError] = useState('');
    const [rangeError, setRangeError] = useState('');
    const answer = draft.answerFirst60 ?? '';
    const words = countWords(answer);

    const save = async (patch: SpecFieldPatch) => {
        const parsed = parseSpecPatch(patch);
        if (!parsed.ok) {
            if (patch.answerFirst60 !== undefined) setAnswerError(parsed.error);
            if (patch.wordCountMin !== undefined || patch.wordCountMax !== undefined) setRangeError(parsed.error);
            return;
        }
        if (patch.answerFirst60 !== undefined) setAnswerError('');
        if (patch.wordCountMin !== undefined || patch.wordCountMax !== undefined) setRangeError('');
        await onSave(parsed.patch);
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
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Spec</h3>

            <div>
                <label htmlFor="spec-query" className={labelClass}>Target query</label>
                <input
                    id="spec-query"
                    value={draft.targetQuery}
                    placeholder={EMPTY_SPEC}
                    disabled={readOnly}
                    onChange={event => onDraft({ targetQuery: event.target.value })}
                    onBlur={() => {
                        if (draft.targetQuery !== record.targetQuery) void save({ targetQuery: draft.targetQuery });
                    }}
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
                        onChange={event => onDraft({ wordCountMin: event.target.value ? Number(event.target.value.replace(/\D/g, '')) : 0 })}
                        onBlur={() => void save({ wordCountMin: draft.wordCountMin > 0 ? draft.wordCountMin : null, wordCountMax: draft.wordCountMax > 0 ? draft.wordCountMax : null })}
                        className={fieldClass}
                    />
                    <input
                        aria-label="Word range maximum"
                        inputMode="numeric"
                        value={countValue(draft.wordCountMax)}
                        placeholder={EMPTY_SPEC}
                        disabled={readOnly}
                        onChange={event => onDraft({ wordCountMax: event.target.value ? Number(event.target.value.replace(/\D/g, '')) : 0 })}
                        onBlur={() => void save({ wordCountMin: draft.wordCountMin > 0 ? draft.wordCountMin : null, wordCountMax: draft.wordCountMax > 0 ? draft.wordCountMax : null })}
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
                        onDraft({ answerFirst60: event.target.value });
                        if (answerError && countWords(event.target.value) <= 60) setAnswerError('');
                    }}
                    onBlur={() => void save({ answerFirst60: answer })}
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
                    onChange={event => onDraft({ uniqueAngle: event.target.value })}
                    onBlur={() => {
                        if ((draft.uniqueAngle ?? '') !== (record.uniqueAngle ?? '')) void save({ uniqueAngle: draft.uniqueAngle ?? '' });
                    }}
                    className={fieldClass}
                />
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label htmlFor="spec-date" className={labelClass}>Scheduled for</label>
                    <input
                        id="spec-date"
                        type="date"
                        value={draft.scheduledFor ?? ''}
                        disabled={readOnly}
                        onChange={event => onDraft({ scheduledFor: event.target.value })}
                        onBlur={() => {
                            if ((draft.scheduledFor ?? '') !== (record.scheduledFor ?? '')) {
                                void save({ scheduledFor: draft.scheduledFor || null });
                            }
                        }}
                        className={fieldClass}
                    />
                    {!draft.scheduledFor && <p className="mt-1 text-sm text-muted-foreground">{EMPTY_SPEC}</p>}
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
                                const next = items.map((entry, entryIndex) => entryIndex === index ? { ...entry, url: event.target.value } : entry);
                                onChange(next);
                            }}
                            onBlur={() => onCommit(items)}
                            className={fieldClass}
                        />
                        <input
                            aria-label={`Stays out of reason ${index + 1}`}
                            value={item.reason ?? ''}
                            placeholder="Reason"
                            disabled={readOnly}
                            onChange={event => {
                                const reason = event.target.value;
                                const next = items.map((entry, entryIndex) => entryIndex === index ? { ...entry, reason } : entry);
                                onChange(next);
                            }}
                            onBlur={() => onCommit(items)}
                            className={fieldClass}
                        />
                        {!readOnly && (
                            <button
                                type="button"
                                aria-label={`Remove stays out of ${index + 1}`}
                                onClick={() => {
                                    const next = items.filter((_, entryIndex) => entryIndex !== index);
                                    onChange(next);
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
                    onClick={() => onChange([...items, { url: '' }])}
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
                                const next = items.map((entry, entryIndex) => entryIndex === index ? { ...entry, anchorText: event.target.value } : entry);
                                onChange(next);
                            }}
                            onBlur={() => onCommit(items)}
                            className={fieldClass}
                        />
                        <input
                            aria-label={`Planned link destination ${index + 1}`}
                            value={item.destinationUrl}
                            placeholder="/path or title"
                            disabled={readOnly}
                            onChange={event => {
                                const next = items.map((entry, entryIndex) => entryIndex === index ? { ...entry, destinationUrl: event.target.value } : entry);
                                onChange(next);
                            }}
                            onBlur={() => onCommit(items)}
                            className={fieldClass}
                        />
                        {!readOnly && (
                            <button
                                type="button"
                                aria-label={`Remove planned link ${index + 1}`}
                                onClick={() => {
                                    const next = items.filter((_, entryIndex) => entryIndex !== index);
                                    onChange(next);
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
                    onClick={() => onChange([...items, { anchorText: '', destinationUrl: '' }])}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <Plus className="h-3.5 w-3.5" /> Add a link
                </button>
            )}
        </div>
    );
}
