'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, Link2Off, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { safeHref } from '@/lib/links/safe-href';
import {
    activityChoicePatch,
    addReferenceLinkPatch,
    budgetChoicePatch,
    buildActivityEdit,
    buildImportEdit,
    buildSuggestionEdit,
    createInFlightRequestCache,
    currentRequestItems,
    draftForRow,
    normalizeImportDraft,
    removeReferenceLinkPatch,
    type ImportDraft,
    type ImportEntryEdit,
} from '@/lib/timesheets/import-review-ui';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { QueueRow } from '@/lib/timesheets/import-queue-route';
import type { Suggestion } from '@/lib/timesheets/suggestions';
import type { ClientProject, TimeLogReferenceLink } from '@/lib/types';
import { ActivityPicker } from './ActivityPicker';

interface ImportRowProps {
    row: QueueRow;
    clients: ClientProject[];
    organizationId: string;
    isSelected: boolean;
    isManager: boolean;
    isBusy: boolean;
    onToggleSelect: () => void;
    onEdit: (edit: ImportEntryEdit) => void | Promise<void>;
    onApprove: () => void;
    onBounce: (note: string) => void;
}

const suggestionRequests = createInFlightRequestCache<Suggestion[]>();

function requestSuggestions(url: string): Promise<Suggestion[]> {
    return suggestionRequests.get(url, async () => {
        const response = await fetch(url);
        if (!response.ok) return [];
        const body = await response.json() as { suggestions?: Suggestion[] };
        return body.suggestions ?? [];
    });
}

/**
 * The documents a block of time produced or cited.
 *
 * The team habitually pastes a Google Doc into their time notes — a reviewed
 * August entry named a 6-month SEO roadmap with the doc title as a live
 * hyperlink. Chips keep those visible while a manager scans a queue, and keep
 * them as data rather than as prose a future client-month review cannot read.
 *
 * A hand-rolled disclosure (`useState` + an outside-click ref) rather than a
 * Radix popover, matching the rest of this codebase.
 */
function ReferenceLinkChips({
    links,
    rowLabel,
    disabled,
    onAdd,
    onRemove,
}: {
    links: TimeLogReferenceLink[];
    rowLabel: string;
    disabled: boolean;
    /** Returns the reason it was refused, or null once added. */
    onAdd: (label: string, url: string) => string | null;
    onRemove: (index: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const [labelDraft, setLabelDraft] = useState('');
    const [urlDraft, setUrlDraft] = useState('');
    const [error, setError] = useState<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const panelId = useId();
    const errorId = `${panelId}-error`;

    useEffect(() => {
        if (!open) return;
        const onDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const submit = () => {
        const reason = onAdd(labelDraft, urlDraft);
        if (reason) { setError(reason); return; }
        setLabelDraft('');
        setUrlDraft('');
        setError(null);
        setOpen(false);
    };

    return (
        <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
            <ul className="flex flex-wrap items-center gap-2" aria-label={`Documents for ${rowLabel}`}>
                {links.map((link, index) => {
                    // Already validated on the way in, checked again on the way
                    // out: the column is jsonb and its shape is a claim.
                    const href = safeHref(link.url);
                    return (
                        <li
                            key={`${link.url}-${index}`}
                            className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-xs text-muted-foreground"
                        >
                            {href ? (
                                <a
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex max-w-[220px] items-center gap-1 truncate text-primary hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                    title={link.label}
                                >
                                    <span className="truncate">{link.label}</span>
                                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                                    <span className="sr-only">(opens in a new tab)</span>
                                </a>
                            ) : (
                                <span className="max-w-[220px] truncate" title={link.label}>{link.label}</span>
                            )}
                            <button
                                type="button"
                                disabled={disabled}
                                onClick={() => onRemove(index)}
                                aria-label={`Remove ${link.label}`}
                                className="shrink-0 rounded-full text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                <X className="h-3 w-3" aria-hidden />
                            </button>
                        </li>
                    );
                })}
            </ul>

            <button
                type="button"
                disabled={disabled}
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                onClick={() => { setOpen(current => !current); setError(null); }}
                className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
                <Plus className="h-3 w-3" aria-hidden />
                Add link
            </button>

            {open && (
                <div
                    id={panelId}
                    className="absolute left-0 top-full z-50 mt-1 w-80 rounded-xl border border-border bg-card p-3 shadow-xl"
                >
                    <label className="block text-xs text-muted-foreground" htmlFor={`${panelId}-label`}>
                        Document name
                    </label>
                    <input
                        id={`${panelId}-label`}
                        type="text"
                        value={labelDraft}
                        onChange={event => { setLabelDraft(event.target.value); setError(null); }}
                        placeholder="6-Month SEO Roadmap"
                        className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />

                    <label className="mt-2 block text-xs text-muted-foreground" htmlFor={`${panelId}-url`}>
                        Link
                    </label>
                    <input
                        id={`${panelId}-url`}
                        type="url"
                        value={urlDraft}
                        onChange={event => { setUrlDraft(event.target.value); setError(null); }}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }}
                        placeholder="https://docs.google.com/…"
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />

                    {error && (
                        <p id={errorId} role="alert" className="mt-2 text-xs text-amber-500">
                            {error}
                        </p>
                    )}

                    <div className="mt-3 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => { setOpen(false); setError(null); }}
                            className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ImportRow({
    row,
    clients,
    organizationId,
    isSelected,
    isManager,
    isBusy,
    onToggleSelect,
    onEdit,
    onApprove,
    onBounce,
}: ImportRowProps) {
    const [draft, setDraft] = useState<ImportDraft>(() => draftForRow(row));
    const draftRef = useRef(draft);
    const [suggestionResult, setSuggestionResult] = useState({
        requestKey: '',
        items: [] as Suggestion[],
    });
    const heading = formatDayHeading(row.date);
    const isPending = row.importStatus === 'pending_review';
    const suggestionParams = new URLSearchParams({ organizationId, date: row.date });
    if (draft.clientId) suggestionParams.set('clientId', draft.clientId);
    const suggestionRequestKey = `/api/timesheets/imports/suggestions?${suggestionParams}`;
    const suggestions = currentRequestItems(suggestionResult, suggestionRequestKey);

    useEffect(() => {
        let active = true;
        void requestSuggestions(suggestionRequestKey)
            .then(next => {
                if (active) {
                    setSuggestionResult({ requestKey: suggestionRequestKey, items: next });
                }
            })
            .catch(() => {
                if (active) {
                    setSuggestionResult({ requestKey: suggestionRequestKey, items: [] });
                }
            });
        return () => { active = false; };
    }, [suggestionRequestKey]);

    const updateDraft = (patch: Partial<ImportDraft>): ImportDraft => {
        const next = normalizeImportDraft(row, { ...draftRef.current, ...patch });
        draftRef.current = next;
        setDraft(() => next);
        return next;
    };

    const save = (patch: Partial<ImportDraft> = {}) => {
        const edit = buildImportEdit(row, updateDraft(patch));
        if (edit) void onEdit(edit);
    };

    /** Returns the reason the link was refused, or null once it is added. */
    const addReferenceLink = (label: string, url: string): string | null => {
        const result = addReferenceLinkPatch(draftRef.current, label, url);
        if (!result.ok) return result.error;
        save(result.patch);
        return null;
    };

    const removeReferenceLink = (index: number) => {
        save(removeReferenceLinkPatch(draftRef.current, index));
    };

    return (
        <li
            className={cn(
                'rounded-xl border bg-card p-4',
                isSelected ? 'border-primary' : 'border-border',
                isPending && 'border-amber-500/40 bg-amber-500/5',
            )}
        >
            <div className="flex flex-wrap items-center gap-3">
                <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isBusy}
                    onChange={onToggleSelect}
                    aria-label={`Select ${heading.weekday} ${heading.date} entry`}
                    className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />

                <span className="w-24 text-sm text-muted-foreground">
                    {heading.weekday} {heading.date}
                </span>
                <span className="w-16 text-sm font-medium tabular-nums text-foreground">
                    {formatDuration(row.minutes, { zero: '0m' })}
                </span>
                <span className="w-40 truncate text-sm text-muted-foreground" title={row.basecampProjectName ?? ''}>
                    {row.basecampProjectName ?? 'Unknown project'}
                </span>

                <select
                    aria-label={`Client for ${heading.weekday} ${heading.date}`}
                    value={draft.clientId ?? ''}
                    disabled={isBusy || row.isInternal}
                    onChange={event => {
                        const nextClientId = event.target.value || null;
                        const next = updateDraft({ clientId: nextClientId });
                        const edit = buildImportEdit(row, next);
                        if (edit) void onEdit(edit);
                    }}
                    className="w-44 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <option value="">{row.isInternal ? 'Internal' : 'Choose client…'}</option>
                    {clients.map(client => (
                        <option key={client.id} value={client.id}>{client.clientName}</option>
                    ))}
                </select>

                <div className="w-56">
                    <ActivityPicker
                        id={`activity-${row.id}`}
                        label={`Activities for ${heading.weekday} ${heading.date}`}
                        value={draft.activityKeys}
                        disabled={isBusy}
                        onChange={nextActivityKeys => {
                            const current = draftRef.current;
                            // Patch the draft even when the selection empties —
                            // clearing every tag is a real state, and the row
                            // then reports `no_activity` instead of saving.
                            const patch = activityChoicePatch(current, nextActivityKeys);
                            const edit = buildActivityEdit(row, current, nextActivityKeys);
                            updateDraft(patch);
                            if (edit) void onEdit(edit);
                        }}
                    />
                </div>

                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={draft.countsTowardBudget}
                        disabled={isBusy || draft.activityKeys.length === 0 || row.isInternal}
                        onChange={event => {
                            save(budgetChoicePatch(event.target.checked));
                        }}
                        className="h-4 w-4 accent-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                    Budget
                </label>

                {row.issues.includes('no_task_link') && (
                    <span className="text-muted-foreground" title="Not linked to a task">
                        <Link2Off className="h-3.5 w-3.5" aria-hidden />
                        <span className="sr-only">Not linked to a task</span>
                    </span>
                )}
                {isPending && (
                    <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-xs text-amber-500">
                        Awaiting review
                    </span>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                <input
                    type="text"
                    value={draft.detail}
                    disabled={isBusy}
                    aria-label={`Optional detail for ${heading.weekday} ${heading.date}`}
                    placeholder="Add detail (optional)"
                    onChange={event => { updateDraft({ detail: event.target.value }); }}
                    onBlur={() => save()}
                    className="min-w-[240px] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />

                {suggestions.map((suggestion, index) => (
                    <button
                        key={`${suggestion.taskId ?? suggestion.title}-${index}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            const edit = buildSuggestionEdit(row, draftRef.current, suggestion);
                            if (!edit) {
                                updateDraft({ detail: suggestion.title });
                                return;
                            }
                            updateDraft(edit);
                            void onEdit(edit);
                        }}
                        className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        {suggestion.title}
                    </button>
                ))}
            </div>

            <div className="mt-3 pl-7">
                <ReferenceLinkChips
                    links={draft.referenceLinks}
                    rowLabel={`${heading.weekday} ${heading.date}`}
                    disabled={isBusy}
                    onAdd={addReferenceLink}
                    onRemove={removeReferenceLink}
                />
            </div>

            {row.issues.includes('no_member') && (
                <p className="mt-2 flex items-start gap-2 pl-7 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    No org member is mapped to this Basecamp person. Map them in Settings to submit this entry.
                </p>
            )}

            {row.reviewNote && (
                <p className="mt-2 flex items-start gap-2 pl-7 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Sent back: {row.reviewNote}
                </p>
            )}

            {isManager && isPending && (
                <div className="mt-3 flex gap-3 pl-7" aria-label="Manager review actions">
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={onApprove}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Approve
                    </button>
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            const note = window.prompt('Why is this going back?');
                            if (note?.trim()) onBounce(note);
                        }}
                        className="rounded-lg border border-amber-500/40 px-3 py-1.5 text-sm text-amber-500 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Send back
                    </button>
                </div>
            )}
        </li>
    );
}
