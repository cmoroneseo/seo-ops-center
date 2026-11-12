'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ChevronsUpDown, Clock, Minus } from 'lucide-react';

import { samePageMarkers, type ChartMarker } from '@/lib/change-log/chart';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';
import { Button } from '@/components/ui/button';
import {
    Table,
    TableBody,
    TableCaption,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    CHANGE_COLUMNS,
    DEFAULT_CHANGE_SORT,
    RESULT_STRIP,
    filterChanges,
    nextCheckCopy,
    pagePath,
    resultDetail,
    sortChanges,
    summaryCounts,
    toggleResult,
    toggleSort,
    type ChangeSort,
    type ChangeSortKey,
    type ResultBucket,
} from '@/lib/change-log/list';
import {
    CHANGE_TYPES,
    CHANGE_TYPE_LABEL,
    KPI_LABEL,
    type ChangeType,
    type Confounder,
    type ImpactModel,
    type SeoChange,
    type TimelineItem,
} from '@/lib/change-log/types';
import { formatDayWithYear, isIsoDay } from '@/lib/change-log/time';
import { ptToday } from '@/lib/sync/months';
import type { ChangeInput } from '@/lib/change-log/validate';
import { cn } from '@/lib/utils';

import { ChangeDetail } from './ChangeDetail';
import { ChangeForm } from './ChangeForm';
import { ProgressMark } from './TestProgress';
import { VerdictPill } from './VerdictPill';
import { WentLiveFilter } from './WentLiveFilter';

export type ChangeLogMode = 'list' | 'form' | 'detail' | 'loading' | 'empty' | 'setup';

export function ChangeLogView({
    clientName,
    mode,
    example,
    exampleNote,
    items,
    detail,
    formInitial,
    formError,
    pending,
    revertOpen,
    today,
    canEdit = true,
    onLog,
    onOpen,
    onBack,
    onSubmit,
    onRemove,
    onExample,
}: {
    clientName: string;
    mode: ChangeLogMode;
    example: boolean;
    exampleNote?: string;
    items: TimelineItem[];
    detail?: {
        change: SeoChange;
        impact: ImpactModel;
        confounders: Confounder[];
        baselineNote: string | null;
        pageMarkers?: ChartMarker[];
    } | null;
    formInitial?: ChangeInput;
    formError?: string | null;
    pending?: boolean;
    revertOpen?: boolean;
    /** Pacific date used for the "data ~" hint. Defaults to today. */
    today?: string;
    /** Viewers can open the log. They cannot add or remove a change. */
    canEdit?: boolean;
    onLog: () => void;
    onOpen: (id: string) => void;
    onBack: () => void;
    onSubmit: (input: ChangeInput) => void;
    onRemove: () => void;
    onExample?: () => void;
}) {
    const [pageQuery, setPageQuery] = useState('');
    const [type, setType] = useState<ChangeType | ''>('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [result, setResult] = useState<ResultBucket | null>(null);
    const [sort, setSort] = useState<ChangeSort>(DEFAULT_CHANGE_SORT);
    const asOf = today && isIsoDay(today) ? today : ptToday(new Date());
    const narrowed = useMemo(
        () => filterChanges(items, { query: pageQuery, type, from, to }),
        [items, pageQuery, type, from, to],
    );
    const counts = useMemo(() => summaryCounts(narrowed), [narrowed]);
    const shown = useMemo(
        () => sortChanges(filterChanges(narrowed, { result }), sort.key, sort.direction),
        [narrowed, result, sort],
    );

    return (
        <div className="change-log-root mx-auto max-w-6xl space-y-4">
            <style>{`
                .change-log-root .field {
                    width: 100%;
                    border-radius: 0.375rem;
                    border: 1px solid var(--border);
                    background: var(--card);
                    padding: 0.4rem 0.6rem;
                    font-size: 0.875rem;
                }
                .change-log-root .field:focus-visible,
                .change-log-root .field:focus-within {
                    outline: none;
                    box-shadow: 0 0 0 2px var(--background), 0 0 0 4px var(--ring);
                }
                @media (min-width: 40rem) {
                    .change-log-root .field-auto { width: auto; }
                    .change-log-root .field-search { width: 16rem; }
                }
            `}</style>
            {example && exampleNote && (
                <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">{exampleNote}</p>
            )}
            {mode !== 'detail' && mode !== 'form' && (
                <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Changes</p>
                        <h1 className="text-2xl font-semibold tracking-tight">{clientName}</h1>
                        <p className="text-sm text-muted-foreground">Client: {clientName}</p>
                    </div>
                    {canEdit && mode !== 'setup' && mode !== 'loading' && (
                        <Button type="button" onClick={onLog}>Log a change</Button>
                    )}
                </header>
            )}
            {mode === 'loading' && <LoadingState />}
            {mode === 'setup' && (
                <div className="rounded-lg border border-border bg-card p-6 text-sm">
                    <p className="font-medium">Change log isn&apos;t in the database yet.</p>
                    <p className="mt-1 text-muted-foreground">Migration 125 has to be applied first. Nothing here is saved until then.</p>
                    {onExample && <Button type="button" className="mt-4" variant="outline" onClick={onExample}>View example</Button>}
                </div>
            )}
            {mode === 'empty' && (
                <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
                    <p className="font-medium">No changes logged yet.</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {canEdit
                            ? 'Log a main page heading, a search result title, or a new page, then track it here.'
                            : 'Changes show up here after a teammate logs one.'}
                    </p>
                    {canEdit && <Button type="button" className="mt-4" onClick={onLog}>Log a change</Button>}
                </div>
            )}
            {mode === 'list' && (
                <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        {RESULT_STRIP.map(bucket => {
                            const selected = result === bucket.id;
                            return (
                                <button
                                    key={bucket.id}
                                    type="button"
                                    data-bucket={bucket.id}
                                    data-count={counts[bucket.id]}
                                    aria-pressed={selected}
                                    onClick={() => setResult(current => toggleResult(current, bucket.id))}
                                    className={cn(
                                        'rounded-lg border bg-card px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                        selected ? cn('ring-2 ring-offset-2', bucketRing(bucket.id)) : 'border-border',
                                    )}
                                >
                                    <span className={cn('flex items-center gap-1.5 text-sm font-medium', bucketTone(bucket.id), selected && 'underline')}>
                                        <SummaryIcon bucket={bucket.id} />
                                        {bucket.label}
                                    </span>
                                    <span className={cn('mt-2 block text-2xl font-semibold tabular-nums leading-none', bucketTone(bucket.id))}>
                                        {counts[bucket.id]}
                                    </span>
                                    <span className="mt-1 block text-xs text-muted-foreground">
                                        of {narrowed.length} {narrowed.length === 1 ? 'change' : 'changes'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            <input className="field field-search" placeholder="Search changes or pages" aria-label="Search changes or pages" value={pageQuery} onChange={event => setPageQuery(event.target.value)} />
                            <label className="field field-auto inline-flex items-center gap-2">
                                <span className="text-muted-foreground">Type</span>
                                <select className="bg-transparent outline-none" aria-label="Change type" value={type} onChange={event => setType(event.target.value as ChangeType | '')}>
                                    <option value="">All</option>
                                    {CHANGE_TYPES.map(item => <option key={item} value={item}>{CHANGE_TYPE_LABEL[item]}</option>)}
                                </select>
                            </label>
                            <WentLiveFilter
                                from={from}
                                to={to}
                                today={asOf}
                                onChange={range => {
                                    setFrom(range.from);
                                    setTo(range.to);
                                }}
                            />
                        </div>
                        <p className="text-sm text-muted-foreground lg:shrink-0">
                            {shown.length === 1 ? '1 change' : `${shown.length} changes`}
                            {sort.key === 'live' && sort.direction === 'desc' ? ' · newest first' : ''}
                        </p>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border bg-card">
                        <Table className="caption-bottom">
                            <TableCaption>
                                Showing {shown.length} of {narrowed.length}. Went live is the date the change appeared on the website. Results compare each page with pages we didn&apos;t change.
                            </TableCaption>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                    {CHANGE_COLUMNS.map(column => (
                                        <SortHeader key={column.key} column={column} sort={sort} onSort={key => setSort(current => toggleSort(current, key))} />
                                    ))}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {shown.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={CHANGE_COLUMNS.length} className="text-sm text-muted-foreground">
                                            No changes match these filters.
                                        </TableCell>
                                    </TableRow>
                                ) : shown.map(item => {
                                    const upcoming = nextCheckCopy(item, asOf);
                                    return (
                                        <TableRow
                                            key={item.id}
                                            data-change-id={item.id}
                                            className="cursor-pointer"
                                            onClick={() => onOpen(item.id)}
                                        >
                                            <TableCell className="whitespace-normal">
                                                <button
                                                    type="button"
                                                    className="rounded-sm text-left text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                    onClick={event => {
                                                        event.stopPropagation();
                                                        onOpen(item.id);
                                                    }}
                                                >
                                                    {item.title}
                                                </button>
                                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                                    {(item.pageCount ?? 0) > 1 ? `${item.pageCount} pages` : pagePath(item.url, item.pageLabel)}
                                                </span>
                                                <ProgressMark percent={item.progressPercent} status={item.progressStatus} />
                                            </TableCell>
                                            <TableCell className="whitespace-normal text-sm">{CHANGE_TYPE_LABEL[item.changeType]}</TableCell>
                                            <TableCell className="whitespace-nowrap text-sm">{formatDayWithYear(item.liveOn)}</TableCell>
                                            <TableCell className="whitespace-normal text-sm">{KPI_LABEL[item.kpi]}</TableCell>
                                            <TableCell className="whitespace-normal">
                                                <VerdictPill verdict={item.verdict} estimate={item.estimate} pct={item.headlinePct} />
                                                <span className="mt-1 block text-xs text-muted-foreground">{resultDetail(item)}</span>
                                            </TableCell>
                                            <TableCell className="whitespace-normal">
                                                <p className="text-sm">{upcoming.date}</p>
                                                {upcoming.check ? <p className="text-xs text-muted-foreground">{upcoming.check}</p> : null}
                                                {upcoming.data ? <p className="text-xs text-muted-foreground">{upcoming.data}</p> : null}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                </>
            )}
            {mode === 'form' && canEdit && (
                <div className="rounded-lg border border-border bg-card p-4">
                    {formError && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{formError}</p>}
                    <ChangeForm initial={formInitial} example={example} pending={pending === true} onCancel={onBack} onSubmit={onSubmit} />
                </div>
            )}
            {mode === 'form' && !canEdit && (
                <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">You can view the change log. You can&apos;t add a change.</p>
            )}
            {mode === 'detail' && detail && (
                <ChangeDetail
                    change={detail.change}
                    impact={detail.impact}
                    confounders={detail.confounders}
                    baselineNote={detail.baselineNote}
                    example={example}
                    canEdit={canEdit}
                    markers={detail.pageMarkers ?? samePageMarkers(
                        { id: detail.change.id, pageKeys: detail.change.pages.map(page => page.urlKey) },
                        items.map(item => ({
                            id: item.id,
                            title: item.title,
                            liveOn: item.liveOn,
                            pageKeys: item.url ? [normalizeResultUrl(item.url) ?? ''] : [],
                        })),
                    )}
                    revertInitiallyOpen={revertOpen}
                    today={asOf}
                    onBack={onBack}
                    onOpen={onOpen}
                    onRemove={onRemove}
                />
            )}
        </div>
    );
}

function SortHeader({
    column,
    sort,
    onSort,
}: {
    column: { key: ChangeSortKey; label: string };
    sort: ChangeSort;
    onSort: (key: ChangeSortKey) => void;
}) {
    const active = sort.key === column.key;
    const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ChevronUp : ChevronDown;
    return (
        <TableHead aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
            <button
                type="button"
                data-sort={column.key}
                className="inline-flex items-center gap-1 rounded-sm text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                onClick={() => onSort(column.key)}
            >
                {column.label}
                <Icon aria-hidden="true" className="size-3.5" />
            </button>
        </TableHead>
    );
}

function SummaryIcon({ bucket }: { bucket: ResultBucket }) {
    if (bucket === 'early_estimate') {
        return (
            <span aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-full border border-dashed border-current text-[10px] leading-none">
                ~
            </span>
        );
    }
    const Icon = bucket === 'improved' ? ArrowUp : bucket === 'declined' ? ArrowDown : bucket === 'flat' ? Minus : Clock;
    return <Icon aria-hidden="true" className="size-3.5" />;
}

function bucketTone(bucket: ResultBucket): string {
    if (bucket === 'improved') return 'text-green-800';
    if (bucket === 'declined') return 'text-red-800';
    if (bucket === 'flat') return 'text-zinc-700';
    return 'text-amber-900';
}

function bucketRing(bucket: ResultBucket): string {
    if (bucket === 'improved') return 'ring-green-700';
    if (bucket === 'declined') return 'ring-red-700';
    if (bucket === 'flat') return 'ring-zinc-500';
    return 'ring-amber-700';
}

function LoadingState() {
    return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading changes">
            <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
            <div className="h-10 animate-pulse rounded-md bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
        </div>
    );
}
