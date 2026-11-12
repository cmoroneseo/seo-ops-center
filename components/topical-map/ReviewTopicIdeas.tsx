'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
    Calendar,
    Check,
    ChevronDown,
    ChevronRight,
    CircleX,
    ExternalLink,
    Globe,
    Hourglass,
    Info,
    KanbanSquare,
    Loader2,
    Map as MapIcon,
    Minus,
    Pencil,
    Search,
    ThumbsUp,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react';

import { WizardStepper } from '@/components/topical-map/MapGenerationWizard';
import {
    approveContentRecord,
    bulkFailureMessage,
    declineContentRecord,
    renameContentRecord,
    reopenContentRecord,
    runBulk,
} from '@/lib/content/client';
import { contentMonthChoices, currentWorkMonth } from '@/lib/content/board';
import { readHttpUrl, workMonthLabel } from '@/lib/topical-map/production';
import {
    existingPagesLine,
    MAP_CHECK_TITLE,
    mapCheck,
    mapCheckSummary,
    missedEmpty,
    missedIntro,
    missedMore,
    missedTimes,
    missedWhere,
    mixLine,
    repeatsLine,
    seedOnlyLine,
    type CheckLine,
    type MapCheck,
} from '@/lib/topical-map/map-check';
import { readRefreshReasons } from '@/lib/topical-map/reconcile';
import {
    approvedMonthsSummary,
    contentBoardHref,
    EMPTY_EVIDENCE,
    formatCount,
    groupReviewRows,
    groupSummary,
    monthOptionNote,
    OVER_PLAN_DETAIL,
    overPlanWarning,
    phaseLabel,
    planCardNote,
    positionLabel,
    priorityBand,
    REVIEW_FILTERS,
    REVIEW_STATUS_LABEL,
    reviewCounts,
    reviewPlan,
    reviewRows,
    selectionPreview,
    type ReviewEvidence,
    type ReviewFilter,
    type ReviewPlan,
    type ReviewRow,
    type ReviewSort,
    type ReviewStatus,
} from '@/lib/topical-map/review';
import type { WizardStepperItem } from '@/lib/topical-map/wizard-steps';
import { cn } from '@/lib/utils';
import type { TopicalMapRecord, TopicalMapSilo } from '@/lib/types';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2';
/** Link colour from the approved mockups: #be185d on white is 6.04:1. */
const LINK_CLASS = cn('inline-flex items-center gap-1 whitespace-nowrap rounded-sm font-semibold text-[#be185d] underline decoration-1 underline-offset-[3px] hover:text-[#9d174d] dark:text-pink-300 dark:hover:text-pink-200', FOCUS);
const SMALL_BUTTON = cn('inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-2.5 text-[12.5px] font-semibold text-[#18181b] hover:bg-[#fafafa] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted', FOCUS);
const GHOST_BUTTON = cn('inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[12.5px] font-semibold text-[#3f3f46] hover:bg-[#f4f4f5] disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-muted', FOCUS);
const LARGE_BUTTON = cn('inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-[18px] text-sm font-semibold text-[#18181b] hover:bg-[#fafafa] disabled:opacity-50 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted', FOCUS);
const PRIMARY_LARGE = cn('inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#18181b] bg-[#18181b] px-[18px] text-sm font-semibold text-white hover:bg-[#27272a] disabled:opacity-50', FOCUS);
const PRIMARY_SMALL = cn('inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#18181b] bg-[#18181b] px-2.5 text-[12.5px] font-semibold text-white hover:bg-[#27272a] disabled:opacity-50', FOCUS);
const CARD = 'rounded-xl border border-[#e4e4e7] bg-white text-[#18181b] dark:border-border dark:bg-card dark:text-card-foreground';
const MUTED = 'text-[#52525b] dark:text-muted-foreground';
const STRONG = 'text-[#18181b] dark:text-foreground';

const STATUS_ICON: Record<ReviewStatus, LucideIcon> = {
    waiting: Hourglass,
    approved: ThumbsUp,
    declined: CircleX,
    live: Globe,
};

/** Pill colours from contrast.md. Every pair clears 4.5:1. */
const STATUS_PILL: Record<ReviewStatus, string> = {
    waiting: 'border-[#bae6fd] bg-[#f0f9ff] text-[#0369a1]',
    approved: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    declined: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]',
    live: 'border-[#cbd5e1] bg-[#f1f5f9] text-[#334155]',
};

export function ReviewStatusPill({ status }: { status: ReviewStatus }) {
    const Icon = STATUS_ICON[status];
    return (
        <span
            data-review-status={status}
            className={cn('inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-full border pl-[7px] pr-[9px] text-xs font-semibold', STATUS_PILL[status])}
        >
            <Icon className="h-[13px] w-[13px] shrink-0" strokeWidth={2.25} aria-hidden />
            {REVIEW_STATUS_LABEL[status]}
        </span>
    );
}

type CheckState = 'on' | 'off' | 'mixed';

function CheckMark({ state }: { state: CheckState }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'inline-grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] text-white',
                state === 'off' ? 'border-[#71717a] bg-white' : 'border-[#18181b] bg-[#18181b]',
            )}
        >
            {state === 'on' && <Check className="h-3 w-3" strokeWidth={3} />}
            {state === 'mixed' && <Minus className="h-3 w-3" strokeWidth={3} />}
        </span>
    );
}

function CheckButton({ state, label, onClick, disabled }: { state: CheckState; label: string; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className={cn('inline-grid h-8 w-8 place-items-center rounded disabled:opacity-50', FOCUS)}
        >
            <CheckMark state={state} />
        </button>
    );
}

function checkState(picked: number, total: number): CheckState {
    if (total === 0 || picked === 0) return 'off';
    return picked === total ? 'on' : 'mixed';
}

export interface ReviewTopicIdeasViewProps {
    clientId: string;
    clientName: string;
    silos: ReadonlyArray<TopicalMapSilo>;
    records: ReadonlyArray<TopicalMapRecord>;
    evidence: ReviewEvidence;
    evidenceLoading?: boolean;
    /** Record id → why the existing page needs an update. */
    refreshReasons?: Readonly<Record<string, string>>;
    /** The map's generation_metadata, for the map check's saved counts. */
    generationMetadata?: unknown;
    contentPieces: number | null;
    readOnly: boolean;
    /** This month, YYYY-MM, in Los Angeles time. */
    today: string;
    busyIds?: ReadonlyArray<string>;
    error?: string;
    initialSelected?: ReadonlyArray<string>;
    initialMonth?: string;
    initialFilter?: ReviewFilter;
    initialSort?: ReviewSort;
    initialEditingId?: string | null;
    initialConfirm?: string | null;
    initialMonthMenuOpen?: boolean;
    onApprove: (recordIds: string[], workMonth: string) => Promise<boolean> | boolean | void;
    onDecline: (recordIds: string[]) => Promise<boolean> | boolean | void;
    onReopen: (recordId: string) => void;
    onRename: (recordId: string, title: string) => Promise<boolean> | boolean;
    onBack: () => void;
}

export function ReviewTopicIdeasView({
    clientId,
    clientName,
    silos,
    records,
    evidence,
    evidenceLoading = false,
    refreshReasons,
    generationMetadata,
    contentPieces,
    readOnly,
    today,
    busyIds = [],
    error,
    initialSelected = [],
    initialMonth,
    initialFilter = 'all',
    initialSort = 'priority',
    initialEditingId = null,
    initialConfirm = null,
    initialMonthMenuOpen = false,
    onApprove,
    onDecline,
    onReopen,
    onRename,
    onBack,
}: ReviewTopicIdeasViewProps) {
    const name = clientName.trim() || 'this client';
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(readOnly ? [] : initialSelected));
    const [month, setMonth] = useState(initialMonth ?? today);
    const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
    const [sort, setSort] = useState<ReviewSort>(initialSort);
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    const [editingId, setEditingId] = useState<string | null>(readOnly ? null : initialEditingId);
    const [confirming, setConfirming] = useState<string | null>(readOnly ? null : initialConfirm);
    const [menuOpen, setMenuOpen] = useState(initialMonthMenuOpen);

    const rows = useMemo(() => reviewRows([...records], evidence, refreshReasons), [records, evidence, refreshReasons]);
    const counts = reviewCounts(rows);
    const check = useMemo(
        () => mapCheck({ ideas: records, evidence, generationMetadata, brandName: clientName, silos }),
        [records, evidence, generationMetadata, clientName, silos],
    );
    const waitingIds = useMemo(() => new Set(rows.filter(row => row.status === 'waiting').map(row => row.idea.id)), [rows]);
    const selectedIds = [...selected].filter(id => waitingIds.has(id));
    const visible = filter === 'all' ? rows : rows.filter(row => row.status === filter);
    const groups = groupReviewRows(visible, silos, sort);
    const months = contentMonthChoices(today, [month], 6);
    const plan = reviewPlan(records, selectedIds, contentPieces, month);
    const warning = overPlanWarning(plan);
    const done = counts.all > 0 && counts.waiting === 0;
    const busy = new Set(busyIds);
    const warnedSelected = rows.filter(row => selected.has(row.idea.id) && row.status === 'waiting' && row.warning);

    const toggle = (ids: string[], on: boolean) => setSelected(current => {
        const next = new Set(current);
        for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
        }
        return next;
    });
    const clearSelection = () => {
        setSelected(new Set());
        setConfirming(null);
    };

    const approve = async (ids: string[], confirmKey: string, warned: boolean) => {
        if (warned && confirming !== confirmKey) {
            setConfirming(confirmKey);
            return;
        }
        setConfirming(null);
        const ok = await onApprove(ids, month);
        if (ok !== false) toggle(ids, false);
    };
    const decline = async (ids: string[]) => {
        setConfirming(null);
        const ok = await onDecline(ids);
        if (ok !== false) toggle(ids, false);
    };

    const stepper: WizardStepperItem[] = [
        { id: 'profile', label: 'Brand', status: 'done', statusLabel: 'Done' },
        { id: 'seeds', label: 'Competitors', status: 'done', statusLabel: 'Done' },
        { id: 'keywords', label: 'Keywords', status: 'done', statusLabel: 'Done' },
        done
            ? { id: 'confirm', label: 'Review and build', status: 'done', statusLabel: 'Done' }
            : { id: 'confirm', label: 'Review and build', status: 'current', statusLabel: 'Current step' },
    ];

    const allState = checkState(selectedIds.length, waitingIds.size);

    return (
        <section aria-labelledby="review-ideas-title" className="text-[#18181b] dark:text-foreground" data-read-only={readOnly ? 'true' : 'false'}>
            <nav aria-label="Breadcrumb" className={cn('mb-1.5 text-[12.5px]', MUTED)}>
                <ol className="flex flex-wrap items-center gap-1">
                    <li><Link href="/workspace" className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>Clients</Link></li>
                    <li aria-hidden="true">/</li>
                    <li>
                        <Link href={`/workspace/${encodeURIComponent(clientId)}?tab=overview`} className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>
                            {name}
                        </Link>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li>
                        <button type="button" onClick={onBack} className={cn('rounded hover:text-[#be185d] hover:underline', FOCUS)}>Topical Map</button>
                    </li>
                    <li aria-hidden="true">/</li>
                    <li aria-current="page">Build topic map</li>
                </ol>
            </nav>
            <h1 className="mb-4 text-2xl font-bold tracking-[-.01em]">Build {name}&apos;s topic map</h1>

            <WizardStepper items={stepper} />

            <section className={cn(CARD, 'px-5 pt-5', done && filter === 'all' ? 'pb-5' : 'pb-0')} aria-label="Review topic ideas">
                <h2 id="review-ideas-title" className="text-lg font-bold">Review topic ideas</h2>
                {!(done && filter === 'all') && (
                    <>
                        <p className={cn('mt-1 text-[13.5px] leading-normal', MUTED)}>
                            We turned the brand, competitors and keywords into {counts.all} page {counts.all === 1 ? 'idea' : 'ideas'}, grouped by topic. Approve the ones worth writing and decline the rest. You can fix any title first.
                        </p>
                        <SourceNote evidence={evidence} loading={evidenceLoading} />
                    </>
                )}

                {error && (
                    <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-700 dark:text-red-400">{error}</p>
                )}
                {readOnly && (
                    <p className={cn('mt-3 flex items-center gap-1.5 text-[13px]', MUTED)} data-read-only-note>
                        <Info className="h-3.5 w-3.5 flex-none" aria-hidden />
                        You can view these ideas, not change them.
                    </p>
                )}

                {warning && !readOnly && (
                    <div role="status" data-over-plan={plan.over} className="mt-3 flex items-start gap-3 rounded-[10px] border border-[#f59e0b] border-l-4 border-l-[#b45309] bg-[#fffbeb] px-4 py-3.5 text-[#78350f]">
                        <TriangleAlert className="mt-px h-5 w-5 shrink-0 text-[#b45309]" aria-hidden />
                        <div>
                            <p className="text-[14.5px] font-bold">{warning}</p>
                            <p className="mt-0.5 text-[13px]">{OVER_PLAN_DETAIL}</p>
                        </div>
                    </div>
                )}

                <div className={done && filter === 'all' ? 'mt-3' : ''}>
                    <PlanCard plan={plan} showSelected={!done && !readOnly} />
                </div>

                {counts.all > 0 && <MapCheckPanel check={check} loading={evidenceLoading} />}

                <nav aria-label="Filter ideas" className="mt-1.5 flex flex-wrap items-center gap-1 border-b border-[#e4e4e7] dark:border-border">
                    {REVIEW_FILTERS.map(item => {
                        const on = item.id === filter;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setFilter(item.id)}
                                className={cn(
                                    '-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[13.5px]',
                                    on ? 'border-[#db2777] font-bold text-[#18181b] dark:text-foreground' : 'border-transparent font-medium text-[#52525b] dark:text-muted-foreground',
                                    FOCUS,
                                )}
                            >
                                {item.label}
                                <em className={cn('rounded-full px-[7px] py-px text-[11.5px] font-bold not-italic', on ? 'bg-[#fdf2f8] text-[#be185d]' : 'bg-[#f4f4f5] text-[#3f3f46]')}>
                                    {counts[item.id]}
                                </em>
                            </button>
                        );
                    })}
                    {!(done && filter === 'all') && (
                        <span className="ml-auto flex items-center gap-1 self-center">
                            <label className={cn('flex items-center gap-1.5 text-[12.5px]', MUTED)}>
                                Sort
                                <select
                                    value={sort}
                                    onChange={event => setSort(event.target.value as ReviewSort)}
                                    className="h-8 rounded-lg border border-[#d4d4d8] bg-white px-2 text-[12.5px] font-semibold text-[#18181b] dark:border-border dark:bg-card dark:text-foreground"
                                >
                                    <option value="priority">Priority, highest first</option>
                                    <option value="map">Topic map order</option>
                                </select>
                            </label>
                            <button
                                type="button"
                                className={GHOST_BUTTON}
                                onClick={() => setCollapsed(current => current.size > 0 ? new Set() : new Set(groups.map(group => group.id)))}
                            >
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                                {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
                            </button>
                        </span>
                    )}
                </nav>

                {done && filter === 'all' ? (
                    <DoneCard
                        clientId={clientId}
                        clientName={name}
                        records={records}
                        counts={counts}
                        onBack={onBack}
                    />
                ) : (
                    <>
                        <Legend />
                        {groups.length === 0 ? (
                            <p className={cn('mb-5 rounded-[10px] border border-dashed border-[#d4d4d8] p-8 text-center text-sm', MUTED)}>
                                No ideas here.
                            </p>
                        ) : (
                            <div className="mb-5 overflow-x-auto rounded-[10px] border border-[#e4e4e7] dark:border-border">
                                <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
                                    <colgroup>
                                        <col style={{ width: 44 }} />
                                        <col style={{ width: '36%' }} />
                                        <col style={{ width: '12%' }} />
                                        <col style={{ width: '22%' }} />
                                        <col style={{ width: '13%' }} />
                                        <col />
                                    </colgroup>
                                    <thead>
                                        <tr className="border-b border-[#e4e4e7] bg-[#fafafa] text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#52525b] dark:border-border dark:bg-muted dark:text-muted-foreground">
                                            <th className="px-2.5 py-2">
                                                {!readOnly && waitingIds.size > 0 && (
                                                    <CheckButton
                                                        state={allState}
                                                        label="Select all waiting ideas"
                                                        onClick={() => toggle([...waitingIds], allState !== 'on')}
                                                    />
                                                )}
                                            </th>
                                            <th className="px-2.5 py-2">Proposed page title</th>
                                            <th className="px-2.5 py-2 text-right">Google searches</th>
                                            <th className="px-2.5 py-2">Priority</th>
                                            <th className="px-2.5 py-2">Status</th>
                                            <th className="px-2.5 py-2 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {groups.map(group => {
                                            const waiting = group.rows.filter(row => row.status === 'waiting').map(row => row.idea.id);
                                            const picked = waiting.filter(id => selected.has(id)).length;
                                            const open = !collapsed.has(group.id);
                                            return (
                                                <Fragment key={group.id}>
                                                    <tr data-review-group={group.name} className="border-y border-[#e4e4e7] bg-[#fafafa] dark:border-border dark:bg-muted">
                                                        <td className="px-2.5 py-2">
                                                            {!readOnly && waiting.length > 0 && (
                                                                <CheckButton
                                                                    state={checkState(picked, waiting.length)}
                                                                    label={`Select all in ${group.name}`}
                                                                    onClick={() => toggle(waiting, picked !== waiting.length)}
                                                                />
                                                            )}
                                                        </td>
                                                        <td colSpan={5} className="px-2.5 py-2">
                                                            <button
                                                                type="button"
                                                                aria-expanded={open}
                                                                onClick={() => setCollapsed(current => {
                                                                    const next = new Set(current);
                                                                    if (next.has(group.id)) next.delete(group.id);
                                                                    else next.add(group.id);
                                                                    return next;
                                                                })}
                                                                className={cn('flex items-center gap-2.5 rounded text-left', FOCUS)}
                                                            >
                                                                {open ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                                                                <b className="text-sm">{group.name}</b>
                                                                <span className={cn('text-[12.5px]', MUTED)}>{groupSummary(group.rows, selected)}</span>
                                                            </button>
                                                        </td>
                                                    </tr>
                                                    {open && group.rows.map((row, index) => (
                                                        <IdeaRow
                                                            key={row.idea.id}
                                                            row={row}
                                                            tree={sort === 'map' && !row.main}
                                                            lastInTree={sort === 'map' && !row.main && (index === group.rows.length - 1 || group.rows[index + 1].main)}
                                                            readOnly={readOnly}
                                                            selected={selected.has(row.idea.id)}
                                                            editing={editingId === row.idea.id}
                                                            confirming={confirming === row.idea.id}
                                                            busy={busy.has(row.idea.id)}
                                                            month={month}
                                                            onSelect={on => toggle([row.idea.id], on)}
                                                            onEdit={() => setEditingId(row.idea.id)}
                                                            onCancelEdit={() => setEditingId(null)}
                                                            onRename={async title => {
                                                                const ok = await onRename(row.idea.id, title);
                                                                if (ok !== false) setEditingId(null);
                                                            }}
                                                            onApprove={() => void approve([row.idea.id], row.idea.id, Boolean(row.warning))}
                                                            onCancelConfirm={() => setConfirming(null)}
                                                            onDecline={() => void decline([row.idea.id])}
                                                            onReopen={() => onReopen(row.idea.id)}
                                                        />
                                                    ))}
                                                </Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {!readOnly && selectedIds.length > 0 && (
                            <div
                                role="region"
                                aria-label="Selected ideas"
                                className="sticky bottom-0 z-10 -mx-5 rounded-b-xl border-t border-[#e4e4e7] bg-white px-5 py-3 shadow-[0_-6px_18px_rgba(24,24,27,.08)] dark:border-border dark:bg-card"
                            >
                                {confirming === 'bulk' && warnedSelected.length > 0 && (
                                    <div role="alert" data-duplicate-confirm="bulk" className="mb-3 flex flex-wrap items-start gap-3 rounded-[10px] border border-[#f59e0b] bg-[#fffbeb] px-4 py-3 text-[#78350f]">
                                        <TriangleAlert className="mt-px h-5 w-5 shrink-0 text-[#b45309]" aria-hidden />
                                        <div className="min-w-0 flex-1 text-[13px]">
                                            <p className="font-bold">
                                                {warnedSelected.length === 1
                                                    ? '1 selected idea may compete with a page you already have.'
                                                    : `${warnedSelected.length} selected ideas may compete with pages you already have.`}
                                            </p>
                                            <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                                {warnedSelected.map(row => (
                                                    <li key={row.idea.id}><b>{row.idea.title}:</b> {row.warning}</li>
                                                ))}
                                            </ul>
                                        </div>
                                        <div className="flex gap-2 self-center">
                                            <button type="button" className={PRIMARY_SMALL} onClick={() => void approve(selectedIds, 'bulk', true)}>
                                                Approve anyway
                                            </button>
                                            <button type="button" className={SMALL_BUTTON} onClick={() => setConfirming(null)}>Cancel</button>
                                        </div>
                                    </div>
                                )}
                                <div className="flex flex-wrap items-center gap-3">
                                    <span className="inline-flex items-center gap-2 text-sm font-bold">
                                        <CheckButton state="mixed" label="Clear selection" onClick={clearSelection} />
                                        {selectedIds.length} selected
                                    </span>
                                    {plan.over > 0 ? (
                                        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#92400e] dark:text-amber-300">
                                            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                                            {selectionPreview(plan)}
                                        </span>
                                    ) : (
                                        <span className={cn('text-[12.5px]', MUTED)}>{selectionPreview(plan)}</span>
                                    )}
                                    <div className="relative ml-auto flex flex-wrap items-center gap-2">
                                        <MonthMenu
                                            month={month}
                                            months={months}
                                            open={menuOpen}
                                            onOpen={setMenuOpen}
                                            planFor={value => reviewPlan(records, selectedIds, contentPieces, value)}
                                            onMonth={value => {
                                                setMonth(value);
                                                setMenuOpen(false);
                                            }}
                                        />
                                        <button
                                            type="button"
                                            className={PRIMARY_LARGE}
                                            data-bulk-approve={selectedIds.length}
                                            disabled={selectedIds.some(id => busy.has(id))}
                                            onClick={() => void approve(selectedIds, 'bulk', warnedSelected.length > 0)}
                                        >
                                            <ThumbsUp className="h-4 w-4" aria-hidden />
                                            Approve for {workMonthLabel(month)?.split(' ')[0] ?? 'this month'}
                                        </button>
                                        <button
                                            type="button"
                                            className={LARGE_BUTTON}
                                            data-bulk-decline={selectedIds.length}
                                            disabled={selectedIds.some(id => busy.has(id))}
                                            onClick={() => void decline(selectedIds)}
                                        >
                                            <CircleX className="h-4 w-4" aria-hidden />
                                            Decline
                                        </button>
                                        <button type="button" className={cn(LINK_CLASS, 'h-11 px-1 text-[13px]')} onClick={clearSelection}>
                                            Clear selection
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>
        </section>
    );
}

function SourceNote({ evidence, loading }: { evidence: ReviewEvidence; loading: boolean }) {
    let text: ReactNode;
    if (loading) text = 'Checking Google Search Console…';
    else if (!evidence.connected) {
        text = 'Google Search Console is not connected, so every idea shows as a new topic with no Google data yet. Connect it to see which ideas already get searches.';
    } else if (evidence.days === 0) {
        text = 'Google Search Console is connected but has no stored days yet, so every idea shows as a new topic for now.';
    } else {
        text = <>Numbers come from your own Google Search Console, last {evidence.days} {evidence.days === 1 ? 'day' : 'days'}. Ideas with no match say so instead of showing a guess.</>;
    }
    return (
        <div className="mb-3 mt-3 flex flex-wrap gap-2">
            <p data-gsc-source={loading ? 'loading' : evidence.connected ? 'connected' : 'missing'} className={cn('inline-flex items-center gap-2 rounded-lg border border-[#e4e4e7] px-2.5 py-1.5 text-[12.5px] dark:border-border', MUTED)}>
                {loading ? <Loader2 className="h-[15px] w-[15px] animate-spin" aria-hidden /> : <Search className="h-[15px] w-[15px]" aria-hidden />}
                {text}
            </p>
        </div>
    );
}

/** Read-only quality check: searches no idea covers, plus how the ideas were checked. */
function MapCheckPanel({ check, loading }: { check: MapCheck; loading: boolean }) {
    const mix = mixLine(check);
    const lines = [repeatsLine(check), existingPagesLine(check), seedOnlyLine(check), mix].filter((line): line is CheckLine => line != null);
    const more = missedMore(check);
    return (
        <details data-map-check className="group mb-3 rounded-[10px] border border-[#e4e4e7] px-5 py-3 dark:border-border">
            <summary className={cn('flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded [&::-webkit-details-marker]:hidden', FOCUS)}>
                <ChevronRight className="h-4 w-4 flex-none transition-transform group-open:rotate-90" aria-hidden />
                <span className="text-[14.5px] font-bold">{MAP_CHECK_TITLE}</span>
                <span data-map-check-summary className={cn('text-[12.5px]', MUTED)}>
                    {loading ? 'Checking Google Search Console…' : mapCheckSummary(check)}
                </span>
            </summary>
            {!loading && (
                <div className="mt-3 grid gap-5 pb-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                    <div>
                        <h3 className="text-[13.5px] font-bold">Searches with no idea in this map</h3>
                        <p className={cn('mt-0.5 text-[12.5px] leading-normal', MUTED)}>{missedIntro(check)}</p>
                        {check.connected && check.days > 0 && (check.missed.length === 0
                            ? <p data-map-check-empty className={cn('mt-2 text-[13px]', STRONG)}>{missedEmpty(check)}</p>
                            : (
                                <ol data-map-check-missed className="mt-2 divide-y divide-[#f4f4f5] dark:divide-border">
                                    {check.missed.map(search => {
                                        const where = missedWhere(search);
                                        return (
                                            <li key={search.query} className="flex flex-wrap items-baseline justify-between gap-x-4 py-1.5 text-[13px]">
                                                <span className={cn('font-semibold', STRONG)}>{search.query}</span>
                                                <span className={cn('text-[12.5px]', MUTED)}>
                                                    {missedTimes(search)}{where ? ` · ${where}` : ''}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ol>
                            ))}
                        {more && <p className={cn('mt-1 text-xs', MUTED)}>{more}</p>}
                    </div>
                    <div>
                        <h3 className="text-[13.5px] font-bold">How the ideas were checked</h3>
                        <ul className="mt-1.5 space-y-2">
                            {lines.map(line => (
                                <li key={line.label} className="text-[13px]">
                                    <p className={cn('font-semibold', STRONG)}>{line.label}</p>
                                    <p className={cn('text-[12.5px] leading-normal', MUTED)}>{line.detail}</p>
                                    {line === mix && check.mix.length > 0 && (
                                        <p data-map-check-mix className={cn('text-[12.5px]', MUTED)}>
                                            {check.mix.map(item => `${item.label}: ${item.count}`).join(' · ')}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </details>
    );
}

function PlanSegments({ plan, showSelected }: { plan: ReviewPlan; showSelected: boolean }) {
    const limit = plan.limit ?? 0;
    const blocks = Math.max(limit, plan.after);
    const items: Array<'filled' | 'selected' | 'empty' | 'over-planned' | 'over-selected'> = [];
    for (let index = 0; index < blocks; index += 1) {
        const planned = index < plan.planned;
        const chosen = showSelected && !planned && index < plan.after;
        if (index < limit) items.push(planned ? 'filled' : chosen ? 'selected' : 'empty');
        else if (planned) items.push('over-planned');
        else if (chosen) items.push('over-selected');
    }
    const over = items.filter(item => item.startsWith('over'));
    return (
        <div data-quota-segments className={cn('flex items-center', blocks > 24 ? 'gap-px' : 'gap-1')} aria-hidden>
            {items.slice(0, limit).map((item, index) => (
                <i
                    key={`plan-${index}`}
                    data-segment={item}
                    className={cn(
                        'block h-2.5 flex-1 rounded-[3px]',
                        item === 'filled' && 'bg-[#db2777]',
                        item === 'selected' && 'bg-[repeating-linear-gradient(135deg,#db2777_0_3px,#fbcfe8_3px_7px)]',
                        item === 'empty' && 'bg-[#e4e4e7] dark:bg-muted',
                    )}
                />
            ))}
            {over.length > 0 && (
                <>
                    <span className="block h-5 w-0.5 flex-none rounded-sm bg-[#18181b] dark:bg-foreground" title="Plan limit" />
                    {over.map((item, index) => (
                        <i key={`over-${index}`} data-segment="over" className="block h-2.5 flex-1 rounded-[3px] bg-[repeating-linear-gradient(135deg,#b45309_0_4px,#f59e0b_4px_8px)]" />
                    ))}
                </>
            )}
        </div>
    );
}

function PlanCard({ plan, showSelected }: { plan: ReviewPlan; showSelected: boolean }) {
    const monthText = workMonthLabel(plan.month) ?? plan.month;
    const monthOnly = monthText.split(' ')[0];
    if (plan.limit == null) {
        return (
            <section aria-label="Monthly plan" data-quota-card="none" className={cn('mb-3 rounded-[10px] border border-dashed border-[#d4d4d8] px-5 py-3.5 text-[13px] dark:border-border', MUTED)}>
                No monthly content plan is saved for this client, so there is nothing to count against. You can approve ideas either way.
            </section>
        );
    }
    const shown = showSelected ? plan : { ...plan, selected: 0, after: plan.planned, over: Math.max(0, plan.planned - plan.limit) };
    return (
        <section aria-label="Monthly plan" data-quota-card className="mb-3 flex flex-wrap items-center gap-7 rounded-[10px] border border-[#e4e4e7] px-5 py-[18px] dark:border-border">
            <div className="min-w-[16rem] flex-1">
                <p className={cn('text-[11.5px] font-bold uppercase tracking-[0.06em]', MUTED)}>{monthText} · monthly plan</p>
                <p className="mb-2.5 mt-1 text-lg font-bold">{plan.planned} of {plan.limit} pieces planned for {monthOnly}</p>
                <PlanSegments plan={shown} showSelected={showSelected} />
                <p className={cn('mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', MUTED)}>
                    <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-sm bg-[#db2777]" aria-hidden />Already planned</span>
                    {showSelected && shown.selected > 0 && (
                        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,#db2777_0_3px,#fbcfe8_3px_7px)]" aria-hidden />Selected now</span>
                    )}
                    {shown.over > 0 && (
                        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2 w-4 rounded-sm bg-[repeating-linear-gradient(135deg,#b45309_0_4px,#f59e0b_4px_8px)]" aria-hidden />Over the plan</span>
                    )}
                    <span>Monthly plan: <b className={STRONG}>{plan.limit} {plan.limit === 1 ? 'piece' : 'pieces'}</b></span>
                </p>
            </div>
            <div className={cn('flex w-full flex-col gap-2.5 border-[#e4e4e7] text-[13px] sm:w-[220px] sm:border-l sm:pl-[22px] dark:border-border', MUTED)}>
                <p data-plan-note>
                    {shown.over > 0 && shown.selected > 0
                        ? <><b className="text-[#92400e] dark:text-amber-300">{shown.over} over plan</b>{planCardNote(shown).slice(`${shown.over} over plan`.length)}</>
                        : planCardNote(shown)}
                </p>
                <p>Planned counts pages already on the Content board for {monthOnly}.</p>
            </div>
        </section>
    );
}

function Legend() {
    return (
        <div className={cn('flex flex-wrap gap-5 py-3 text-[12.5px] leading-normal sm:flex-nowrap', MUTED)}>
            <p>
                <b className={STRONG}>Phase</b> (shown under each title) is when to write it. <b className={STRONG}>1 Foundation:</b> the core pages, written first. <b className={STRONG}>2 Growth:</b> builds on the foundation once it&apos;s live. <b className={STRONG}>3 Scale:</b> extra depth after the basics are working.
            </p>
            <p>
                <b className={STRONG}>Priority:</b> how much your Google data says a page could pay off, 0 to 100. It counts how often Google already shows your site for the search, where you sit now (spots 8 to 20 are quick wins), and whether you already have a page for it.
            </p>
        </div>
    );
}

function MonthMenu({
    month,
    months,
    open,
    onOpen,
    planFor,
    onMonth,
}: {
    month: string;
    months: string[];
    open: boolean;
    onOpen: (open: boolean) => void;
    planFor: (month: string) => ReviewPlan;
    onMonth: (month: string) => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onOpen(false);
        };
        const onPointer = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) onOpen(false);
        };
        window.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onPointer);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onPointer);
        };
    }, [open, onOpen]);
    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => onOpen(!open)}
                className={cn('inline-flex h-11 items-center gap-2 rounded-lg border border-[#d4d4d8] bg-white px-3 text-[13.5px] font-semibold dark:border-border dark:bg-card', FOCUS)}
            >
                <Calendar className="h-[15px] w-[15px]" aria-hidden />
                {workMonthLabel(month)?.split(' ')[0] ?? 'Month'}
                <ChevronDown className="h-[15px] w-[15px]" aria-hidden />
            </button>
            {open && (
                <ul
                    role="listbox"
                    aria-label="Choose month"
                    className="absolute bottom-[52px] left-0 z-20 w-[300px] rounded-[10px] border border-[#e4e4e7] bg-white p-1.5 shadow-[0_10px_30px_rgba(24,24,27,.16)] dark:border-border dark:bg-card"
                >
                    {months.map(value => {
                        const plan = planFor(value);
                        const on = value === month;
                        return (
                            <li key={value} role="option" aria-selected={on}>
                                <button
                                    type="button"
                                    onClick={() => onMonth(value)}
                                    className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13.5px]', on && 'bg-[#fdf2f8] dark:bg-muted', FOCUS)}
                                >
                                    <span>
                                        <b className="block font-semibold">{workMonthLabel(value)}</b>
                                        <small className={cn('text-xs', plan.over > 0 ? 'font-semibold text-[#92400e] dark:text-amber-300' : MUTED)}>
                                            {monthOptionNote(plan)}
                                        </small>
                                    </span>
                                    {on && <Check className="ml-auto h-4 w-4" aria-hidden />}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function IdeaRow({
    row,
    tree,
    lastInTree,
    readOnly,
    selected,
    editing,
    confirming,
    busy,
    month,
    onSelect,
    onEdit,
    onCancelEdit,
    onRename,
    onApprove,
    onCancelConfirm,
    onDecline,
    onReopen,
}: {
    row: ReviewRow<TopicalMapRecord>;
    tree: boolean;
    lastInTree: boolean;
    readOnly: boolean;
    selected: boolean;
    editing: boolean;
    confirming: boolean;
    busy: boolean;
    month: string;
    onSelect: (on: boolean) => void;
    onEdit: () => void;
    onCancelEdit: () => void;
    onRename: (title: string) => void;
    onApprove: () => void;
    onCancelConfirm: () => void;
    onDecline: () => void;
    onReopen: () => void;
}) {
    const { idea, status } = row;
    const [draft, setDraft] = useState(idea.title);
    useEffect(() => {
        if (editing) setDraft(idea.title);
    }, [editing, idea.title]);
    const live = status === 'live';
    const liveUrl = readHttpUrl(idea.liveUrl) ?? readHttpUrl(idea.matchedUrl);
    const band = priorityBand(row.score);
    const approvedMonth = workMonthLabel(idea.workMonth)?.split(' ')[0];
    const save = () => {
        const next = draft.trim();
        if (!next || next === idea.title) {
            onCancelEdit();
            return;
        }
        onRename(next);
    };

    return (
        <>
            <tr
                data-review-row={idea.id}
                data-score={row.score ?? ''}
                className={cn(
                    'border-b border-[#e4e4e7] align-middle dark:border-border',
                    live && 'bg-[#fcfcfd] dark:bg-transparent',
                    selected && 'bg-[#fdf2f8] dark:bg-pink-950/30',
                    editing && 'bg-[#fffdf5] dark:bg-amber-950/20',
                )}
            >
                <td className="px-2.5 py-[11px]">
                    {!readOnly && status === 'waiting' && (
                        <CheckButton state={selected ? 'on' : 'off'} label={`Select ${idea.title}`} onClick={() => onSelect(!selected)} disabled={busy} />
                    )}
                </td>
                <td className={cn('relative px-2.5 py-[11px]', tree && 'pl-[46px]')}>
                    {tree && (
                        <>
                            <span aria-hidden className={cn('absolute left-[22px] top-0 w-[1.5px] bg-[#a1a1aa]', lastInTree ? 'bottom-1/2' : 'bottom-0')} />
                            <span aria-hidden className="absolute left-[22px] top-1/2 h-[1.5px] w-4 bg-[#a1a1aa]" />
                        </>
                    )}
                    {editing ? (
                        <form
                            onSubmit={event => {
                                event.preventDefault();
                                save();
                            }}
                        >
                            <input
                                aria-label="Page title"
                                value={draft}
                                autoFocus
                                maxLength={300}
                                onChange={event => setDraft(event.target.value)}
                                onKeyDown={event => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        onCancelEdit();
                                    }
                                }}
                                className="h-9 w-full rounded-lg border border-[#18181b] bg-white px-2.5 text-[13.5px] outline outline-[3px] outline-offset-1 outline-[#ec4899] dark:bg-background"
                            />
                            <div className="mt-2 flex gap-2">
                                <button type="submit" className={PRIMARY_SMALL} disabled={busy}>Save</button>
                                <button type="button" className={SMALL_BUTTON} onClick={onCancelEdit}>Cancel</button>
                            </div>
                        </form>
                    ) : (
                        <div className="flex items-center gap-1">
                            <span className={cn(row.main ? 'text-[14.5px] font-bold' : 'text-sm')}>{idea.title}</span>
                            {!readOnly && !live && (
                                <button
                                    type="button"
                                    aria-label={`Edit title: ${idea.title}`}
                                    onClick={onEdit}
                                    className={cn('ml-1 inline-grid h-8 w-8 flex-none place-items-center rounded-[7px] border border-[#e4e4e7] bg-white text-[#52525b] dark:border-border dark:bg-card dark:text-muted-foreground', FOCUS)}
                                >
                                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                                </button>
                            )}
                        </div>
                    )}
                    <div className={cn('mt-1 flex flex-wrap items-center gap-1.5 text-xs', MUTED)}>
                        {row.main
                            ? <span className="whitespace-nowrap rounded-[5px] border border-[#18181b] bg-[#18181b] px-1.5 py-px text-[11px] font-bold text-white">Main topic page</span>
                            : <span className="whitespace-nowrap rounded-[5px] border border-[#d4d4d8] bg-white px-1.5 py-px text-[11px] font-bold text-[#3f3f46]">Supporting article</span>}
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#3f3f46] dark:text-muted-foreground" title="Foundation, Growth or Scale: when to write it">
                            <i className="grid h-[18px] w-[18px] place-items-center rounded-[5px] border border-[#d4d4d8] bg-[#f4f4f5] text-[10.5px] font-bold not-italic text-[#3f3f46]">{idea.buildPhase}</i>
                            {phaseLabel(idea.buildPhase)}
                        </span>
                        {idea.targetQuery && <span>Targets: “{idea.targetQuery}”</span>}
                    </div>
                    {live && <p className={cn('mt-1 text-xs leading-snug', MUTED)}>Already on your site, so it can&apos;t be added as new content.</p>}
                    {row.note && !live && <p className={cn('mt-1 text-xs leading-snug', MUTED)} data-existing-page>{row.note}</p>}
                    {row.refresh && !live && (
                        <p className={cn('mt-1 text-xs leading-snug', MUTED)} data-refresh-reason>
                            <span className="font-semibold text-[#3f3f46] dark:text-foreground">Why update it:</span> {row.refresh}
                        </p>
                    )}
                    {row.warning && status === 'waiting' && (
                        <p data-duplicate-warning className="mt-1 flex items-start gap-1 text-xs font-semibold leading-snug text-[#92400e] dark:text-amber-300">
                            <TriangleAlert className="mt-px h-3.5 w-3.5 flex-none" aria-hidden />
                            {row.warning}
                        </p>
                    )}
                </td>
                <td className="px-2.5 py-[11px] text-right tabular-nums">
                    {row.evidence ? (
                        <>
                            <span className="font-semibold">{formatCount(row.evidence.impressions)}</span>
                            {positionLabel(row.evidence.position) && <span className={cn('mt-0.5 block text-xs', MUTED)}>{positionLabel(row.evidence.position)}</span>}
                        </>
                    ) : (
                        <>
                            <span aria-hidden>—</span>
                            <span className={cn('mt-0.5 block text-xs', MUTED)}>No Google data yet</span>
                        </>
                    )}
                </td>
                <td className="px-2.5 py-[11px]">
                    {band ? (
                        <span className="text-[13px] font-semibold">
                            {band} <small className={cn('text-xs font-medium', MUTED)}>{row.score}/100</small>
                        </span>
                    ) : null}
                    <span data-priority-reason className={cn('block text-xs leading-snug', band ? `mt-0.5 ${MUTED}` : MUTED)}>{row.reason}</span>
                </td>
                <td className="px-2.5 py-[11px]"><ReviewStatusPill status={status} /></td>
                <td className="px-2.5 py-[11px]">
                    {status === 'waiting' && !readOnly && (
                        <div className="flex justify-end gap-2">
                            <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={onApprove} data-approve={idea.id}>
                                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}Approve
                            </button>
                            <button type="button" className={SMALL_BUTTON} disabled={busy} onClick={onDecline} data-decline={idea.id}>Decline</button>
                        </div>
                    )}
                    {status === 'approved' && (
                        <div>
                            <p className="text-xs font-semibold leading-snug text-[#1d4ed8] dark:text-blue-300">
                                {approvedMonth ? `Will be added to the Content board for ${approvedMonth}` : 'Will be added to the Content board'}
                            </p>
                            {!readOnly && (
                                <button type="button" className={cn(GHOST_BUTTON, 'mt-1 px-1.5')} disabled={busy} onClick={onReopen}>Undo</button>
                            )}
                        </div>
                    )}
                    {status === 'declined' && !readOnly && (
                        <div className="flex justify-end">
                            <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={onReopen}>Restore</button>
                        </div>
                    )}
                    {live && liveUrl && (
                        <div className="flex justify-end">
                            <a href={liveUrl} target="_blank" rel="noreferrer" className={cn(LINK_CLASS, 'text-[13px]')}>
                                View page<ExternalLink className="h-[13px] w-[13px]" aria-hidden />
                            </a>
                        </div>
                    )}
                </td>
            </tr>
            {confirming && row.warning && !readOnly && (
                <tr className="border-b border-[#e4e4e7] bg-[#fffbeb] dark:border-border">
                    <td />
                    <td colSpan={5} className="px-2.5 py-3">
                        <div role="alert" data-duplicate-confirm={idea.id} className="flex flex-wrap items-center gap-3 text-[13px] text-[#78350f]">
                            <TriangleAlert className="h-5 w-5 shrink-0 text-[#b45309]" aria-hidden />
                            <p className="min-w-0 flex-1"><b>Before you approve:</b> {row.warning}</p>
                            <button type="button" className={PRIMARY_SMALL} onClick={onApprove}>
                                Approve anyway for {workMonthLabel(month)?.split(' ')[0] ?? 'this month'}
                            </button>
                            <button type="button" className={SMALL_BUTTON} onClick={onCancelConfirm}>Cancel</button>
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

function DoneCard({
    clientId,
    clientName,
    records,
    counts,
    onBack,
}: {
    clientId: string;
    clientName: string;
    records: ReadonlyArray<TopicalMapRecord>;
    counts: Record<ReviewFilter, number>;
    onBack: () => void;
}) {
    const months = approvedMonthsSummary(records);
    return (
        <section data-review-done className="mt-4 rounded-[10px] border border-[#e4e4e7] px-6 pb-[34px] pt-10 text-center dark:border-border">
            <div className="mx-auto mb-3.5 grid h-14 w-14 place-items-center rounded-full bg-[#15803d] text-white">
                <Check className="h-7 w-7" strokeWidth={3} aria-hidden />
            </div>
            <h2 className="text-xl font-bold">All {counts.all} topic {counts.all === 1 ? 'idea' : 'ideas'} reviewed</h2>
            <p className={cn('mx-auto mb-5 mt-1.5 max-w-[560px] text-[13.5px] leading-normal', MUTED)}>
                {counts.approved > 0 && months
                    ? `Approved ideas were added to the Content board: ${months}. `
                    : counts.approved > 0 ? 'Approved ideas were added to the Content board. ' : 'No ideas were approved this time. '}
                {clientName}&apos;s topic map is built.
            </p>
            <div className="mb-[22px] flex flex-wrap justify-center gap-3">
                <DoneStat status="approved" count={counts.approved} text="Added to the Content board" />
                <DoneStat status="declined" count={counts.declined} text="Kept out of the plan. You can restore them later." />
                <DoneStat status="live" count={counts.live} text="Already on your site" />
            </div>
            <div className="flex flex-wrap justify-center gap-2.5">
                <Link href={contentBoardHref(clientId)} className={PRIMARY_LARGE}>
                    <KanbanSquare className="h-4 w-4" aria-hidden />Go to Content board
                </Link>
                <button type="button" className={LARGE_BUTTON} onClick={onBack}>
                    <MapIcon className="h-4 w-4" aria-hidden />Back to topic map
                </button>
            </div>
        </section>
    );
}

function DoneStat({ status, count, text }: { status: ReviewStatus; count: number; text: string }) {
    return (
        <div className="min-w-[170px] rounded-[10px] border border-[#e4e4e7] px-[18px] py-3 text-left dark:border-border">
            <ReviewStatusPill status={status} />
            <b className="mt-1.5 block text-[22px]">{count}</b>
            <span className={cn('text-[12.5px]', MUTED)}>{text}</span>
        </div>
    );
}

// ─── Container ──────────────────────────────────────────────────────────────

export async function fetchReviewEvidence(clientId: string): Promise<ReviewEvidence> {
    try {
        const response = await fetch(`/api/topical-map/review?clientId=${encodeURIComponent(clientId)}`);
        if (!response.ok) return EMPTY_EVIDENCE;
        const body = await response.json() as { evidence?: ReviewEvidence };
        const evidence = body.evidence;
        if (!evidence || !Array.isArray(evidence.queries)) return EMPTY_EVIDENCE;
        return evidence;
    } catch {
        return EMPTY_EVIDENCE;
    }
}

export function ReviewTopicIdeas({
    clientId,
    clientName,
    silos,
    records,
    generationMetadata,
    contentPieces,
    readOnly,
    onRecordsSaved,
    onBack,
}: {
    clientId: string;
    clientName: string;
    silos: TopicalMapSilo[];
    records: TopicalMapRecord[];
    /** The map's generation_metadata; refresh reasons are read from it. */
    generationMetadata?: unknown;
    contentPieces: number | null;
    readOnly: boolean;
    onRecordsSaved: (records: TopicalMapRecord[]) => void;
    onBack: () => void;
}) {
    const [evidence, setEvidence] = useState<ReviewEvidence>(EMPTY_EVIDENCE);
    const [loading, setLoading] = useState(true);
    const [busyIds, setBusyIds] = useState<string[]>([]);
    const [error, setError] = useState('');
    const today = useMemo(() => currentWorkMonth(), []);
    const refreshReasons = useMemo(() => readRefreshReasons(generationMetadata), [generationMetadata]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void fetchReviewEvidence(clientId).then(result => {
            if (cancelled) return;
            setEvidence(result);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [clientId]);

    const withBusy = useCallback(async <T,>(ids: string[], run: () => Promise<T>): Promise<T> => {
        setBusyIds(current => [...new Set([...current, ...ids])]);
        try {
            return await run();
        } finally {
            setBusyIds(current => current.filter(id => !ids.includes(id)));
        }
    }, []);

    const bulk = useCallback(async (ids: string[], verb: 'approve' | 'decline', workMonth?: string) => {
        setError('');
        const result = await withBusy(ids, () => runBulk(ids, id => verb === 'approve'
            ? approveContentRecord({ clientId, recordId: id, workMonth: workMonth ?? today })
            : declineContentRecord({ clientId, recordId: id })));
        if (result.saved.length > 0) onRecordsSaved(result.saved);
        const message = bulkFailureMessage(result, verb);
        if (message) setError(message);
        return result.failed.length === 0;
    }, [clientId, onRecordsSaved, today, withBusy]);

    return (
        <ReviewTopicIdeasView
            clientId={clientId}
            clientName={clientName}
            silos={silos}
            records={records}
            evidence={evidence}
            evidenceLoading={loading}
            refreshReasons={refreshReasons}
            generationMetadata={generationMetadata}
            contentPieces={contentPieces}
            readOnly={readOnly}
            today={today}
            busyIds={busyIds}
            error={error}
            onApprove={(ids, workMonth) => bulk(ids, 'approve', workMonth)}
            onDecline={ids => bulk(ids, 'decline')}
            onReopen={async id => {
                setError('');
                const result = await withBusy([id], () => reopenContentRecord({ clientId, recordId: id }));
                if (result.record) onRecordsSaved([result.record]);
                else setError(result.error ?? 'Could not save this page.');
            }}
            onRename={async (id, title) => {
                setError('');
                const result = await withBusy([id], () => renameContentRecord({ clientId, recordId: id, title }));
                if (result.record) {
                    onRecordsSaved([result.record]);
                    return true;
                }
                setError(result.error ?? 'Could not save this page.');
                return false;
            }}
            onBack={onBack}
        />
    );
}
