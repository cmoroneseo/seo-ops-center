'use client';

import { useCallback, useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Check, ChevronRight, GripVertical } from 'lucide-react';
import { isPendingStageTaskId } from '@/lib/seo-plan/stage-add';
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
import {
    planPanelKeyAction,
    planShortcutBlocked,
    visiblePlanRowIds,
    type PlanPanelField,
} from '@/lib/seo-plan/plan-panel';
import { stageListTitleParts, type StageListTask } from '@/lib/seo-plan/stage-list';
import { calendarDay } from '@/lib/seo-plan/this-month';
import type { StageReorderMove } from '@/lib/seo-plan/stage-reorder';
import type { TaskStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LiveUrlResultLine } from '@/components/search-reporting/LiveUrlResultLine';
import { LiveUrlControl } from '@/components/tasks/LiveUrlControl';
import { aggregateUrlResults, type UrlResultReadout } from '@/lib/search-reporting/url-results';
import { PlanAddLine, type PlanAddSubmission } from './PlanAddLine';

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

function CheckBox({ done }: { done: boolean }) {
    return (
        <span
            data-plan-check={done ? 'done' : 'open'}
            className={cn(
                'flex h-4 w-4 items-center justify-center rounded-[4px] border',
                done ? 'border-[#ec4899] bg-[#ec4899] text-white' : 'border-[#3a3a40] bg-transparent',
            )}
            aria-hidden="true"
        >
            {done && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
    );
}

function AssigneeStack({ ids, people }: { ids: string[]; people: readonly PlanAssignee[] }) {
    if (ids.length === 0) {
        return (
            <span
                aria-label="Unassigned"
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
    resultsByTaskId,
    today,
    initialMonth,
    people = [],
    loggedHours = {},
    onOpenResults,
    clientName,
    panel,
    panelTaskId = null,
    onClosePanel,
}: {
    tasks: readonly StageListTask[];
    query: string;
    onQueryChange: (query: string) => void;
    onOpenTask: (taskId: string, field?: PlanPanelField | null) => void;
    onAddTasks: (input: StageAddRequest) => Promise<void>;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    /** Search Console readout keyed by task id. Absent rows stay quiet. */
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
    /** Calendar day YYYY-MM-DD in the org timezone. Defaults to today in Pacific time. */
    today?: string;
    /** Selected month YYYY-MM. Defaults to the month of `today`. */
    initialMonth?: string;
    people?: readonly PlanAssignee[];
    /** Logged hours by task id. All-time, finalized logs only. */
    loggedHours?: Readonly<Record<string, number>>;
    onOpenResults?: () => void;
    /** Kept for callers. The plan header does not repeat the client name. */
    clientName?: string;
    /** Beside the list. No scrim, and the list stays clickable. */
    panel?: ReactNode;
    panelTaskId?: string | null;
    onClosePanel?: () => void;
}) {
    const searchId = useId();
    const searchRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const day = today ?? calendarDay(new Date());
    const [month, setMonth] = useState(() => (initialMonth && isPlanMonth(initialMonth) ? initialMonth : monthKeyFromDay(day)));
    const sections = groupTasksByPlanMonth(tasks, { month, today: day, query });
    const searching = query.trim().length > 0;
    const nothingMatches = searching && sections.every(section => section.groups.length === 0);
    const current = month === monthKeyFromDay(day);
    void clientName;

    useEffect(() => {
        if (panelTaskId) setFocusedId(panelTaskId);
    }, [panelTaskId]);

    const openTask = useCallback((taskId: string, field: PlanPanelField | null = null) => {
        if (isPendingStageTaskId(taskId)) return;
        setFocusedId(taskId);
        onOpenTask(taskId, field);
    }, [onOpenTask]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const blocked = planShortcutBlocked(event.target, event.key);
            if (event.key === '/' && !blocked) {
                event.preventDefault();
                searchRef.current?.focus();
                return;
            }
            if ((event.key === '[' || event.key === ']') && !blocked) {
                event.preventDefault();
                setMonth(currentMonth => shiftPlanMonth(currentMonth, event.key === '[' ? -1 : 1));
                return;
            }
            const visibleIds = visiblePlanRowIds(listRef.current ?? document)
                .filter(id => !isPendingStageTaskId(id));
            const action = planPanelKeyAction({
                key: event.key,
                blocked,
                panelOpen: Boolean(panelTaskId),
                focusedId,
                visibleIds,
            });
            if (action.type === 'move') {
                event.preventDefault();
                setFocusedId(action.taskId);
                if (action.panel) onOpenTask(action.taskId, null);
                const row = listRef.current?.querySelector(`[data-plan-row="${action.taskId}"]`);
                if (row instanceof HTMLElement && typeof row.scrollIntoView === 'function') {
                    try { row.scrollIntoView({ block: 'nearest' }); } catch { /* not available in every test DOM */ }
                }
                return;
            }
            if (action.type === 'open') {
                event.preventDefault();
                openTask(action.taskId, null);
                return;
            }
            if (action.type === 'close') {
                event.preventDefault();
                onClosePanel?.();
                return;
            }
            if (event.key === 'Escape' && query && !blocked) onQueryChange('');
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [focusedId, onClosePanel, onOpenTask, onQueryChange, openTask, panelTaskId, query]);

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
                    {onOpenResults && (
                        <button
                            type="button"
                            onClick={onOpenResults}
                            className="text-xs text-[#8b8b93] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                        >
                            Results
                        </button>
                    )}
                    <label htmlFor={searchId} className="sr-only">Search tasks</label>
                    <input
                        ref={searchRef}
                        id={searchId}
                        type="search"
                        value={query}
                        onChange={event => onQueryChange(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                onQueryChange('');
                                event.currentTarget.blur();
                            }
                        }}
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
                onOpenTask={openTask}
                onReorder={onReorder}
                onSetLiveUrl={onSetLiveUrl}
                resultsByTaskId={resultsByTaskId}
            />
        </div>
    );
    if (!panel) return list;
    return (
        <div data-plan-shell="open" className="flex items-start">
            {list}
            {panel}
        </div>
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
    onOpenTask,
    onReorder,
    onSetLiveUrl,
    resultsByTaskId,
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
    onOpenTask: (taskId: string, field: PlanPanelField | null) => void;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
}) {
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [showDone, setShowDone] = useState(false);
    const [dragId, setDragId] = useState<string | null>(null);
    const [hint, setHint] = useState<DropHint | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const dragIdRef = useRef<string | null>(null);
    const seenHint = useRef('');
    const baseId = useId();

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
                                const hideGroup = foldDone && isPlanDone(group.task.status);
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
                                            dragId={dragId}
                                            foldDone={foldDone}
                                            baseId={baseId}
                                            focusedId={focusedId}
                                            onOpenTask={onOpenTask}
                                            onSetLiveUrl={onSetLiveUrl}
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
    dragId,
    foldDone,
    baseId,
    focusedId,
    onOpenTask,
    onSetLiveUrl,
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
    dragId: string | null;
    foldDone: boolean;
    baseId: string;
    focusedId: string | null;
    onOpenTask: (taskId: string, field: PlanPanelField | null) => void;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
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
    const visibleChildren = group.children.filter(child => !(foldDone && isPlanDone(child.status)));
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
        const due = formatPlanDue(task, today);
        const hours = options.pillar
            ? planHourRollup(task.id, group.rollupChildIds, loggedHours)
            : null;
        const logged = hours ? hours.total : (loggedHours[task.id] ?? 0);
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
        const draggable = !searching && !pending && options.role === 'task';
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
                    if (searching || !dragId || pending) return;
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
                    if (searching || pending) return;
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
                    focusedId === task.id && 'bg-[#1d1d22] shadow-[inset_2px_0_0_#ec4899]',
                )}
            >
                <span className="flex justify-center">
                    {options.leading ?? <span className="w-3.5" />}
                </span>
                <span className="flex justify-center">
                    {options.pillar
                        ? <ProgressRing done={options.childDone ?? 0} total={options.childCount ?? 0} />
                        : <CheckBox done={done} />}
                </span>
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        type="button"
                        data-plan-open="title"
                        disabled={pending}
                        onClick={() => { if (!pending) onOpenTask(task.id, null); }}
                        className={cn(
                            'flex min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899] disabled:opacity-70',
                            options.pillar && 'font-semibold',
                        )}
                    >
                        {options.parentTitle && <span className="sr-only">Subtask of {options.parentTitle}. </span>}
                        <TitleText title={task.title} query={query} done={done} />
                    </button>
                    {options.pillar && (
                        <span className="shrink-0 rounded-full bg-[#1d1d22] px-1.5 py-0.5 text-[11px] text-[#cfcfd4]">
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
                        onSave={!pending && onSetLiveUrl ? raw => onSetLiveUrl(task.id, raw) : undefined}
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
                    disabled={pending}
                    onClick={() => { if (!pending) onOpenTask(task.id, 'due'); }}
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
                    disabled={pending}
                    aria-label={assigneeIds.length === 0 ? 'Assignee, unassigned' : 'Assignee'}
                    onClick={() => { if (!pending) onOpenTask(task.id, 'assignee'); }}
                    className="flex justify-end focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ec4899]"
                >
                    <AssigneeStack ids={assigneeIds} people={people} />
                </button>
                <span
                    className={cn('text-right text-[12px]', logged > 0 ? 'text-[#cfcfd4]' : 'text-[#6d6d75]')}
                    title={hours ? hours.tooltip : undefined}
                    data-plan-time={options.pillar ? `Σ ${formatPlanHours(logged)}` : formatPlanHours(logged)}
                >
                    {options.pillar ? `Σ ${formatPlanHours(logged)}` : formatPlanHours(logged)}
                </span>
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
