'use client';

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, ChevronRight, GripVertical, Play } from 'lucide-react';
import { isPendingStageTaskId } from '@/lib/seo-plan/stage-add';
import { hrefWithOverviewMonth, readOverviewMonth } from '@/lib/seo-plan/plan-month-url';
import { isChecklistTaskId } from '@/lib/seo-plan/plan-work';
import { effectOfPlanDrop } from '@/lib/seo-plan/plan-drag';
import {
    formatPlanDue,
    formatPlanHours,
    groupTasksByPlanMonth,
    isPlanDone,
    isPlanMonth,
    monthKeyFromDay,
    planHourRollup,
    planSearchMissCopy,
    shiftPlanMonth,
    type PlanGroup,
    type PlanSectionId,
    type PlanSectionModel,
} from '@/lib/seo-plan/plan-sections';
import type { DoneThisMonthLog } from '@/lib/seo-plan/done-this-month';
import { type PlanPanelField } from '@/lib/seo-plan/plan-panel';
import { stageListTitleParts, type StageListTask } from '@/lib/seo-plan/stage-list';
import { calendarDay, STAGE_LIST_TIME_ZONE } from '@/lib/seo-plan/this-month';
import type { StageReorderMove } from '@/lib/seo-plan/stage-reorder';
import type { TaskStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LiveUrlResultLine } from '@/components/search-reporting/LiveUrlResultLine';
import { LiveUrlControl } from '@/components/tasks/LiveUrlControl';
import { aggregateUrlResults, type UrlResultReadout } from '@/lib/search-reporting/url-results';
import { planRowTimeText, planRowTimerLabel, planTimerTask, type PlanRowTimerView } from '@/lib/seo-plan/row-timer';
import { DoneThisMonthFooter } from './DoneThisMonthFooter';
import { PlanAddLine, type PlanAddSubmission } from './PlanAddLine';
import { PlanSyncBanner, PlanSyncDot } from './PlanSyncFailure';
import type { PlanBasecampBanner, PlanBasecampSyncState } from '@/lib/seo-plan/basecamp-push';
import { PlanShortcutSheet } from './PlanShortcutSheet';
import { usePlanKeymap } from './use-plan-keymap';

export interface StageAddRequest {
    stage: TaskStage;
    titles: string[];
    parentTaskId?: string;
    /** Set by the plan add line. Null is Backlog or Onboarding. */
    dueDate?: string | null;
    /** Mixed parents. Depth 1 belongs to the nearest depth-0 line above it. */
    items?: PlanAddSubmission['items'];
}

export interface PlanAssignee {
    id: string;
    name: string;
    initials: string;
}

const ROW_GRID = 'grid grid-cols-[18px_22px_minmax(0,1fr)_104px_72px_86px] items-center gap-1.5 px-3';

function BlockedChip({ reason }: { reason: string | null | undefined }) {
    const text = reason?.trim();
    if (!text) return null;
    return (
        <span
            data-plan-blocked
            tabIndex={0}
            title={`Blocked: ${text}`}
            className="shrink-0 rounded border border-[#2a2a2e] px-1.5 py-0.5 text-[11px] text-[#8b8b93] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
        >
            Blocked
        </span>
    );
}

function TitleText({ title, query, done }: { title: string; query: string; done: boolean }) {
    const parts = stageListTitleParts(title, query);
    return (
        <span className={cn('truncate', done && 'text-[#8b8b93]')}>
            {parts.map((part, index) => part.match
                ? <mark key={index} className="rounded-sm bg-primary/20 px-0.5 text-inherit">{part.text}</mark>
                : <span key={index}>{part.text}</span>)}
        </span>
    );
}

function ProgressRing({ done, total }: { done: number; total: number }) {
    const ratio = total > 0 ? Math.min(1, done / total) : 0;
    const radius = 6.5;
    const circumference = 2 * Math.PI * radius;
    const full = ratio >= 1 && total > 0;
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-plan-ring={full ? 'full' : 'partial'}>
            <circle cx="8" cy="8" r={radius} fill="none" stroke="#2a2a2e" strokeWidth="1.5" />
            <circle
                cx="8"
                cy="8"
                r={radius}
                fill="none"
                stroke="#ec4899"
                strokeWidth="1.5"
                strokeDasharray={`${circumference * ratio} ${circumference}`}
                strokeLinecap="round"
                transform="rotate(-90 8 8)"
            />
            {full && <circle cx="8" cy="8" r="3" fill="#ec4899" />}
        </svg>
    );
}

function CheckBox({
    done,
    disabled,
    onToggle,
    label,
    action,
}: {
    done: boolean;
    disabled?: boolean;
    onToggle?: () => void;
    label?: string;
    action?: string;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={done}
            aria-label={label ?? (done ? 'Mark not done' : 'Mark done')}
            data-plan-check={done ? 'done' : 'open'}
            data-plan-check-action={action}
            disabled={disabled}
            onClick={event => {
                event.stopPropagation();
                onToggle?.();
            }}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
            }}
            className={cn(
                'flex h-4 w-4 items-center justify-center rounded-[4px] border p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-70',
                done ? 'border-[#ec4899] bg-[#ec4899] text-white' : 'border-[#3a3a40] bg-transparent',
            )}
        >
            {done && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>
    );
}

function AssigneeStack({ ids, people }: { ids: string[]; people: readonly PlanAssignee[] }) {
    if (ids.length === 0) {
        return (
            <span
                aria-hidden="true"
                title="Assign"
                className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-[#3a3a40] text-[10px] text-[#8b8b93]"
            >
                +
            </span>
        );
    }
    const shown = ids.slice(0, 2);
    const extra = ids.length - shown.length;
    return (
        <span className="inline-flex items-center" data-plan-assignees={ids.length}>
            {shown.map((id, index) => {
                const person = people.find(item => item.id === id);
                return (
                    <span
                        key={id}
                        title={person?.name ?? 'Teammate'}
                        className={cn(
                            'inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#2a2a2e] text-[10px] font-medium text-[#ececee]',
                            index > 0 && '-ml-1.5 ring-2 ring-[#141416]',
                        )}
                    >
                        {person?.initials ?? '·'}
                    </span>
                );
            })}
            {extra > 0 && <span className="ml-1 text-[11px] text-[#8b8b93]">+{extra}</span>}
        </span>
    );
}

function pointerFraction(event: DragEvent<HTMLElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return 0.5;
    return (event.clientY - rect.top) / rect.height;
}

interface DropHint {
    section: PlanSectionId;
    beforeTaskId: string | null;
    parentTaskId: string | null;
}

function hintKey(hint: DropHint | null): string {
    if (!hint) return '';
    return `${hint.section}:${hint.parentTaskId ?? ''}:${hint.beforeTaskId ?? ''}`;
}

/**
 * One plan list: Onboarding, This month, Backlog.
 * Rows stay in manual position order and can be dragged.
 * Dropping a row into another section changes the field that places it there.
 */
export function StagePlanListView({
    tasks,
    query,
    onQueryChange,
    onOpenTask,
    onAddTasks,
    onReorder,
    onSetLiveUrl,
    onToggleCheck,
    resultsByTaskId,
    today,
    initialMonth,
    people = [],
    loggedHours = {},
    monthLogs,
    monthLogsFor,
    onMonthChange,
    timeZone = STAGE_LIST_TIME_ZONE,
    clientId,
    onOpenResults,
    clientName,
    timerByTaskId,
    pendingTimerTaskId = null,
    onRowTimer,
    onCheckRunning,
    urlPromptTaskId,
    panel,
    panelTaskId = null,
    onClosePanel,
    basecamp = null,
    integrationsHref = '/settings',
    onRetrySync,
    doneHoldMs = 4000,
}: {
    tasks: readonly StageListTask[];
    query: string;
    onQueryChange: (query: string) => void;
    onOpenTask: (taskId: string, field?: PlanPanelField | null) => void;
    onAddTasks: (input: StageAddRequest) => Promise<void>;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    /** `x` and the row checkbox. Done flips back to to do. */
    onToggleCheck?: (taskId: string) => void | Promise<void>;
    /** Search Console readout keyed by task id. Absent rows stay quiet. */
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
    /** Calendar day YYYY-MM-DD in the org timezone. Defaults to today in Pacific time. */
    today?: string;
    /** Selected month YYYY-MM. Defaults to the month of `today`. */
    initialMonth?: string;
    people?: readonly PlanAssignee[];
    /** Logged hours by task id. All-time, finalized logs only. */
    loggedHours?: Readonly<Record<string, number>>;
    /** Open global-timer attempts keyed by task. Absent tasks are idle. */
    timerByTaskId?: Readonly<Record<string, PlanRowTimerView>>;
    /** Task whose play click is in flight. The control stays disabled until it settles. */
    pendingTimerTaskId?: string | null;
    /** Start, pause, or resume the global timer for this task. */
    onRowTimer?: (taskId: string) => void;
    /** Checking a row whose timer is running. Ordinary check-off stays with the caller. */
    onCheckRunning?: (taskId: string) => void;
    /** After a confirmed stop-and-complete, open the live URL field on this task. */
    urlPromptTaskId?: string | null;
    /**
     * Finalized time logs for the selected month. Null while that query is in flight.
     * Omit it when the caller has no logs to load; the footer then shows zeros.
     */
    monthLogs?: readonly DoneThisMonthLog[] | null;
    /** Month the `monthLogs` array was loaded for. A mismatch keeps hours pending. */
    monthLogsFor?: string | null;
    /** Tells the parent which month the footer hours should cover. */
    onMonthChange?: (month: string) => void;
    /** Org timezone for completion and log boundaries. Defaults to Pacific. */
    timeZone?: string;
    clientId?: string;
    /** Opens this client's Results view for the selected month. */
    onOpenResults?: (month: string) => void;
    /** Kept for callers. The plan header does not repeat the client name. */
    clientName?: string;
    /** Beside the list. No scrim, and the list stays clickable. */
    panel?: ReactNode;
    panelTaskId?: string | null;
    onClosePanel?: () => void;
    /** Client-wide Basecamp health. Unconnected clients pass null or connected: false. */
    basecamp?: PlanBasecampBanner | null;
    integrationsHref?: string;
    onRetrySync?: (taskId: string) => Promise<PlanBasecampSyncState | null>;
    /** How long a just-completed onboarding row stays visible, with Undo, before Show done hides it. */
    doneHoldMs?: number;
}) {
    const searchId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const day = today ?? calendarDay(new Date());
    const [month, setMonth] = useState(() => (initialMonth && isPlanMonth(initialMonth) ? initialMonth : monthKeyFromDay(day)));
    const urlMonth = useRef<string | null | undefined>(undefined);
    const sections = groupTasksByPlanMonth(tasks, { month, today: day, query });
    const searching = query.trim().length > 0;
    const nothingMatches = searching && sections.every(section => section.groups.length === 0);
    const current = month === monthKeyFromDay(day);
    const clientFailure = Boolean(basecamp?.connected && basecamp.failure);
    void clientName;

    useEffect(() => {
        if (panelTaskId) setFocusedId(panelTaskId);
    }, [panelTaskId]);

    const openTask = useCallback((taskId: string, field: PlanPanelField | null = null) => {
        if (isPendingStageTaskId(taskId)) return;
        setFocusedId(taskId);
        onOpenTask(taskId, field);
    }, [onOpenTask]);

    const shiftMonth = useCallback((delta: -1 | 1) => {
        setMonth(currentMonth => shiftPlanMonth(currentMonth, delta));
    }, []);
    const { helpOpen, closeHelp } = usePlanKeymap({
        rootRef: listRef,
        searchRef,
        query,
        onQueryChange,
        panelOpen: Boolean(panelTaskId),
        focusedId,
        setFocusedId,
        onOpenTask: openTask,
        onClosePanel,
        onToggleCheck,
        onRowTimer,
        onShiftMonth: shiftMonth,
    });

    useEffect(() => {
        const requested = readOverviewMonth(window.location.search);
        urlMonth.current = requested;
        if (requested) setMonth(requested);
    }, []);

    useEffect(() => {
        if (urlMonth.current === undefined) return;
        if (typeof urlMonth.current === 'string' && month !== urlMonth.current) return;
        urlMonth.current = null;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const next = hrefWithOverviewMonth(current, month);
        if (next !== current) window.history.replaceState(window.history.state, '', next);
    }, [month]);

    useEffect(() => {
        onMonthChange?.(month);
    }, [month, onMonthChange]);

    const list = (
        <div ref={listRef} data-seo-plan-stage-list data-plan-month={month} className="min-w-0 flex-1 space-y-3 text-[13px] text-[#ececee]">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2" data-plan-month-control>
                    <button
                        type="button"
                        aria-label="Previous month"
                        onClick={() => setMonth(currentMonth => shiftPlanMonth(currentMonth, -1))}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[#cfcfd4] hover:bg-[#1d1d22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    >
                        ‹
                    </button>
                    {current ? (
                        <span className="rounded-full bg-[#ec4899]/15 px-2 py-0.5 text-[11px] font-medium text-[#ec4899]">This month</span>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setMonth(monthKeyFromDay(day))}
                            className="rounded-full border border-[#3a3a40] px-2 py-0.5 text-[11px] text-[#cfcfd4] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            This month
                        </button>
                    )}
                    <span className="text-sm font-medium" data-plan-month-label>{monthLabel(month)}</span>
                    <button
                        type="button"
                        aria-label="Next month"
                        onClick={() => setMonth(currentMonth => shiftPlanMonth(currentMonth, 1))}
                        className="flex h-8 w-8 items-center justify-center rounded-md text-[#cfcfd4] hover:bg-[#1d1d22] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    >
                        ›
                    </button>
                </div>
                <div className="flex items-center gap-3">
                    <label htmlFor={searchId} className="sr-only">Search tasks</label>
                    <input
                        ref={searchRef}
                        id={searchId}
                        type="search"
                        value={query}
                        data-plan-search
                        onChange={event => onQueryChange(event.target.value)}
                        placeholder="Search tasks"
                        className="w-56 max-w-full rounded-lg border border-[#2a2a2e] bg-[#141416] px-3 py-1.5 text-[13px] text-[#ececee] outline-none placeholder:text-[#6d6d75] focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                    />
                </div>
            </div>

            <PlanAddLine
                month={month}
                onAdd={submission => onAddTasks({
                    stage: submission.stage,
                    titles: submission.items.map(item => item.title),
                    dueDate: submission.dueDate,
                    items: submission.items,
                })}
            />

            {clientFailure && <PlanSyncBanner href={integrationsHref} />}

            {nothingMatches && (
                <p className="text-[13px] text-[#8b8b93]">
                    {planSearchMissCopy(query)}{' '}
                    <button type="button" onClick={() => onQueryChange('')} className="text-[#ec4899] hover:underline">Clear search</button>
                </p>
            )}

            <PlanSections
                key={query}
                tasks={tasks}
                sections={sections}
                query={query}
                searching={searching}
                nothingMatches={nothingMatches}
                month={month}
                today={day}
                people={people}
                loggedHours={loggedHours}
                focusedId={focusedId}
                showSyncDots={!clientFailure}
                integrationsHref={integrationsHref}
                onRetrySync={onRetrySync}
                timerByTaskId={timerByTaskId}
                pendingTimerTaskId={pendingTimerTaskId}
                onRowTimer={onRowTimer}
                onCheckRunning={onCheckRunning}
                urlPromptTaskId={urlPromptTaskId}
                onOpenTask={openTask}
                onReorder={onReorder}
                onSetLiveUrl={onSetLiveUrl}
                onToggleCheck={onToggleCheck}
                resultsByTaskId={resultsByTaskId}
                doneHoldMs={doneHoldMs}
            />
            <DoneThisMonthFooter
                tasks={tasks}
                logs={monthLogs}
                hoursPending={monthLogs === null || (monthLogsFor != null && monthLogsFor !== month)}
                month={month}
                timeZone={timeZone}
                clientId={clientId}
                onOpenResults={onOpenResults}
            />
        </div>
    );
    const body = (
        <div data-plan-shell={panel ? 'open' : 'closed'} className="flex items-start">
            {list}
            {panel}
        </div>
    );
    return (
        <>
            {body}
            {helpOpen && <PlanShortcutSheet onClose={closeHelp} />}
        </>
    );
}

function monthLabel(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

function PlanSections({
    tasks,
    sections,
    query,
    searching,
    nothingMatches,
    month,
    today,
    people,
    loggedHours,
    focusedId,
    showSyncDots,
    integrationsHref,
    onRetrySync,
    timerByTaskId,
    pendingTimerTaskId,
    onRowTimer,
    onCheckRunning,
    urlPromptTaskId,
    onOpenTask,
    onReorder,
    onSetLiveUrl,
    onToggleCheck,
    resultsByTaskId,
    doneHoldMs,
}: {
    tasks: readonly StageListTask[];
    sections: PlanSectionModel[];
    query: string;
    searching: boolean;
    nothingMatches: boolean;
    month: string;
    today: string;
    people: readonly PlanAssignee[];
    loggedHours: Readonly<Record<string, number>>;
    focusedId: string | null;
    showSyncDots: boolean;
    integrationsHref: string;
    onRetrySync?: (taskId: string) => Promise<PlanBasecampSyncState | null>;
    timerByTaskId?: Readonly<Record<string, PlanRowTimerView>>;
    pendingTimerTaskId?: string | null;
    onRowTimer?: (taskId: string) => void;
    onCheckRunning?: (taskId: string) => void;
    urlPromptTaskId?: string | null;
    onOpenTask: (taskId: string, field: PlanPanelField | null) => void;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    onToggleCheck?: (taskId: string) => void | Promise<void>;
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
    doneHoldMs: number;
}) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [showDone, setShowDone] = useState(false);
    const [heldDone, setHeldDone] = useState<Record<string, true>>({});
    const heldTimers = useRef<Record<string, number>>({});
    const [dragId, setDragId] = useState<string | null>(null);
    const [hint, setHint] = useState<DropHint | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const dragIdRef = useRef<string | null>(null);
    const seenHint = useRef('');
    const baseId = useId();
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    const timerTargetById = new Map(tasks.map(task => {
        const parent = task.parentTaskId ? tasksById.get(task.parentTaskId) : undefined;
        return [task.id, planTimerTask(task, parent ?? null)] as const;
    }));

    const releaseDone = (taskId: string) => {
        const timer = heldTimers.current[taskId];
        if (timer) window.clearTimeout(timer);
        delete heldTimers.current[taskId];
        setHeldDone(current => {
            if (!current[taskId]) return current;
            const next = { ...current };
            delete next[taskId];
            return next;
        });
    };
    const holdDone = (taskId: string) => {
        const existing = heldTimers.current[taskId];
        if (existing) window.clearTimeout(existing);
        setHeldDone(current => ({ ...current, [taskId]: true }));
        heldTimers.current[taskId] = window.setTimeout(() => releaseDone(taskId), doneHoldMs);
    };
    useEffect(() => () => {
        for (const timer of Object.values(heldTimers.current)) window.clearTimeout(timer);
    }, []);
    const markTask = (task: StageListTask, foldDone: boolean) => {
        if (!onToggleCheck) return;
        if (!isPlanDone(task.status) && foldDone) holdDone(task.id);
        else releaseDone(task.id);
        void onToggleCheck(task.id);
    };
    const undoDone = (taskId: string) => {
        releaseDone(taskId);
        void onToggleCheck?.(taskId);
    };

    const rememberDrag = (id: string | null) => {
        dragIdRef.current = id;
        setDragId(id);
    };
    const showHint = (next: DropHint | null) => {
        const key = hintKey(next);
        if (key === seenHint.current) return;
        seenHint.current = key;
        setHint(next);
    };
    const clearDrag = () => {
        rememberDrag(null);
        showHint(null);
    };
    const isCollapsed = (section: PlanSectionModel) => (
        section.id in collapsed ? collapsed[section.id] : section.defaultCollapsed
    );

    const commit = (section: PlanSectionId, beforeTaskId: string | null, parentTaskId: string | null) => {
        const activeId = dragIdRef.current;
        if (!activeId || searching) {
            clearDrag();
            return;
        }
        const effect = effectOfPlanDrop({
            tasks,
            dragId: activeId,
            section,
            beforeTaskId,
            parentTaskId,
            month,
            today,
        });
        clearDrag();
        if (!effect) return;
        setMoveError(null);
        const requested: StageReorderMove = effect.dueDate === undefined
            ? effect.move
            : { ...effect.move, dueDate: effect.dueDate };
        void onReorder(requested).catch(() => setMoveError('Could not move that task.'));
    };

    const dropLine = (section: PlanSectionId, beforeTaskId: string | null, parentTaskId: string | null) => {
        if (!hint || hint.section !== section || hint.beforeTaskId !== beforeTaskId || hint.parentTaskId !== parentTaskId) return null;
        return <div data-stage-drop-line className="mx-3 h-0.5 bg-[#ec4899]" />;
    };

    return (
        <div className="space-y-3">
            {moveError && <p role="alert" className="text-sm text-red-400">{moveError}</p>}
            {sections.map(section => {
                const headingId = `${baseId}-${section.id}`;
                const closed = isCollapsed(section);
                const lookback = section.id === 'this_month' && month < monthKeyFromDay(today);
                const foldDone = section.id === 'onboarding' && !showDone && !searching && !section.collapsedComplete;
                return (
                    <section
                        key={section.id}
                        data-stage={section.id}
                        data-plan-section={section.id}
                        data-plan-collapsed={closed ? 'true' : 'false'}
                        data-stage-drop={searching ? undefined : section.id}
                        aria-labelledby={headingId}
                        className="overflow-hidden rounded-[10px] border border-[#2a2a2e] bg-[#141416]"
                        onDragOver={event => {
                            if (searching || !dragIdRef.current) return;
                            event.preventDefault();
                            showHint({ section: section.id, beforeTaskId: null, parentTaskId: null });
                        }}
                        onDrop={event => {
                            if (searching || !dragIdRef.current) return;
                            event.preventDefault();
                            commit(section.id, null, null);
                        }}
                    >
                        <h3 id={headingId} className="flex min-h-9 items-center gap-2 px-3 py-1.5">
                            <button
                                type="button"
                                aria-expanded={!closed}
                                onClick={() => setCollapsed(current => ({ ...current, [section.id]: !closed }))}
                                className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                            >
                                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[#8b8b93] transition-transform', !closed && 'rotate-90')} />
                                <span className={cn('text-[13px] font-semibold', section.collapsedComplete && 'text-[#8b8b93]')}>{section.title}</span>
                                <span className="text-[11px] font-normal text-[#8b8b93]" data-count={section.count}>
                                    <Meta meta={section.meta} late={section.late} />
                                </span>
                            </button>
                            {lookback && <span className="shrink-0 text-[11px] text-[#8b8b93]">look-back: open work stays in This month</span>}
                        </h3>
                        <div hidden={closed || undefined}>
                            {section.groups.length === 0 && !nothingMatches ? (
                                <p className="border-t border-[#2a2a2e] px-3 py-3 text-[13px] text-[#8b8b93]">{section.empty}</p>
                            ) : section.groups.map((group, index) => {
                                const nextTop = section.groups[index + 1]?.task.id ?? null;
                                const hideGroup = foldDone && isPlanDone(group.task.status) && !heldDone[group.task.id];
                                return (
                                    <div key={group.task.id} hidden={hideGroup || undefined}>
                                        {dropLine(section.id, group.task.id, null)}
                                        <PlanRow
                                            group={group}
                                            section={section.id}
                                            query={query}
                                            searching={searching}
                                            today={today}
                                            people={people}
                                            loggedHours={loggedHours}
                                            timerByTaskId={timerByTaskId}
                                            pendingTimerTaskId={pendingTimerTaskId}
                                            timerTargetById={timerTargetById}
                                            onRowTimer={onRowTimer}
                                            onCheckRunning={onCheckRunning}
                                            urlPromptTaskId={urlPromptTaskId}
                                            dragId={dragId}
                                            foldDone={foldDone}
                                            heldDone={heldDone}
                                            onUndoDone={onToggleCheck ? undoDone : undefined}
                                            baseId={baseId}
                                            focusedId={focusedId}
                                            showSyncDots={showSyncDots}
                                            integrationsHref={integrationsHref}
                                            onRetrySync={onRetrySync}
                                            onOpenTask={onOpenTask}
                                            onSetLiveUrl={onSetLiveUrl}
                                            onToggleCheck={onToggleCheck}
                                            onMark={onToggleCheck ? task => markTask(task, foldDone) : undefined}
                                            resultsByTaskId={resultsByTaskId}
                                            onDragStart={rememberDrag}
                                            onDragEnd={clearDrag}
                                            onHint={showHint}
                                            onDropRow={(beforeTaskId, parentTaskId) => commit(section.id, beforeTaskId, parentTaskId)}
                                            nextTopId={nextTop}
                                        />
                                    </div>
                                );
                            })}
                            {dropLine(section.id, null, null)}
                            {section.id === 'onboarding' && section.done > 0 && section.open > 0 && !searching && (
                                <button
                                    type="button"
                                    onClick={() => setShowDone(value => !value)}
                                    className="border-t border-[#2a2a2e] px-3 py-2 text-left text-[12px] text-[#8b8b93] hover:text-white"
                                >
                                    {showDone ? `Hide ${section.done} done` : `Show ${section.done} done`}
                                </button>
                            )}
                        </div>
                    </section>
                );
            })}
        </div>
    );
}

function Meta({ meta, late }: { meta: string; late: number }) {
    if (late <= 0) return <>{meta}</>;
    const needle = `${late} late`;
    const at = meta.indexOf(needle);
    if (at < 0) return <>{meta}</>;
    return (
        <>
            {meta.slice(0, at)}
            <span className="text-[#f87171]">{needle}</span>
            {meta.slice(at + needle.length)}
        </>
    );
}

function PlanRow({
    group,
    section,
    query,
    searching,
    today,
    people,
    loggedHours,
    timerByTaskId,
    pendingTimerTaskId,
    timerTargetById,
    onRowTimer,
    onCheckRunning,
    urlPromptTaskId,
    dragId,
    foldDone,
    heldDone,
    onUndoDone,
    onMark,
    baseId,
    focusedId,
    showSyncDots,
    integrationsHref,
    onRetrySync,
    onOpenTask,
    onSetLiveUrl,
    onToggleCheck,
    resultsByTaskId,
    onDragStart,
    onDragEnd,
    onHint,
    onDropRow,
    nextTopId,
}: {
    group: PlanGroup;
    section: PlanSectionId;
    query: string;
    searching: boolean;
    today: string;
    people: readonly PlanAssignee[];
    loggedHours: Readonly<Record<string, number>>;
    timerByTaskId?: Readonly<Record<string, PlanRowTimerView>>;
    pendingTimerTaskId?: string | null;
    timerTargetById: ReadonlyMap<string, { taskId: string; label: string | null; parentTitle: string | null }>;
    onRowTimer?: (taskId: string) => void;
    onCheckRunning?: (taskId: string) => void;
    urlPromptTaskId?: string | null;
    dragId: string | null;
    foldDone: boolean;
    heldDone?: Readonly<Record<string, true>>;
    onUndoDone?: (taskId: string) => void;
    onMark?: (task: StageListTask) => void;
    baseId: string;
    focusedId: string | null;
    showSyncDots: boolean;
    integrationsHref: string;
    onRetrySync?: (taskId: string) => Promise<PlanBasecampSyncState | null>;
    onOpenTask: (taskId: string, field: PlanPanelField | null) => void;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    onToggleCheck?: (taskId: string) => void | Promise<void>;
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
    onDragStart: (id: string | null) => void;
    onDragEnd: () => void;
    onHint: (hint: DropHint | null) => void;
    onDropRow: (beforeTaskId: string | null, parentTaskId: string | null) => void;
    nextTopId: string | null;
}) {
    const [openOverride, setOpenOverride] = useState<boolean | null>(null);
    const open = openOverride ?? (searching ? group.expandChildren : group.childCount > 0);
    const panelId = `${baseId}-children-${group.task.id}`;
    const pillar = group.childCount > 0;
    const visibleChildren = group.children.filter(child => !(foldDone && isPlanDone(child.status) && !heldDone?.[child.id]));
    const childIds = group.children.map(child => child.id);

    const renderTask = (task: StageListTask, options: {
        role: 'task' | 'subtask';
        parentId?: string;
        parentTitle?: string;
        nextId: string | null;
        leading?: ReactNode;
        pillar?: boolean;
        childIds?: string[];
        hiddenChildren?: number;
        urlCount?: number;
        childDone?: number;
        childCount?: number;
    }) => {
        const done = isPlanDone(task.status);
        const pending = isPendingStageTaskId(task.id);
        const checklist = isChecklistTaskId(task.id);
        const locked = pending || checklist;
        const due = formatPlanDue(task, today);
        const hours = options.pillar
            ? planHourRollup(task.id, group.rollupChildIds, loggedHours)
            : null;
        const logged = hours ? hours.total : (loggedHours[task.id] ?? 0);
        const tracked = timerTargetById.get(task.id) ?? { taskId: task.id, label: null as string | null, parentTitle: null as string | null };
        const timer = timerByTaskId?.[tracked.taskId] ?? { phase: 'idle' as const, seconds: 0 };
        const loggedLabel = options.pillar ? `Σ ${formatPlanHours(logged)}` : formatPlanHours(logged);
        const timeText = onRowTimer ? planRowTimeText(timer, loggedLabel) : loggedLabel;
        const timerPending = Boolean(onRowTimer) && pendingTimerTaskId === tracked.taskId;
        const stopOnCheck = timer.phase === 'running' && Boolean(onCheckRunning) && !locked && !timerPending;
        const childResults = options.pillar
            ? group.children.flatMap(child => {
                const result = resultsByTaskId?.[child.id];
                return result ? [result] : [];
            })
            : [];
        const result = childResults.length > 0
            ? aggregateUrlResults(childResults)
            : resultsByTaskId?.[task.id];
        const assigneeIds = options.pillar
            ? uniqueIds([...(task.assigneeIds ?? []), ...(options.childIds ?? []).flatMap(id => {
                const child = group.children.find(item => item.id === id);
                return child?.assigneeIds ?? [];
            })])
            : (task.assigneeIds ?? []);
        const draggable = !searching && !locked && options.role === 'task';
        return (
            <div
                key={task.id}
                data-stage-role={options.role}
                data-task-id={task.id}
                data-parent-id={options.parentId}
                data-pending={pending ? 'true' : undefined}
                data-stage-drag={draggable ? 'task' : undefined}
                data-plan-row={task.id}
                data-plan-focused={focusedId === task.id ? 'true' : undefined}
                data-late={due.late ? 'true' : undefined}
                data-plan-status={task.status}
                data-plan-timer={onRowTimer ? (timerPending ? 'pending' : timer.phase) : undefined}
                draggable={draggable || undefined}
                onDragStart={event => {
                    if (!draggable) return;
                    const target = event.target;
                    if (target instanceof Element && target.closest('button, input, textarea, select, a')) {
                        event.preventDefault();
                        return;
                    }
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', task.id);
                    onDragStart(task.id);
                }}
                onDragOver={event => {
                    if (searching || !dragId || locked) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const before = pointerFraction(event) < 0.5;
                    onHint({
                        section,
                        parentTaskId: options.role === 'subtask' ? (options.parentId ?? null) : null,
                        beforeTaskId: before ? task.id : options.nextId,
                    });
                }}
                onDrop={event => {
                    if (searching || locked) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const before = pointerFraction(event) < 0.5;
                    onDropRow(
                        before ? task.id : options.nextId,
                        options.role === 'subtask' ? (options.parentId ?? null) : null,
                    );
                }}
                onDragEnd={onDragEnd}
                className={cn(
                    ROW_GRID,
                    'group min-h-9 border-t border-[#2a2a2e] py-1',
                    options.role === 'subtask' && 'pl-9',
                    draggable && 'cursor-grab',
                    dragId === task.id && 'opacity-40',
                    focusedId === task.id && 'bg-[#1d1d22]',
                    (focusedId === task.id || (timer.phase === 'running' && onRowTimer)) && 'shadow-[inset_2px_0_0_0_#ec4899]',
                )}
            >
                <span className="flex justify-center">
                    {options.leading ?? <span className="w-3.5" />}
                </span>
                <span className="flex justify-center">
                    {stopOnCheck && options.pillar ? (
                        <button
                            type="button"
                            data-plan-check-action="stop-timer"
                            aria-label={`Log time and mark ${task.title} done`}
                            onClick={event => {
                                event.stopPropagation();
                                onCheckRunning?.(task.id);
                            }}
                            className="rounded-[4px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            <ProgressRing done={options.childDone ?? 0} total={options.childCount ?? 0} />
                        </button>
                    ) : stopOnCheck ? (
                        <CheckBox
                            done={done}
                            action="stop-timer"
                            label={`Log time and mark ${task.title} done`}
                            onToggle={() => onCheckRunning?.(task.id)}
                        />
                    ) : options.pillar
                        ? <ProgressRing done={options.childDone ?? 0} total={options.childCount ?? 0} />
                        : (
                            <CheckBox
                                done={done}
                                disabled={locked}
                                label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
                                onToggle={locked || (!onMark && !onToggleCheck) ? undefined : () => {
                                    if (onMark) onMark(task);
                                    else void onToggleCheck?.(task.id);
                                }}
                            />
                        )}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        data-plan-open="title"
                        disabled={locked}
                        onClick={() => { if (!locked) onOpenTask(task.id, null); }}
                        className={cn(
                            'flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-70',
                            options.pillar && 'font-semibold',
                        )}
                    >
                        {options.parentTitle && <span className="sr-only">Subtask of {options.parentTitle}. </span>}
                        <TitleText title={task.title} query={query} done={done} />
                    </button>
                    {checklist && (
                        <span data-plan-checklist className="shrink-0 rounded-full bg-[#1d1d22] px-1.5 py-0.5 text-[11px] text-[#8b8b93]">
                            Checklist
                        </span>
                    )}
                    {heldDone?.[task.id] && done && (
                        <span role="status" data-subtask-confirm={task.id} className="shrink-0 text-[11px] text-[#cfcfd4]">
                            Marked done
                            <span aria-hidden="true"> · </span>
                            <button
                                type="button"
                                data-subtask-undo={task.id}
                                onClick={event => {
                                    event.stopPropagation();
                                    onUndoDone?.(task.id);
                                }}
                                className="font-medium text-white underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                            >
                                Undo
                            </button>
                        </span>
                    )}
                    {showSyncDots && task.basecampSync?.state === 'failed' && !pending && (
                        <PlanSyncDot
                            taskId={task.id}
                            error={task.basecampSync.error}
                            attemptedAt={task.basecampSync.attemptedAt}
                            integrationsHref={integrationsHref}
                            onRetry={onRetrySync}
                        />
                    )}
                    <BlockedChip reason={task.blockedReason} />
                    {options.pillar && (
                        <span
                            data-subtask-progress={`${options.childDone ?? 0}/${options.childCount ?? 0}`}
                            className="shrink-0 rounded-full bg-[#1d1d22] px-1.5 py-0.5 text-[11px] text-[#cfcfd4]"
                        >
                            {options.childDone}/{options.childCount}
                        </span>
                    )}
                    {options.pillar && (options.urlCount ?? 0) > 0 && (
                        <button
                            type="button"
                            onClick={() => setOpenOverride(!open)}
                            className="shrink-0 rounded-full border border-[#2a2a2e] px-1.5 py-0.5 text-[11px] text-[#8b8b93] hover:text-white"
                        >
                            {options.urlCount} URLs
                        </button>
                    )}
                    {(options.hiddenChildren ?? 0) > 0 && (
                        <span className="shrink-0 text-[11px] text-[#8b8b93]" data-other-months={options.hiddenChildren}>
                            +{options.hiddenChildren} other months
                        </span>
                    )}
                    <LiveUrlControl
                        url={task.publishedUrl}
                        category={task.category}
                        openRequest={urlPromptTaskId === task.id ? 1 : 0}
                        onSave={!locked && onSetLiveUrl ? raw => onSetLiveUrl(task.id, raw) : undefined}
                    />
                    <LiveUrlResultLine result={result} />
                    {group.parentBreadcrumb && options.role === 'task' && task.id === group.task.id && (
                        <span className="shrink-0 text-[11px] text-[#8b8b93]">{group.parentBreadcrumb}</span>
                    )}
                </div>
                <button
                    type="button"
                    data-plan-open="due"
                    data-plan-due={due.text}
                    disabled={locked}
                    onClick={() => { if (!locked) onOpenTask(task.id, 'due'); }}
                    className={cn(
                        'min-w-0 truncate text-right text-[12px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]',
                        due.late ? 'text-[#f87171]' : due.undated ? 'text-[#6d6d75]' : 'text-[#cfcfd4]',
                    )}
                >
                    {due.text}
                </button>
                <button
                    type="button"
                    data-plan-open="assignee"
                    disabled={locked}
                    aria-label={assigneeIds.length === 0 ? 'Assign' : 'Assignee'}
                    title={assigneeIds.length === 0 ? 'Assign' : undefined}
                    onClick={() => { if (!locked) onOpenTask(task.id, 'assignee'); }}
                    className="flex justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                >
                    <AssigneeStack ids={assigneeIds} people={people} />
                </button>
                {onRowTimer ? (
                    <button
                        type="button"
                        disabled={locked || timerPending || timer.phase === 'reviewing'}
                        aria-busy={timerPending || undefined}
                        aria-label={timerPending
                            ? `Starting timer for ${tracked.parentTitle || task.title}`
                            : tracked.label
                                ? `${planRowTimerLabel(timer.phase, tracked.parentTitle || 'the parent task')}. ${tracked.label}`
                                : planRowTimerLabel(timer.phase, task.title)}
                        title={tracked.label ?? (timer.phase === 'idle' && hours ? hours.tooltip : undefined)}
                        data-plan-time={timerPending ? 'Starting…' : timeText}
                        data-plan-tracks={tracked.label ?? undefined}
                        onClick={event => {
                            event.stopPropagation();
                            if (!locked && !timerPending) onRowTimer(tracked.taskId);
                        }}
                        className={cn(
                            'inline-flex w-full items-center justify-end gap-1 text-right text-[12px] tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-70',
                            timer.phase === 'running' && !timerPending && 'rounded-full bg-[#ec4899]/15 px-1.5 py-0.5 font-mono text-[#ec4899]',
                            timer.phase === 'paused' && !timerPending && 'text-amber-400',
                            timer.phase === 'reviewing' && 'text-[#8b8b93]',
                            (timer.phase === 'idle' || timerPending) && (logged > 0 ? 'text-[#cfcfd4]' : 'text-[#6d6d75]'),
                        )}
                    >
                        {timerPending && <span>Starting…</span>}
                        {!timerPending && timer.phase === 'running' && (
                            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ec4899] animate-pulse" />
                        )}
                        {!timerPending && timer.phase === 'paused' && (
                            <span data-plan-resume className="font-medium">Resume</span>
                        )}
                        {!timerPending && timer.phase === 'idle' && (
                            <Play aria-hidden="true" className="h-3 w-3 shrink-0 fill-current opacity-80" />
                        )}
                        {!timerPending && <span>{timeText}</span>}
                    </button>
                ) : (
                    <span
                        className={cn('text-right text-[12px]', logged > 0 ? 'text-[#cfcfd4]' : 'text-[#6d6d75]')}
                        title={hours ? hours.tooltip : undefined}
                        data-plan-time={loggedLabel}
                    >
                        {loggedLabel}
                    </span>
                )}
            </div>
        );
    };

    return (
        <div>
            {renderTask(group.task, {
                role: 'task',
                nextId: nextTopId,
                pillar,
                childIds,
                hiddenChildren: group.hiddenChildren,
                urlCount: group.urlCount,
                childDone: group.childDone,
                childCount: group.childCount,
                leading: pillar ? (
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={`${open ? 'Hide' : 'Show'} ${group.childCount === 1 ? '1 subtask' : `${group.childCount} subtasks`} of ${group.task.title}`}
                        onClick={() => setOpenOverride(!open)}
                        className="text-[#8b8b93] hover:text-white"
                    >
                        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                    </button>
                ) : undefined,
            })}
            {open && visibleChildren.length > 0 && (
                <div
                    id={panelId}
                    data-stage-children={group.task.id}
                    onDragOver={event => {
                        if (searching || !dragId) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onHint({ section, beforeTaskId: null, parentTaskId: group.task.id });
                    }}
                    onDrop={event => {
                        if (searching) return;
                        event.preventDefault();
                        event.stopPropagation();
                        onDropRow(null, group.task.id);
                    }}
                >
                    {visibleChildren.map((child, index) => (
                        <div key={child.id}>
                            {renderTask(child, {
                                role: 'subtask',
                                parentId: group.task.id,
                                parentTitle: group.task.title,
                                nextId: visibleChildren[index + 1]?.id ?? null,
                                leading: searching || isPendingStageTaskId(child.id) ? undefined : (
                                    <span
                                        draggable
                                        data-stage-grip={child.id}
                                        title={`Drag ${child.title}`}
                                        aria-hidden="true"
                                        onDragStart={event => {
                                            event.stopPropagation();
                                            event.dataTransfer.effectAllowed = 'move';
                                            event.dataTransfer.setData('text/plain', child.id);
                                            onDragStart(child.id);
                                        }}
                                        onDragEnd={onDragEnd}
                                        className="inline-flex cursor-grab text-[#6d6d75]"
                                    >
                                        <GripVertical className="h-3.5 w-3.5" />
                                    </span>
                                ),
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function uniqueIds(ids: string[]): string[] {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const id of ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        list.push(id);
    }
    return list;
}
