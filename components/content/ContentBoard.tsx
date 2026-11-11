'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
    ArrowRight,
    Calendar,
    ChevronDown,
    CircleCheck,
    CircleDashed,
    CircleX,
    Clock,
    Ellipsis,
    ExternalLink,
    Eye,
    Flag,
    Globe,
    Loader2,
    Map as MapIcon,
    Pencil,
    Plus,
    Search,
    Settings,
    Tag,
    ThumbsUp,
    TriangleAlert,
    type LucideIcon,
} from 'lucide-react';

import { approveContentRecord, updateContentRecord } from '@/lib/content/client';
import {
    asContentBoardRecord,
    BOARD_FILTERS,
    BOARD_STATUS_LABEL,
    boardLink,
    boardProductionStatus,
    boardTopicGroups,
    contentMonthChoices,
    currentWorkMonth,
    DEFAULT_BOARD_VIEW,
    filterBoardRecords,
    groupBoardContent,
    groupCountLabel,
    monthName,
    monthPlan,
    overPlanDetail,
    overPlanHeadline,
    overPlanMoves,
    piecesLabel,
    planHeadline,
    shortDueDate,
    topicMapHref,
    type BoardView,
    type ContentBoardGroup,
    type ContentBoardRecord,
    type MonthPlan,
} from '@/lib/content/board';
import {
    canMarkAlreadyLive,
    PRODUCTION_STATUSES,
    PUBLISHED_NOTE,
    readWorkMonth,
    workMonthLabel,
} from '@/lib/topical-map/production';
import { cn } from '@/lib/utils';
import type { ProductionStatus, TopicalMapRecord } from '@/lib/types';
import { getTopicalMapByClient } from '@/lib/supabase/topical-map';

/** Link colour from the approved mockups: #be185d on white is 6.04:1. */
const LINK_CLASS = 'inline-flex items-center gap-1 whitespace-nowrap font-semibold text-[#be185d] underline decoration-1 underline-offset-[3px] hover:text-[#9d174d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2 rounded-sm dark:text-pink-300 dark:hover:text-pink-200';
const BUTTON_CLASS = 'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-3.5 text-[13.5px] font-semibold text-[#18181b] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted';
const SMALL_BUTTON_CLASS = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-[#d4d4d8] bg-white px-2.5 text-[12.5px] font-semibold text-[#18181b] hover:bg-[#fafafa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2 dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-muted';
const PRIMARY_BUTTON_CLASS = 'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-[#18181b] bg-[#18181b] px-[18px] text-sm font-semibold text-white hover:bg-[#27272a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] focus-visible:ring-offset-2';
const CARD_CLASS = 'rounded-xl border border-[#e4e4e7] bg-white text-[#18181b] dark:border-border dark:bg-card dark:text-card-foreground';
const MUTED_TEXT = 'text-[#52525b] dark:text-muted-foreground';
const FIELD_CLASS = 'w-full rounded-lg border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50';

const STATUS_ICON: Record<ProductionStatus, LucideIcon> = {
    not_written: CircleDashed,
    awaiting_approval: Clock,
    approved: ThumbsUp,
    writing: Pencil,
    client_review: Eye,
    ready: Flag,
    published: CircleCheck,
    already_live: Globe,
    declined: CircleX,
    failed: TriangleAlert,
};

/** Pill colours from the mockups (contrast.md). Every pair clears 4.5:1. */
const STATUS_PILL: Record<ProductionStatus, string> = {
    not_written: 'border-[#d4d4d8] bg-[#f4f4f5] text-[#3f3f46]',
    awaiting_approval: 'border-[#fcd34d] bg-[#fffbeb] text-[#92400e]',
    approved: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]',
    writing: 'border-[#ddd6fe] bg-[#f5f3ff] text-[#6d28d9]',
    client_review: 'border-[#fbcfe8] bg-[#fdf2f8] text-[#be185d]',
    ready: 'border-[#99f6e4] bg-[#f0fdfa] text-[#0f766e]',
    published: 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]',
    already_live: 'border-[#cbd5e1] bg-[#f1f5f9] text-[#334155]',
    declined: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]',
    failed: 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]',
};

export function StatusPill({ status }: { status: ProductionStatus }) {
    const Icon = STATUS_ICON[status];
    return (
        <span
            data-production-status={status}
            title={status === 'published' ? PUBLISHED_NOTE : undefined}
            className={cn(
                'inline-flex h-6 items-center gap-[5px] whitespace-nowrap rounded-full border pl-[7px] pr-[9px] text-xs font-semibold',
                STATUS_PILL[status],
            )}
        >
            <Icon className="h-[13px] w-[13px] shrink-0" strokeWidth={2.25} aria-hidden />
            {BOARD_STATUS_LABEL[status]}
        </span>
    );
}

export interface ContentBoardViewProps {
    clientId: string;
    clientName: string;
    records: ContentBoardRecord[];
    contentPieces: number | null;
    readOnly: boolean;
    /** This month, YYYY-MM, in Los Angeles time. */
    today: string;
    hasMap?: boolean;
    savingIds?: ReadonlyArray<string>;
    freshIds?: ReadonlyArray<string>;
    error?: string;
    initialView?: Partial<BoardView>;
    onStatus: (recordId: string, status: ProductionStatus) => void;
    onMonth: (recordId: string, workMonth: string | null) => void;
    onApprove?: (recordId: string, workMonth: string) => void;
    onMoveOverage?: (recordIds: string[], workMonth: string) => void;
    /** Opens the place where the client's monthly plan is edited. */
    onEditPlan?: () => void;
}

export function ContentBoardView({
    clientId,
    clientName,
    records,
    contentPieces,
    readOnly,
    today,
    hasMap = true,
    savingIds = [],
    freshIds = [],
    error,
    initialView,
    onStatus,
    onMonth,
    onApprove,
    onMoveOverage,
    onEditPlan,
}: ContentBoardViewProps) {
    const [view, setView] = useState<BoardView>({ ...DEFAULT_BOARD_VIEW, ...initialView });
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
    const [openMenu, setOpenMenu] = useState<string | null>(null);
    const plan = monthPlan(records, contentPieces, today);
    const canEditPlan = !readOnly && Boolean(onEditPlan);
    const empty = !hasMap || records.length === 0;

    return (
        <section className="space-y-4" aria-label="Content" data-read-only={readOnly ? 'true' : 'false'}>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Content</h2>
                    <p className={cn('mt-1 max-w-2xl text-[13.5px]', MUTED_TEXT)}>
                        Every page planned in {clientName}&apos;s topic map, by month. Approve a page to schedule it.
                    </p>
                </div>
                {!readOnly && (
                    <div className="flex flex-wrap gap-2">
                        {canEditPlan && (
                            <button type="button" className={BUTTON_CLASS} onClick={onEditPlan}>
                                <Settings className="h-[15px] w-[15px]" aria-hidden />
                                Monthly plan settings
                            </button>
                        )}
                        <Link href={topicMapHref(clientId)} className={BUTTON_CLASS}>
                            <Plus className="h-[15px] w-[15px]" aria-hidden />
                            Add a page
                        </Link>
                    </div>
                )}
            </div>

            {error && (
                <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/5 p-2 text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {!empty && plan.over > 0 && (
                <OverPlanBanner
                    plan={plan}
                    moves={overPlanMoves(records, plan)}
                    readOnly={readOnly}
                    onMove={onMoveOverage}
                    onEditPlan={canEditPlan ? onEditPlan : undefined}
                />
            )}

            {plan.limit == null
                ? <NoPlanCard onEditPlan={canEditPlan ? onEditPlan : undefined} />
                : <MonthlyPlanCard plan={plan} />}

            {empty ? (
                <NoPagesCard clientId={clientId} clientName={clientName} hasMap={hasMap} readOnly={readOnly} />
            ) : (
                <>
                    <BoardToolbar records={records} view={view} onView={setView} />
                    <BoardGroups
                        clientId={clientId}
                        records={records}
                        view={view}
                        plan={plan}
                        today={today}
                        readOnly={readOnly}
                        savingIds={savingIds}
                        freshIds={freshIds}
                        collapsed={collapsed}
                        openMenu={openMenu}
                        onOpenMenu={setOpenMenu}
                        onToggle={key => setCollapsed(current => {
                            const next = new Set(current);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                        })}
                        onReset={() => setView(DEFAULT_BOARD_VIEW)}
                        onStatus={onStatus}
                        onMonth={onMonth}
                        onApprove={onApprove}
                    />
                </>
            )}
        </section>
    );
}

function OverPlanBanner({
    plan,
    moves,
    readOnly,
    onMove,
    onEditPlan,
}: {
    plan: MonthPlan;
    moves: ContentBoardRecord[];
    readOnly: boolean;
    onMove?: (recordIds: string[], workMonth: string) => void;
    onEditPlan?: () => void;
}) {
    const canMove = !readOnly && Boolean(onMove) && moves.length > 0;
    return (
        <div
            role="status"
            data-over-plan={plan.over}
            className="flex flex-wrap items-start gap-3 rounded-[10px] border border-[#f59e0b] border-l-4 border-l-[#b45309] bg-[#fffbeb] px-4 py-3.5 text-[#78350f]"
        >
            <TriangleAlert className="mt-px h-5 w-5 shrink-0 text-[#b45309]" aria-hidden />
            <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-bold">{overPlanHeadline(plan)}</p>
                <p className="mt-0.5 text-[13px]">{overPlanDetail(plan)}</p>
            </div>
            {(canMove || onEditPlan) && (
                <div className="flex flex-wrap gap-2 self-center">
                    {canMove && (
                        <button
                            type="button"
                            className={BUTTON_CLASS}
                            data-move-overage={moves.map(record => record.id).join(' ')}
                            onClick={() => onMove?.(moves.map(record => record.id), plan.nextMonth)}
                        >
                            Move {moves.length} to {monthName(plan.nextMonth)}
                        </button>
                    )}
                    {onEditPlan && (
                        <button type="button" className={BUTTON_CLASS} onClick={onEditPlan}>
                            Change monthly plan
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function PlanSegments({ plan }: { plan: MonthPlan }) {
    const limit = plan.limit ?? 0;
    const filled = Math.min(plan.approved, limit);
    const blocks = limit + plan.over;
    return (
        <div data-quota-segments className={cn('flex items-center', blocks > 24 ? 'gap-px' : 'gap-1')} aria-hidden>
            {Array.from({ length: limit }, (_, index) => (
                <i
                    key={`plan-${index}`}
                    data-segment={index < filled ? 'filled' : 'empty'}
                    className={cn('block h-2.5 flex-1 rounded-[3px]', index < filled ? 'bg-[#db2777]' : 'bg-[#e4e4e7] dark:bg-muted')}
                />
            ))}
            {plan.over > 0 && (
                <>
                    <span className="block h-5 w-0.5 flex-none rounded-sm bg-[#18181b] dark:bg-foreground" title="Plan limit" />
                    {Array.from({ length: plan.over }, (_, index) => (
                        <i
                            key={`over-${index}`}
                            data-segment="over"
                            className="block h-2.5 flex-1 rounded-[3px] bg-[repeating-linear-gradient(135deg,#b45309_0_4px,#f59e0b_4px_8px)]"
                        />
                    ))}
                </>
            )}
        </div>
    );
}

function MonthlyPlanCard({ plan }: { plan: MonthPlan }) {
    const limit = plan.limit ?? 0;
    let summary: ReactNode;
    if (plan.over > 0) {
        summary = <><b className="text-[#92400e] dark:text-amber-300">{plan.over} over plan.</b> Approving is never blocked.</>;
    } else if (plan.approved === 0) {
        summary = <><b className="text-[#18181b] dark:text-foreground">{piecesLabel(limit)}</b> fit in this month&apos;s plan.</>;
    } else if (plan.left > 0) {
        summary = <><b className="text-[#18181b] dark:text-foreground">{plan.left} more</b> {plan.left === 1 ? 'fits' : 'fit'} in this month&apos;s plan.</>;
    } else {
        summary = <><b className="text-[#18181b] dark:text-foreground">Plan is full.</b> You can still approve more.</>;
    }
    return (
        <section aria-label="Monthly plan progress" data-quota-card className={cn(CARD_CLASS, 'flex flex-wrap items-center gap-7 px-5 py-[18px]')}>
            <div className="min-w-[16rem] flex-1">
                <p className={cn('text-[11.5px] font-bold uppercase tracking-[0.06em]', MUTED_TEXT)}>
                    {workMonthLabel(plan.month)} · monthly plan
                </p>
                <p className="mb-2.5 mt-1 text-lg font-bold">{planHeadline(plan)}</p>
                <PlanSegments plan={plan} />
                <p className={cn('mt-2 flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px]', MUTED_TEXT)}>
                    <span>
                        {monthName(plan.nextMonth)}: <b className="text-[#18181b] dark:text-foreground">{plan.nextApproved} of {limit}</b> approved
                    </span>
                    <span>
                        Monthly plan: <b className="text-[#18181b] dark:text-foreground">{piecesLabel(limit)}</b> (set in the client&apos;s agreement)
                    </span>
                </p>
            </div>
            <div className={cn('flex w-full flex-col gap-2.5 border-[#e4e4e7] text-[13px] sm:w-[250px] sm:border-l sm:pl-[22px] dark:border-border', MUTED_TEXT)}>
                <p>{summary}</p>
                <p>Approved counts every page that&apos;s approved, being written, in client review, ready or published.</p>
            </div>
        </section>
    );
}

function EmptyCard({
    icon: Icon,
    title,
    children,
    actions,
    dashed = false,
    compact = false,
}: {
    icon: LucideIcon;
    title: string;
    children: ReactNode;
    actions?: ReactNode;
    dashed?: boolean;
    compact?: boolean;
}) {
    return (
        <section
            className={cn(
                CARD_CLASS,
                'flex flex-col items-center px-6 text-center',
                compact ? 'py-8' : 'py-14',
                dashed && 'border-dashed border-[#d4d4d8]',
            )}
        >
            <div className="mb-3.5 grid h-12 w-12 place-items-center rounded-xl bg-[#fdf2f8] text-[#be185d]">
                <Icon className="h-[22px] w-[22px]" aria-hidden />
            </div>
            <h3 className="text-[17px] font-bold">{title}</h3>
            <p className={cn('mx-auto mb-[18px] mt-1.5 max-w-[520px] text-[13.5px] leading-normal', MUTED_TEXT)}>{children}</p>
            {actions && <div className="flex flex-wrap justify-center gap-2.5">{actions}</div>}
        </section>
    );
}

function NoPlanCard({ onEditPlan }: { onEditPlan?: () => void }) {
    return (
        <div data-empty="no-plan">
            <EmptyCard
                icon={Calendar}
                title="Set how many pieces are in this client's monthly plan"
                dashed
                compact
                actions={onEditPlan && (
                    <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={onEditPlan}>
                        <Settings className="h-4 w-4" aria-hidden />
                        Set monthly plan
                    </button>
                )}
            >
                Once it&apos;s set, this board shows how many pages are approved each month compared with what the client pays for. You can approve pages either way.
            </EmptyCard>
        </div>
    );
}

function NoPagesCard({
    clientId,
    clientName,
    hasMap,
    readOnly,
}: {
    clientId: string;
    clientName: string;
    hasMap: boolean;
    readOnly: boolean;
}) {
    const href = topicMapHref(clientId);
    return (
        <div data-empty={hasMap ? 'no-pages' : 'no-map'}>
            <EmptyCard
                icon={MapIcon}
                title={hasMap ? 'Add pages to the topic map to fill this board' : 'Build a topic map to fill this board'}
                actions={!readOnly && (
                    <>
                        <Link href={href} className={PRIMARY_BUTTON_CLASS}>
                            <MapIcon className="h-4 w-4" aria-hidden />
                            {hasMap ? 'Open topic map' : 'Build topic map'}
                        </Link>
                        <Link href={href} className={cn(BUTTON_CLASS, 'h-11 px-[18px] text-sm')}>
                            <Plus className="h-4 w-4" aria-hidden />
                            Add a page by hand
                        </Link>
                    </>
                )}
            >
                This board lists every page planned in {clientName}&apos;s topic map, grouped by month.{' '}
                {hasMap ? 'The topic map has no pages yet, so nothing is planned.' : 'There’s no topic map yet, so nothing is planned.'}
            </EmptyCard>
        </div>
    );
}

function BoardToolbar({
    records,
    view,
    onView,
}: {
    records: ContentBoardRecord[];
    view: BoardView;
    onView: (view: BoardView) => void;
}) {
    const groups = boardTopicGroups(records);
    return (
        <div className="flex flex-wrap items-center gap-2.5">
            <div role="group" aria-label="Show pages" className="flex gap-0.5 rounded-[9px] border border-[#e4e4e7] bg-white p-[3px] dark:border-border dark:bg-card">
                {BOARD_FILTERS.map(filter => {
                    const on = view.filter === filter.id;
                    return (
                        <button
                            key={filter.id}
                            type="button"
                            aria-pressed={on}
                            data-filter={filter.id}
                            onClick={() => onView({ ...view, filter: filter.id })}
                            className={cn(
                                'flex h-7 items-center rounded-md px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]',
                                on
                                    ? 'bg-[#fdf2f8] font-bold text-[#be185d]'
                                    : cn('font-medium hover:bg-[#f4f4f5] dark:hover:bg-muted', MUTED_TEXT),
                            )}
                        >
                            {filter.label}
                        </button>
                    );
                })}
            </div>
            <label className="relative flex h-9 items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white pl-2.5 pr-2 text-[13px] focus-within:ring-2 focus-within:ring-[#ec4899] dark:border-border dark:bg-card">
                <Tag className={cn('h-3.5 w-3.5', MUTED_TEXT)} aria-hidden />
                <span className="sr-only">Topic group</span>
                <select
                    value={view.topicGroup}
                    onChange={event => onView({ ...view, topicGroup: event.target.value })}
                    className="h-full appearance-none bg-transparent pr-5 focus:outline-none"
                >
                    <option value="">All topic groups</option>
                    {groups.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <ChevronDown className={cn('pointer-events-none absolute right-2 h-3.5 w-3.5', MUTED_TEXT)} aria-hidden />
            </label>
            <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-[#e4e4e7] bg-white px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-[#ec4899] sm:ml-auto sm:w-[220px] dark:border-border dark:bg-card">
                <Search className="h-3.5 w-3.5 text-[#71717a]" aria-hidden />
                <span className="sr-only">Search pages</span>
                <input
                    type="search"
                    value={view.query}
                    placeholder="Search pages"
                    onChange={event => onView({ ...view, query: event.target.value })}
                    className="h-full w-full bg-transparent placeholder:text-[#71717a] focus:outline-none"
                />
            </label>
        </div>
    );
}

interface GroupsProps {
    clientId: string;
    records: ContentBoardRecord[];
    view: BoardView;
    plan: MonthPlan;
    today: string;
    readOnly: boolean;
    savingIds: ReadonlyArray<string>;
    freshIds: ReadonlyArray<string>;
    collapsed: ReadonlySet<string>;
    openMenu: string | null;
    onOpenMenu: (key: string | null) => void;
    onToggle: (key: string) => void;
    onReset: () => void;
    onStatus: (recordId: string, status: ProductionStatus) => void;
    onMonth: (recordId: string, workMonth: string | null) => void;
    onApprove?: (recordId: string, workMonth: string) => void;
}

function groupNote(group: ContentBoardGroup, first: boolean, plan: MonthPlan): string {
    if (!group.workMonth) {
        return plan.over > 0
            ? 'Approving more adds to this month’s overage. Nothing is blocked.'
            : 'Approve a page to add it to a month.';
    }
    if (!first) return '';
    return plan.limit == null
        ? 'No monthly plan set, so there is no limit to compare with.'
        : 'Due date is when the page should be ready.';
}

function BoardGroups(props: GroupsProps) {
    const { records, view, plan, readOnly, collapsed, onToggle, onReset } = props;
    const visible = filterBoardRecords(records, view);
    if (visible.length === 0) {
        return (
            <div className={cn(CARD_CLASS, 'p-8 text-center text-sm')}>
                <p className="font-semibold">No pages match these filters.</p>
                <button type="button" onClick={onReset} className={cn(LINK_CLASS, 'mt-2 text-[13px]')}>Show all pages</button>
            </div>
        );
    }
    const allGroups = groupBoardContent(records);
    const firstMonth = allGroups.find(group => group.workMonth)?.key;
    return (
        <>
            {allGroups.map(group => {
                const rows = filterBoardRecords(group.records, view);
                if (rows.length === 0) return null;
                const open = !collapsed.has(group.key);
                const bodyId = `content-group-${group.key}`;
                const note = groupNote(group, group.key === firstMonth, plan);
                return (
                    <section key={group.key} data-content-group={group.key} className={cn(CARD_CLASS, 'overflow-hidden')}>
                        <header className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-3', open && 'border-b border-[#e4e4e7] dark:border-border')}>
                            <button
                                type="button"
                                aria-expanded={open}
                                aria-controls={bodyId}
                                onClick={() => onToggle(group.key)}
                                className="flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                            >
                                <ChevronDown className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')} aria-hidden />
                                <h3 className="text-[15px] font-bold">{group.label}</h3>
                            </button>
                            <span className={cn('text-[12.5px]', MUTED_TEXT)} data-group-count>{groupCountLabel(group)}</span>
                            {note && <span className={cn('ml-auto text-[12.5px]', MUTED_TEXT)}>{note}</span>}
                        </header>
                        {open && (
                            <div id={bodyId} className="overflow-x-auto">
                                <table className="w-full min-w-[880px] table-fixed border-collapse text-[13.5px]">
                                    <colgroup>
                                        <col style={{ width: readOnly ? '34%' : '28%' }} />
                                        <col style={{ width: readOnly ? '18%' : '14%' }} />
                                        <col style={{ width: readOnly ? '18%' : '15%' }} />
                                        <col style={{ width: readOnly ? '10%' : '8%' }} />
                                        <col style={{ width: readOnly ? '20%' : '15%' }} />
                                        {!readOnly && <col style={{ width: '20%' }} />}
                                    </colgroup>
                                    <thead>
                                        <tr className="bg-[#fafafa] dark:bg-muted/40">
                                            {['Page title', 'Topic group', 'Status', 'Due date', 'Link'].map(label => (
                                                <th key={label} scope="col" className={cn('h-[38px] whitespace-nowrap border-b border-[#e4e4e7] px-3.5 text-left text-[11.5px] font-bold uppercase tracking-[0.05em] dark:border-border', MUTED_TEXT)}>{label}</th>
                                            ))}
                                            {!readOnly && (
                                                <th scope="col" className={cn('h-[38px] whitespace-nowrap border-b border-[#e4e4e7] px-3.5 text-right text-[11.5px] font-bold uppercase tracking-[0.05em] dark:border-border', MUTED_TEXT)}>Action</th>
                                            )}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map(record => (
                                            <ContentRow key={record.id} record={record} {...props} />
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                );
            })}
        </>
    );
}

function ContentRow({
    record,
    clientId,
    plan,
    today,
    readOnly,
    savingIds,
    freshIds,
    openMenu,
    onOpenMenu,
    onStatus,
    onMonth,
    onApprove,
}: GroupsProps & { record: ContentBoardRecord }) {
    const status = boardProductionStatus(record);
    const link = boardLink(record, clientId);
    const due = shortDueDate(record.dueDate, today);
    const fresh = freshIds.includes(record.id);
    const saving = savingIds.includes(record.id);
    return (
        <tr data-content-page={record.id} className={cn('border-b border-[#f0f0f2] last:border-b-0 dark:border-border/60', fresh && 'bg-[#f8faff] dark:bg-sky-500/5')}>
            <td className="px-3.5 py-2 align-middle">
                <p className="font-semibold leading-snug">{record.title}</p>
                {fresh && <p className="mt-0.5 text-[11.5px] font-bold text-[#1d4ed8] dark:text-sky-300">Approved just now</p>}
            </td>
            <td className="px-3.5 py-2 align-middle leading-snug">{record.topicGroup || <span className={MUTED_TEXT}>—</span>}</td>
            <td className="px-3.5 py-2 align-middle"><StatusPill status={status} /></td>
            <td className="h-[52px] px-3.5 py-2 align-middle">
                {due ?? <span className={MUTED_TEXT} aria-label="No due date">—</span>}
            </td>
            <td className="px-3.5 py-2 align-middle">
                {link.kind === 'approvals' && (
                    <Link href={link.href} className={cn(LINK_CLASS, 'text-[13px]')} aria-label={`Review ${record.title} in Approvals`}>
                        {link.label}
                        <ArrowRight className="h-[13px] w-[13px]" aria-hidden />
                    </Link>
                )}
                {(link.kind === 'live' || link.kind === 'draft') && (
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className={cn(LINK_CLASS, 'text-[13px]')}>
                        {link.label}
                        <ExternalLink className="h-[13px] w-[13px]" aria-hidden />
                        <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                )}
                {(link.kind === 'none' || link.kind === 'waiting') && (
                    <span className={cn('whitespace-nowrap', MUTED_TEXT)}>
                        <span aria-hidden>— </span><span className="text-xs">{link.label}</span>
                    </span>
                )}
            </td>
            {!readOnly && (
                <td className="px-3.5 py-2 text-right align-middle">
                    <RowActions
                        record={record}
                        status={status}
                        plan={plan}
                        today={today}
                        saving={saving}
                        menuOpen={openMenu === record.id}
                        monthsOpen={openMenu === `months:${record.id}`}
                        onOpenMenu={onOpenMenu}
                        onStatus={onStatus}
                        onMonth={onMonth}
                        onApprove={onApprove}
                    />
                </td>
            )}
        </tr>
    );
}

function useDismiss(open: boolean, onClose: () => void) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onPointer = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) onClose();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open, onClose]);
    return ref;
}

function RowActions({
    record,
    status,
    plan,
    today,
    saving,
    menuOpen,
    monthsOpen,
    onOpenMenu,
    onStatus,
    onMonth,
    onApprove,
}: {
    record: ContentBoardRecord;
    status: ProductionStatus;
    plan: MonthPlan;
    today: string;
    saving: boolean;
    menuOpen: boolean;
    monthsOpen: boolean;
    onOpenMenu: (key: string | null) => void;
    onStatus: (recordId: string, status: ProductionStatus) => void;
    onMonth: (recordId: string, workMonth: string | null) => void;
    onApprove?: (recordId: string, workMonth: string) => void;
}) {
    const close = useCallback(() => onOpenMenu(null), [onOpenMenu]);
    const ref = useDismiss(menuOpen || monthsOpen, close);
    const spinner = saving ? <Loader2 className="h-4 w-4 animate-spin text-[#52525b]" aria-label="Saving" /> : null;

    if (status === 'declined') {
        return (
            <div className="flex items-center justify-end gap-2">
                {spinner}
                <button
                    type="button"
                    className={cn(SMALL_BUTTON_CLASS, 'border-transparent bg-transparent text-[#52525b] dark:bg-transparent dark:text-muted-foreground')}
                    aria-label={`Restore ${record.title}`}
                    onClick={() => { if (!saving) onStatus(record.id, 'not_written'); }}
                >
                    Restore
                </button>
            </div>
        );
    }

    if (status === 'not_written' && onApprove) {
        // A page already planned for this month or later is approved for that month.
        const saved = readWorkMonth(record.workMonth);
        const target = saved && saved >= today ? saved : plan.month;
        const months = contentMonthChoices(today, [record.workMonth]).filter(month => month >= today);
        const approve = (month: string) => {
            onOpenMenu(null);
            if (!saving) onApprove(record.id, month);
        };
        return (
            <div ref={ref} className="relative flex items-center justify-end gap-2">
                {spinner}
                {/* Approve is never disabled. Going over the plan only warns. */}
                <button
                    type="button"
                    className={SMALL_BUTTON_CLASS}
                    data-approve-for={target}
                    aria-busy={saving || undefined}
                    onClick={() => approve(target)}
                >
                    Approve for {monthName(target)}
                </button>
                <button
                    type="button"
                    className={cn(SMALL_BUTTON_CLASS, 'w-8 px-0')}
                    aria-label="Approve for a different month"
                    aria-haspopup="menu"
                    aria-expanded={monthsOpen}
                    onClick={() => onOpenMenu(monthsOpen ? null : `months:${record.id}`)}
                >
                    <Calendar className="h-3.5 w-3.5" aria-hidden />
                </button>
                {monthsOpen && (
                    <div role="menu" aria-label="Approve for a month" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-border bg-popover p-1 text-left text-sm text-popover-foreground shadow-lg">
                        {months.map(month => (
                            <button
                                key={month}
                                type="button"
                                role="menuitem"
                                onClick={() => approve(month)}
                                className="block w-full rounded-md px-2.5 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                            >
                                Approve for {workMonthLabel(month)}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const choices = PRODUCTION_STATUSES.filter(item => item !== 'already_live' || canMarkAlreadyLive(record));
    const months = contentMonthChoices(today, [record.workMonth]);
    return (
        <div ref={ref} className="relative flex items-center justify-end gap-2">
            {spinner}
            <button
                type="button"
                className={cn(SMALL_BUTTON_CLASS, 'w-8 border-transparent bg-transparent px-0 text-[#52525b] dark:bg-transparent dark:text-muted-foreground')}
                aria-label={`More actions for ${record.title}`}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                onClick={() => onOpenMenu(menuOpen ? null : record.id)}
            >
                <Ellipsis className="h-4 w-4" aria-hidden />
            </button>
            {menuOpen && (
                <div role="dialog" aria-label={`Change ${record.title}`} className="absolute right-0 top-full z-20 mt-1 w-60 space-y-3 rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg">
                    <div>
                        <label htmlFor={`content-status-${record.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</label>
                        <select
                            id={`content-status-${record.id}`}
                            className={cn(FIELD_CLASS, 'mt-1')}
                            value={choices.includes(status) ? status : choices[0]}
                            disabled={saving}
                            onChange={event => onStatus(record.id, event.target.value as ProductionStatus)}
                        >
                            {choices.map(choice => (
                                <option key={choice} value={choice}>{BOARD_STATUS_LABEL[choice]}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor={`content-month-${record.id}`} className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Month</label>
                        <select
                            id={`content-month-${record.id}`}
                            className={cn(FIELD_CLASS, 'mt-1')}
                            value={readWorkMonth(record.workMonth) ?? ''}
                            disabled={saving}
                            onChange={event => onMonth(record.id, event.target.value || null)}
                        >
                            <option value="">Unscheduled</option>
                            {months.map(month => (
                                <option key={month} value={month}>{workMonthLabel(month)}</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}
        </div>
    );
}

export function ContentBoard({
    clientId,
    clientName,
    contentPieces,
    readOnly,
    today,
    onEditPlan,
}: {
    clientId: string;
    clientName: string;
    contentPieces: number | null;
    readOnly: boolean;
    today?: string;
    onEditPlan?: () => void;
}) {
    const month = readWorkMonth(today) ?? currentWorkMonth();
    const [records, setRecords] = useState<TopicalMapRecord[]>([]);
    const [silos, setSilos] = useState<Record<string, string>>({});
    const [hasMap, setHasMap] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingIds, setSavingIds] = useState<string[]>([]);
    const [freshIds, setFreshIds] = useState<string[]>([]);

    const load = useCallback(async () => {
        try {
            const result = await getTopicalMapByClient(clientId);
            setRecords(result.records);
            setSilos(Object.fromEntries(result.silos.map(silo => [silo.id, silo.name])));
            setHasMap(Boolean(result.map));
            setError('');
        } catch {
            setError('Could not load content.');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    const replace = (saved: TopicalMapRecord) => {
        setRecords(current => current.map(record => record.id === saved.id ? saved : record));
    };
    const busy = (recordIds: string[], on: boolean) => {
        setSavingIds(current => on
            ? [...new Set([...current, ...recordIds])]
            : current.filter(id => !recordIds.includes(id)));
    };

    const apply = async (recordId: string, patch: Parameters<typeof updateContentRecord>[0]) => {
        if (readOnly) return;
        busy([recordId], true);
        setError('');
        const result = await updateContentRecord(patch);
        busy([recordId], false);
        if (!result.record) {
            setError(result.error ?? 'Could not save this page.');
            return;
        }
        replace(result.record);
    };

    const approve = async (recordId: string, workMonth: string) => {
        if (readOnly) return;
        busy([recordId], true);
        setError('');
        const result = await approveContentRecord({ clientId, recordId, workMonth });
        busy([recordId], false);
        if (!result.record) {
            setError(result.error ?? 'Could not approve this page.');
            return;
        }
        replace(result.record);
        setFreshIds(current => [...new Set([...current, recordId])]);
    };

    const moveOverage = async (recordIds: string[], workMonth: string) => {
        if (readOnly || recordIds.length === 0) return;
        busy(recordIds, true);
        setError('');
        let failed = 0;
        for (const recordId of recordIds) {
            const result = await updateContentRecord({ clientId, recordId, workMonth });
            if (result.record) replace(result.record);
            else failed += 1;
        }
        busy(recordIds, false);
        if (failed > 0) {
            setError(`Could not move ${failed === 1 ? '1 page' : `${failed} pages`} to ${monthName(workMonth)}. Try again.`);
        }
    };

    if (loading) {
        return (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading content…
            </div>
        );
    }

    return (
        <ContentBoardView
            clientId={clientId}
            clientName={clientName}
            records={records.map(record => asContentBoardRecord(record, silos[record.siloId]))}
            contentPieces={contentPieces}
            readOnly={readOnly}
            today={month}
            hasMap={hasMap}
            savingIds={savingIds}
            freshIds={freshIds}
            error={error}
            onEditPlan={onEditPlan}
            onStatus={(recordId, productionStatus) => {
                void apply(recordId, { clientId, recordId, productionStatus });
            }}
            onMonth={(recordId, workMonth) => {
                void apply(recordId, { clientId, recordId, workMonth });
            }}
            onApprove={(recordId, workMonth) => { void approve(recordId, workMonth); }}
            onMoveOverage={(recordIds, workMonth) => { void moveOverage(recordIds, workMonth); }}
        />
    );
}
