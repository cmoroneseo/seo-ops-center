'use client';

import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CornerUpLeft, GripVertical } from 'lucide-react';
import { isPendingStageTaskId } from '@/lib/seo-plan/stage-add';
import {
    describeStageDrop,
    stageMoveBy,
    type StageDropHint,
    type StageMoveDirection,
    type StageReorderMove,
} from '@/lib/seo-plan/stage-reorder';
import {
    groupTasksByStage,
    stageListTitleParts,
    TASK_STAGE_LABELS,
    type StageListGroup,
    type StageListSection,
    type StageListTask,
} from '@/lib/seo-plan/stage-list';
import type { TaskStage } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LiveUrlResultLine } from '@/components/search-reporting/LiveUrlResultLine';
import { LiveUrlControl } from '@/components/tasks/LiveUrlControl';
import { aggregateUrlResults, type UrlResultReadout } from '@/lib/search-reporting/url-results';
import { StageAddBar } from './StageAddBar';

export interface StageAddRequest {
    stage: TaskStage;
    titles: string[];
    parentTaskId?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
    content: 'Content',
    technical: 'Technical',
    local: 'Local',
    links: 'Links',
    strategy: 'Strategy',
    admin: 'Admin',
};

const ROW_GRID = 'grid grid-cols-1 items-center gap-1 border-t border-border py-2.5 md:grid-cols-[minmax(0,1fr)_160px_120px_110px] md:gap-3';

function statusLabel(status: string): string {
    if (status === 'in_progress') return 'In progress';
    if (status === 'todo') return 'To do';
    if (status === 'done') return 'Done';
    if (status === 'approved') return 'Approved';
    if (status === 'review') return 'Review';
    if (status === 'blocked') return 'Blocked';
    return status.replaceAll('_', ' ');
}

function statusDot(status: string): string {
    if (status === 'in_progress') return 'bg-blue-500';
    if (status === 'review') return 'bg-amber-500';
    if (status === 'done' || status === 'approved') return 'bg-emerald-600';
    if (status === 'blocked') return 'bg-red-500';
    return 'bg-muted-foreground/40';
}

function categoryLabel(category: string | null): string {
    if (!category) return '';
    return CATEGORY_LABELS[category] ?? category;
}

function pointerFraction(event: DragEvent<HTMLElement>): number {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return 0.5;
    return (event.clientY - rect.top) / rect.height;
}

function hintKey(hint: StageDropHint | null): string {
    if (!hint) return '';
    if (hint.type === 'nest') return `nest:${hint.taskId}`;
    return `insert:${hint.stage}:${hint.parentTaskId ?? ''}:${hint.beforeTaskId ?? ''}`;
}

function moveLabel(
    task: StageListTask,
    direction: StageMoveDirection,
    parentTitle: string | undefined,
    move: StageReorderMove | null,
): string {
    if (direction === 'up') return `Move ${task.title} up`;
    if (direction === 'down') return `Move ${task.title} down`;
    if (direction === 'unnest') return `Move ${task.title} out of ${parentTitle ?? 'its pillar'}`;
    if (move) return `Move ${task.title} to ${TASK_STAGE_LABELS[move.stage]}`;
    return direction === 'previous-stage'
        ? `Move ${task.title} to the previous stage`
        : `Move ${task.title} to the next stage`;
}

function StageMoveButtons({
    task,
    tasks,
    role,
    parentTitle,
    onMove,
}: {
    task: StageListTask;
    tasks: readonly StageListTask[];
    role: 'task' | 'subtask';
    parentTitle?: string;
    onMove: (move: StageReorderMove) => void;
}) {
    const directions: StageMoveDirection[] = role === 'subtask'
        ? ['up', 'down', 'unnest']
        : ['up', 'down', 'previous-stage', 'next-stage'];
    const icon = {
        up: ChevronUp,
        down: ChevronDown,
        'previous-stage': ChevronLeft,
        'next-stage': ChevronRight,
        unnest: CornerUpLeft,
    };
    return (
        <div className="ml-auto flex shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {directions.map(direction => {
                const move = stageMoveBy(tasks, task.id, direction);
                const Icon = icon[direction];
                return (
                    <button
                        key={direction}
                        type="button"
                        data-stage-move={direction}
                        disabled={!move}
                        aria-label={moveLabel(task, direction, parentTitle, move)}
                        onClick={() => { if (move) onMove(move); }}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
                    >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );
}

function TitleText({ title, query, done }: { title: string; query: string; done: boolean }) {
    const parts = stageListTitleParts(title, query);
    return (
        <span className={cn(done && 'text-muted-foreground line-through')}>
            {parts.map((part, index) => part.match
                ? <mark key={index} className="rounded-sm bg-primary/15 px-0.5 text-inherit">{part.text}</mark>
                : <span key={index}>{part.text}</span>)}
        </span>
    );
}

function StageSections({
    tasks,
    sections,
    query,
    searching,
    onOpenTask,
    onAddTasks,
    onReorder,
    onSetLiveUrl,
    resultsByTaskId,
}: {
    tasks: readonly StageListTask[];
    sections: StageListSection[];
    query: string;
    searching: boolean;
    onOpenTask: (taskId: string) => void;
    onAddTasks: (input: StageAddRequest) => Promise<void>;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
}) {
    const [openOverrides, setOpenOverrides] = useState<Record<string, boolean>>({});
    const [dragId, setDragId] = useState<string | null>(null);
    const [hint, setHint] = useState<StageDropHint | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);
    const dragIdRef = useRef<string | null>(null);
    const seenHint = useRef('');
    const baseId = useId();

    const rememberDrag = (id: string | null) => {
        dragIdRef.current = id;
        setDragId(id);
    };

    const showHint = (next: StageDropHint | null) => {
        const key = hintKey(next);
        if (key === seenHint.current) return;
        seenHint.current = key;
        setHint(next);
    };

    const clearDrag = () => {
        rememberDrag(null);
        showHint(null);
    };

    const commitMove = (move: StageReorderMove) => {
        clearDrag();
        setMoveError(null);
        void onReorder(move).catch(() => setMoveError('Could not move that task.'));
    };

    const dropOn = (
        event: DragEvent<HTMLElement>,
        target: { overTaskId: string | null; overStage: TaskStage | null; overParentId: string | null; useFraction: boolean },
    ) => {
        const activeId = dragIdRef.current;
        if (!activeId) return null;
        return describeStageDrop({
            tasks,
            dragId: activeId,
            overTaskId: target.overTaskId,
            overStage: target.overStage,
            overParentId: target.overParentId,
            pointerFraction: target.useFraction ? pointerFraction(event) : null,
        });
    };

    const isOpen = (group: StageListGroup) => {
        if (group.task.id in openOverrides) return openOverrides[group.task.id];
        return searching ? group.expandChildren : true;
    };

    const renderRow = (task: StageListTask, options: {
        role: 'task' | 'subtask';
        parentTitle?: string;
        parentId?: string;
        className?: string;
        leading?: ReactNode;
        extra?: ReactNode;
        result?: UrlResultReadout | null;
        key?: string;
    }) => {
        const done = task.status === 'done' || task.status === 'approved';
        const pending = isPendingStageTaskId(task.id);
        const movable = !searching && !pending;
        const draggable = movable && options.role === 'task';
        const nesting = hint?.type === 'nest' && hint.taskId === task.id;
        return (
            <div
                key={options.key}
                data-stage-role={options.role}
                data-task-id={task.id}
                data-parent-id={options.parentId}
                data-pending={pending ? 'true' : undefined}
                data-stage-drag={draggable ? 'task' : undefined}
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
                    rememberDrag(task.id);
                }}
                onDragOver={event => {
                    if (!movable || !dragIdRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    showHint(dropOn(event, {
                        overTaskId: task.id,
                        overStage: null,
                        overParentId: null,
                        useFraction: true,
                    })?.hint ?? null);
                }}
                onDrop={event => {
                    if (!movable || !dragIdRef.current) return;
                    event.preventDefault();
                    event.stopPropagation();
                    const drop = dropOn(event, {
                        overTaskId: task.id,
                        overStage: null,
                        overParentId: null,
                        useFraction: true,
                    });
                    if (drop) commitMove(drop.move);
                    else clearDrag();
                }}
                onDragEnd={clearDrag}
                className={cn(
                    ROW_GRID,
                    'group',
                    options.className,
                    draggable && 'cursor-grab',
                    dragId === task.id && 'opacity-40',
                    nesting && 'bg-primary/5 ring-2 ring-inset ring-primary',
                )}
            >
                <div className="flex min-w-0 items-start gap-2">
                    {options.leading ?? <span className="w-4 shrink-0" />}
                    <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', statusDot(task.status))} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                        <button
                            type="button"
                            disabled={pending}
                            onClick={() => { if (!pending) onOpenTask(task.id); }}
                            className={cn(
                                'break-words text-left text-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-70',
                            )}
                        >
                            {options.parentTitle && <span className="sr-only">Subtask of {options.parentTitle}. </span>}
                            <TitleText title={task.title} query={query} done={done} />
                        </button>
                        {options.parentTitle && <div className="text-xs text-muted-foreground">in {options.parentTitle}</div>}
                        <LiveUrlControl
                            url={task.publishedUrl}
                            category={task.category}
                            onSave={!pending && onSetLiveUrl ? raw => onSetLiveUrl(task.id, raw) : undefined}
                        />
                        <LiveUrlResultLine result={options.result} />
                        {options.extra}
                    </div>
                    {movable && (
                        <StageMoveButtons
                            task={task}
                            tasks={tasks}
                            role={options.role}
                            parentTitle={options.parentTitle}
                            onMove={commitMove}
                        />
                    )}
                </div>
                <span className="text-sm text-muted-foreground">{categoryLabel(task.category)}</span>
                <span className="text-sm text-muted-foreground">{statusLabel(task.status)}</span>
                <span className="text-sm text-muted-foreground">{task.basecamp ? 'Basecamp' : ''}</span>
            </div>
        );
    };

    const dropLine = (beforeTaskId: string | null, parentTaskId: string | null, stage: TaskStage) => {
        if (hint?.type !== 'insert' || hint.beforeTaskId !== beforeTaskId || hint.parentTaskId !== parentTaskId || hint.stage !== stage) {
            return null;
        }
        return <div data-stage-drop-line className="h-0.5 bg-primary" />;
    };

    return (
        <>
            {moveError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{moveError}</p>}
            {sections.map(section => {
                const headingId = `${baseId}-${section.stage}`;
                return (
                    <section
                        key={section.stage}
                        data-stage={section.stage}
                        data-stage-drop={searching ? undefined : section.stage}
                        aria-labelledby={headingId}
                        onDragOver={event => {
                            if (searching || !dragIdRef.current) return;
                            event.preventDefault();
                            showHint(dropOn(event, {
                                overTaskId: null,
                                overStage: section.stage,
                                overParentId: null,
                                useFraction: false,
                            })?.hint ?? null);
                        }}
                        onDrop={event => {
                            if (searching || !dragIdRef.current) return;
                            event.preventDefault();
                            const drop = dropOn(event, {
                                overTaskId: null,
                                overStage: section.stage,
                                overParentId: null,
                                useFraction: false,
                            });
                            if (drop) commitMove(drop.move);
                            else clearDrag();
                        }}
                    >
                        <h3 id={headingId} className="flex items-center gap-2 bg-muted/70 px-4 py-3 text-sm font-semibold">
                            {section.label}
                            <span className="text-xs font-normal text-muted-foreground" data-count={section.count}>{section.count}</span>
                            <span className="sr-only">{section.count === 1 ? 'task' : 'tasks'}</span>
                        </h3>
                        <div className="border-t border-border px-4 py-2" data-stage-add={section.stage}>
                            <StageAddBar
                                stage={section.stage}
                                label={`Add task to ${section.label}`}
                                placeholder="Add a task…"
                                onAdd={titles => onAddTasks({ stage: section.stage, titles })}
                            />
                        </div>
                        {section.groups.length === 0 ? (
                            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">No tasks</p>
                        ) : section.groups.map(group => {
                            const open = isOpen(group);
                            const panelId = `${baseId}-children-${group.task.id}`;
                            const subtaskLabel = group.children.length === 1 ? '1 subtask' : `${group.children.length} subtasks`;
                            const childResults = group.children.flatMap(child => {
                                const result = resultsByTaskId?.[child.id];
                                return result ? [result] : [];
                            });
                            const pillarResult = childResults.length > 0 ? aggregateUrlResults(childResults) : null;
                            return (
                                <div key={group.task.id}>
                                    {dropLine(group.task.id, null, section.stage)}
                                    {renderRow(group.task, {
                                        key: group.task.id,
                                        role: 'task',
                                        className: 'px-4',
                                        result: pillarResult ?? resultsByTaskId?.[group.task.id],
                                        leading: group.children.length > 0 ? (
                                            <button
                                                type="button"
                                                aria-expanded={open}
                                                aria-controls={panelId}
                                                aria-label={`${open ? 'Hide' : 'Show'} ${subtaskLabel} of ${group.task.title}`}
                                                onClick={() => setOpenOverrides(current => ({ ...current, [group.task.id]: !open }))}
                                                className="mt-0.5 text-muted-foreground hover:text-foreground"
                                            >
                                                <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
                                            </button>
                                        ) : undefined,
                                        extra: (
                                            <>
                                                {group.parentBreadcrumb && (
                                                    <div className="text-xs text-muted-foreground">{group.parentBreadcrumb}</div>
                                                )}
                                                {group.childCount > 0 && (
                                                    <div className="mt-1 text-xs text-primary">Pillar · {group.childDone}/{group.childCount}</div>
                                                )}
                                            </>
                                        ),
                                    })}
                                    {open && group.children.length > 0 && (
                                        <div
                                            id={panelId}
                                            data-stage-children={group.task.id}
                                            onDragOver={event => {
                                                if (searching || !dragIdRef.current) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                showHint(dropOn(event, {
                                                    overTaskId: null,
                                                    overStage: null,
                                                    overParentId: group.task.id,
                                                    useFraction: false,
                                                })?.hint ?? null);
                                            }}
                                            onDrop={event => {
                                                if (searching || !dragIdRef.current) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const drop = dropOn(event, {
                                                    overTaskId: null,
                                                    overStage: null,
                                                    overParentId: group.task.id,
                                                    useFraction: false,
                                                });
                                                if (drop) commitMove(drop.move);
                                                else clearDrag();
                                            }}
                                        >
                                            {group.children.map(child => (
                                                <div key={child.id}>
                                                    {dropLine(child.id, group.task.id, section.stage)}
                                                    {renderRow(child, {
                                                        role: 'subtask',
                                                        parentTitle: group.task.title,
                                                        parentId: group.task.id,
                                                        className: 'pl-11 pr-4',
                                                        result: resultsByTaskId?.[child.id],
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
                                                                    rememberDrag(child.id);
                                                                }}
                                                                onDragEnd={clearDrag}
                                                                className="mt-0.5 inline-flex cursor-grab text-muted-foreground"
                                                            >
                                                                <GripVertical className="h-4 w-4" />
                                                            </span>
                                                        ),
                                                    })}
                                                </div>
                                            ))}
                                            {dropLine(null, group.task.id, section.stage)}
                                            <div className="border-t border-border py-2 pl-11 pr-4">
                                                <StageAddBar
                                                    stage={section.stage}
                                                    parentTaskId={group.task.id}
                                                    label={`Add subtask to ${group.task.title}`}
                                                    placeholder="Add a subtask…"
                                                    onAdd={titles => onAddTasks({
                                                        stage: section.stage,
                                                        titles,
                                                        parentTaskId: group.task.id,
                                                    })}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {dropLine(null, null, section.stage)}
                    </section>
                );
            })}
        </>
    );
}

/**
 * Stage list. Collapse state is local. The add bar creates tasks. Dragging a
 * row reorders it or moves it between stages. The server assigns the positions.
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
    clientName,
}: {
    tasks: readonly StageListTask[];
    query: string;
    onQueryChange: (query: string) => void;
    onOpenTask: (taskId: string) => void;
    onAddTasks: (input: StageAddRequest) => Promise<void>;
    onReorder: (move: StageReorderMove) => Promise<void>;
    onSetLiveUrl?: (taskId: string, raw: string) => Promise<string | null>;
    resultsByTaskId?: Readonly<Record<string, UrlResultReadout>>;
    clientName?: string;
}) {
    const searchId = useId();
    const sections = groupTasksByStage(tasks, query);
    const searching = query.trim().length > 0;
    const label = clientName ? `Search tasks for ${clientName}` : 'Search tasks and subtasks';

    return (
        <div data-seo-plan-stage-list className="space-y-3">
            <label htmlFor={searchId} className="sr-only">{label}</label>
            <input
                id={searchId}
                type="search"
                value={query}
                onChange={event => onQueryChange(event.target.value)}
                placeholder="Search all tasks and subtasks…"
                className="w-full max-w-sm rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
            <div className="overflow-hidden rounded-xl border border-border bg-card">
                <StageSections
                    key={query}
                    tasks={tasks}
                    sections={sections}
                    query={query}
                    searching={searching}
                    onOpenTask={onOpenTask}
                    onAddTasks={onAddTasks}
                    onReorder={onReorder}
                    onSetLiveUrl={onSetLiveUrl}
                    resultsByTaskId={resultsByTaskId}
                />
            </div>
        </div>
    );
}
