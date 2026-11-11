'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';

import { QuotaBar } from '@/components/content/QuotaBar';
import { updateContentRecord } from '@/lib/content/client';
import {
    asContentBoardRecord,
    boardProductionStatus,
    clientReviewHref,
    contentMonthChoices,
    currentWorkMonth,
    groupApprovedContent,
    topicMapHref,
    UNSCHEDULED_LABEL,
    type ContentBoardRecord,
} from '@/lib/content/board';
import { contentQuota } from '@/lib/content/quota';
import { displayDate, EMPTY_SPEC } from '@/lib/topical-map/spec';
import {
    canMarkAlreadyLive,
    PRODUCTION_STATUS_LABEL,
    PRODUCTION_STATUSES,
    PUBLISHED_NOTE,
    readHttpUrl,
    readWorkMonth,
    workMonthLabel,
} from '@/lib/topical-map/production';
import { PILL_CLASS, PRODUCTION_STATUS_STYLES } from '@/components/topical-map/constants';
import { cn } from '@/lib/utils';
import type { ProductionStatus, TopicalMapRecord } from '@/lib/types';
import { getTopicalMapByClient } from '@/lib/supabase/topical-map';

const fieldClass = 'w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';

export function ContentBoardView({
    clientId,
    records,
    contentPieces,
    readOnly,
    today,
    savingId,
    error,
    onStatus,
    onMonth,
}: {
    clientId: string;
    records: ContentBoardRecord[];
    contentPieces: number | null;
    readOnly: boolean;
    today: string;
    savingId?: string | null;
    error?: string;
    onStatus: (recordId: string, status: ProductionStatus) => void;
    onMonth: (recordId: string, workMonth: string | null) => void;
}) {
    const groups = groupApprovedContent(records);
    const reviewHref = clientReviewHref(clientId);
    return (
        <section className="space-y-5" aria-label="Content" data-read-only={readOnly ? 'true' : 'false'}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold">Content</h2>
                    <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                        Approved pages, grouped by the month they are planned for.
                    </p>
                </div>
                <Link href={reviewHref} className="text-sm font-medium text-primary hover:underline">
                    Open client review
                </Link>
            </div>
            {error && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-500">{error}</p>
            )}
            {groups.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                    <h3 className="font-semibold">No pages are approved yet</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                        Approve a page on the topic map and choose a month. It will show up here.
                    </p>
                    <Link href={topicMapHref(clientId)} className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                        Open the topic map
                    </Link>
                </div>
            ) : groups.map(group => {
                const quota = group.workMonth ? contentQuota(group.records.length, contentPieces, group.workMonth) : null;
                return (
                    <section key={group.key} data-content-group={group.key} className="overflow-hidden rounded-2xl border border-border bg-card">
                        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-4 py-3">
                            <h3 className="text-sm font-semibold">{group.label}</h3>
                            {quota && <div className="w-full max-w-xs"><QuotaBar quota={quota} /></div>}
                        </header>
                        {group.key === 'unscheduled' && (
                            <p className="px-4 pt-3 text-xs text-muted-foreground">
                                Choose a month when you know when these pages will be written.
                            </p>
                        )}
                        <ul>
                            {group.records.map(record => (
                                <ContentRow
                                    key={record.id}
                                    record={record}
                                    today={today}
                                    readOnly={readOnly}
                                    saving={savingId === record.id}
                                    reviewHref={reviewHref}
                                    onStatus={onStatus}
                                    onMonth={onMonth}
                                />
                            ))}
                        </ul>
                    </section>
                );
            })}
        </section>
    );
}

function ContentRow({
    record,
    today,
    readOnly,
    saving,
    reviewHref,
    onStatus,
    onMonth,
}: {
    record: ContentBoardRecord;
    today: string;
    readOnly: boolean;
    saving: boolean;
    reviewHref: string;
    onStatus: (recordId: string, status: ProductionStatus) => void;
    onMonth: (recordId: string, workMonth: string | null) => void;
}) {
    const status = boardProductionStatus(record);
    const choices = PRODUCTION_STATUSES.filter(item => item !== 'already_live' || canMarkAlreadyLive(record));
    const shown = choices.includes(status) ? status : choices[0];
    const month = readWorkMonth(record.workMonth) ?? '';
    const months = contentMonthChoices(today, [record.workMonth]);
    const draftHref = readHttpUrl(record.draftUrl);
    const liveHref = readHttpUrl(record.liveUrl);
    const locked = readOnly || saving;
    return (
        <li data-content-page={record.id} className="grid gap-3 border-t border-border px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_12rem_8rem_12rem]">
            <div className="min-w-0">
                <p className="truncate text-sm font-medium">{record.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                        data-production-status={status}
                        title={status === 'published' ? PUBLISHED_NOTE : undefined}
                        className={cn('inline-flex', PILL_CLASS, PRODUCTION_STATUS_STYLES[status])}
                    >
                        {PRODUCTION_STATUS_LABEL[status]}
                    </span>
                    {status === 'client_review' && (
                        <Link
                            href={reviewHref}
                            className="text-xs font-medium text-primary hover:underline"
                            aria-label={`Open client review for ${record.title}`}
                        >
                            Open client review
                        </Link>
                    )}
                </div>
            </div>
            <div>
                <label htmlFor={`content-status-${record.id}`} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Status</label>
                <select
                    id={`content-status-${record.id}`}
                    className={cn(fieldClass, 'mt-1')}
                    value={shown}
                    disabled={locked}
                    onChange={event => onStatus(record.id, event.target.value as ProductionStatus)}
                >
                    {choices.map(choice => (
                        <option key={choice} value={choice}>{PRODUCTION_STATUS_LABEL[choice]}</option>
                    ))}
                </select>
            </div>
            <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Due</p>
                <p className="mt-1.5 text-sm">{displayDate(record.dueDate)}</p>
            </div>
            <div>
                <label htmlFor={`content-month-${record.id}`} className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Month</label>
                <select
                    id={`content-month-${record.id}`}
                    className={cn(fieldClass, 'mt-1')}
                    value={month}
                    disabled={locked}
                    onChange={event => onMonth(record.id, event.target.value || null)}
                >
                    <option value="">{UNSCHEDULED_LABEL}</option>
                    {months.map(value => (
                        <option key={value} value={value}>{workMonthLabel(value)}</option>
                    ))}
                </select>
                <p className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {draftHref && (
                        <a href={draftHref} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Draft</a>
                    )}
                    {liveHref && (
                        <a href={liveHref} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">Live page</a>
                    )}
                    {!draftHref && !liveHref && <span className="text-muted-foreground">{EMPTY_SPEC}</span>}
                </p>
            </div>
        </li>
    );
}

export function ContentBoard({
    clientId,
    clientName,
    contentPieces,
    readOnly,
    today,
}: {
    clientId: string;
    clientName: string;
    contentPieces: number | null;
    readOnly: boolean;
    today?: string;
}) {
    const month = readWorkMonth(today) ?? currentWorkMonth();
    const [records, setRecords] = useState<TopicalMapRecord[]>([]);
    const [hasMap, setHasMap] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const result = await getTopicalMapByClient(clientId);
            setRecords(result.records);
            setHasMap(Boolean(result.map));
            setError('');
        } catch {
            setError('Could not load content.');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    const apply = async (recordId: string, patch: Parameters<typeof updateContentRecord>[0]) => {
        if (readOnly) return;
        setSavingId(recordId);
        setError('');
        const result = await updateContentRecord(patch);
        setSavingId(null);
        const saved = result.record;
        if (!saved) {
            setError(result.error ?? 'Could not save this page.');
            return;
        }
        setRecords(current => current.map(record => record.id === saved.id ? saved : record));
    };

    if (loading) {
        return (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading content…
            </div>
        );
    }

    if (!hasMap) {
        return (
            <section className="space-y-4" aria-label="Content">
                <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                    <h3 className="font-semibold">No topic map yet</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                        Pages for {clientName} show up here after they are approved on the topic map.
                    </p>
                    <Link href={topicMapHref(clientId)} className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
                        Open the topic map
                    </Link>
                </div>
            </section>
        );
    }

    return (
        <ContentBoardView
            clientId={clientId}
            records={records.map(asContentBoardRecord)}
            contentPieces={contentPieces}
            readOnly={readOnly}
            today={month}
            savingId={savingId}
            error={error}
            onStatus={(recordId, productionStatus) => {
                void apply(recordId, { clientId, recordId, productionStatus });
            }}
            onMonth={(recordId, workMonth) => {
                void apply(recordId, { clientId, recordId, workMonth });
            }}
        />
    );
}
