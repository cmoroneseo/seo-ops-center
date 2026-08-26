'use client';

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    budgetDefaultFor,
    findActivity,
} from '@/lib/timesheets/activities';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { QueueRow } from '@/lib/timesheets/import-queue-route';
import type { Suggestion } from '@/lib/timesheets/suggestions';
import type { ClientProject } from '@/lib/types';
import { ActivityPicker } from './ActivityPicker';

export interface ImportEntryEdit {
    activityKey: string;
    detail: string;
    clientId: string | null;
    countsTowardBudget?: boolean;
}

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

const suggestionRequests = new Map<string, Promise<Suggestion[]>>();

function requestSuggestions(url: string): Promise<Suggestion[]> {
    const existing = suggestionRequests.get(url);
    if (existing) return existing;

    const request = fetch(url)
        .then(async response => {
            if (!response.ok) return [];
            const body = await response.json() as { suggestions?: Suggestion[] };
            return body.suggestions ?? [];
        })
        .catch(() => []);
    suggestionRequests.set(url, request);
    return request;
}

export function detailForRow(row: QueueRow): string {
    const activity = row.activityKey ? findActivity(row.activityKey) : null;
    if (!activity) return row.description;
    if (row.description === activity.label) return '';
    const prefix = `${activity.label} — `;
    return row.description.startsWith(prefix) ? row.description.slice(prefix.length) : row.description;
}

export function buildActivityEdit(
    row: QueueRow,
    detail: string,
    activityKey: string,
    clientId: string | null = row.clientId,
): ImportEntryEdit {
    return {
        activityKey,
        detail,
        clientId,
        countsTowardBudget: budgetDefaultFor(activityKey),
    };
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
    const [activityKey, setActivityKey] = useState(row.activityKey);
    const [clientId, setClientId] = useState(row.clientId);
    const [countsTowardBudget, setCountsTowardBudget] = useState(row.countsTowardBudget);
    const [detail, setDetail] = useState(() => detailForRow(row));
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const heading = formatDayHeading(row.date);
    const isPending = row.importStatus === 'pending_review';

    useEffect(() => {
        setActivityKey(row.activityKey);
        setClientId(row.clientId);
        setCountsTowardBudget(row.countsTowardBudget);
        setDetail(detailForRow(row));
    }, [row]);

    useEffect(() => {
        let active = true;
        const params = new URLSearchParams({ organizationId, date: row.date });
        if (clientId) params.set('clientId', clientId);
        void requestSuggestions(`/api/timesheets/imports/suggestions?${params}`)
            .then(next => { if (active) setSuggestions(next); });
        return () => { active = false; };
    }, [organizationId, row.date, clientId]);

    const save = (patch: Partial<ImportEntryEdit> = {}) => {
        if (!activityKey && !patch.activityKey) return;
        void onEdit({
            activityKey: activityKey ?? '',
            detail,
            clientId,
            countsTowardBudget,
            ...patch,
        });
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
                    value={clientId ?? ''}
                    disabled={isBusy || row.isInternal}
                    onChange={event => {
                        const nextClientId = event.target.value || null;
                        setClientId(nextClientId);
                        if (activityKey) save({ clientId: nextClientId });
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
                        value={activityKey}
                        disabled={isBusy}
                        onChange={nextActivityKey => {
                            setActivityKey(nextActivityKey || null);
                            const edit = buildActivityEdit(row, detail, nextActivityKey, clientId);
                            setCountsTowardBudget(edit.countsTowardBudget ?? false);
                            if (nextActivityKey) void onEdit(edit);
                        }}
                    />
                </div>

                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={countsTowardBudget}
                        disabled={isBusy || !activityKey || row.isInternal}
                        onChange={event => {
                            setCountsTowardBudget(event.target.checked);
                            save({ countsTowardBudget: event.target.checked });
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
                    value={detail}
                    disabled={isBusy}
                    aria-label={`Optional detail for ${heading.weekday} ${heading.date}`}
                    placeholder="Add detail (optional)"
                    onChange={event => setDetail(event.target.value)}
                    onBlur={() => save()}
                    className="min-w-[240px] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                />

                {suggestions.map((suggestion, index) => (
                    <button
                        key={`${suggestion.taskId ?? suggestion.title}-${index}`}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            const suggestedActivity = suggestion.activityKey ?? activityKey;
                            setDetail(suggestion.title);
                            if (!suggestedActivity) return;
                            setActivityKey(suggestedActivity);
                            const edit = buildActivityEdit(row, suggestion.title, suggestedActivity, clientId);
                            setCountsTowardBudget(edit.countsTowardBudget ?? false);
                            void onEdit(edit);
                        }}
                        className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        {suggestion.title}
                    </button>
                ))}
            </div>

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
