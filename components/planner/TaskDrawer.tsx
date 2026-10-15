'use client';

import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PlannerSearchGroup } from '@/lib/planner/task-sessions';
import { Task } from '@/lib/types';

interface TaskDrawerProps {
    title: string;
    tasks: Task[];
    /** Find Tasks rows. When set, subtasks render under their pillar instead of `tasks`. */
    groups?: PlannerSearchGroup[];
    defaultOpen?: boolean;
    emptyLabel?: string;
    onTaskClick?: (task: Task) => void;
    /** Fires on pointerdown so the grid can pick the task up. */
    onTaskDragStart?: (task: Task, e: React.PointerEvent) => void;
    taskDropTarget?: 'backlog';
    dropTargetActive?: boolean;
    showStatus?: boolean;
}

function taskStatusLabel(status: string): string {
    if (status === 'in_progress') return 'In progress';
    if (status === 'done') return 'Completed';
    if (status === 'todo') return 'To do';
    return status.replaceAll('_', ' ');
}

function subtaskCountLabel(count: number): string {
    return count === 1 ? '1 subtask' : `${count} subtasks`;
}

function TaskSearchRow({
    task,
    showStatus,
    draggable,
    framed = true,
    breadcrumb,
    detail,
    parentTitle,
    onTaskClick,
    onTaskDragStart,
}: {
    task: Task;
    showStatus: boolean;
    draggable: boolean;
    framed?: boolean;
    breadcrumb?: string;
    detail?: string;
    parentTitle?: string;
    onTaskClick?: (task: Task) => void;
    onTaskDragStart?: (task: Task, e: React.PointerEvent) => void;
}) {
    const canDrag = draggable && task.status !== 'done' && Boolean(onTaskDragStart);
    return (
        <button
            type="button"
            data-planner-draggable={canDrag ? 'true' : 'false'}
            onPointerDown={event => { if (canDrag) onTaskDragStart?.(task, event); }}
            onClick={() => onTaskClick?.(task)}
            className={cn(
                'min-w-0 flex-1 text-left text-xs',
                framed && 'w-full rounded-md border border-border bg-card px-2.5 py-1.5 hover:border-primary/40',
                !framed && 'px-1 py-1.5 pr-2.5',
                canDrag && 'cursor-grab active:cursor-grabbing',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            )}
        >
            {parentTitle && <span className="sr-only">Subtask of {parentTitle}. </span>}
            <span className="block truncate font-medium">{task.title}</span>
            {breadcrumb && (
                <span className="block truncate text-[10px] text-muted-foreground">{breadcrumb}</span>
            )}
            {task.clientName && (
                <span className="block truncate text-[10px] text-muted-foreground">{task.clientName}</span>
            )}
            {detail && <span className="mt-1 block text-[10px] text-muted-foreground">{detail}</span>}
            {showStatus && (
                <span className="mt-1 block text-[10px] text-muted-foreground">{taskStatusLabel(task.status)}</span>
            )}
        </button>
    );
}

function PlannerSearchGroups({
    groups,
    showStatus,
    onTaskClick,
    onTaskDragStart,
}: {
    groups: PlannerSearchGroup[];
    showStatus: boolean;
    onTaskClick?: (task: Task) => void;
    onTaskDragStart?: (task: Task, e: React.PointerEvent) => void;
}) {
    const [openIds, setOpenIds] = useState(() => new Set(
        groups.filter(group => group.expandChildren).map(group => group.task.id),
    ));
    const toggle = (id: string) => {
        setOpenIds(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="space-y-1">
            {groups.map(group => {
                const open = openIds.has(group.task.id);
                const hasChildren = group.children.length > 0;
                const countLabel = subtaskCountLabel(group.children.length);
                const subtaskListId = `planner-subtasks-${group.task.id}`;
                return (
                    <div key={group.task.id}>
                        {hasChildren ? (
                            <div className="flex items-start rounded-md border border-border bg-card hover:border-primary/40">
                                <button
                                    type="button"
                                    aria-expanded={open}
                                    aria-controls={subtaskListId}
                                    aria-label={`${open ? 'Hide' : 'Show'} ${countLabel} of ${group.task.title}`}
                                    onClick={() => toggle(group.task.id)}
                                    className="ml-0.5 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <ChevronRight aria-hidden="true" className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                                </button>
                                <TaskSearchRow
                                    task={group.task}
                                    showStatus={showStatus}
                                    draggable
                                    framed={false}
                                    detail={countLabel}
                                    onTaskClick={onTaskClick}
                                    onTaskDragStart={onTaskDragStart}
                                />
                            </div>
                        ) : (
                            <TaskSearchRow
                                task={group.task}
                                showStatus={showStatus}
                                draggable
                                breadcrumb={group.parentBreadcrumb}
                                onTaskClick={onTaskClick}
                                onTaskDragStart={onTaskDragStart}
                            />
                        )}
                        {hasChildren && open && (
                            <div
                                id={subtaskListId}
                                role="group"
                                aria-label={`Subtasks of ${group.task.title}`}
                                className="mt-1 space-y-1 pl-12"
                            >
                                {group.children.map(child => (
                                    <TaskSearchRow
                                        key={child.id}
                                        task={child}
                                        showStatus={showStatus}
                                        draggable={false}
                                        parentTitle={group.task.title}
                                        onTaskClick={onTaskClick}
                                        onTaskDragStart={onTaskDragStart}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export function TaskDrawer({
    title, tasks, groups, defaultOpen = false, emptyLabel = 'No tasks match these filters',
    onTaskClick, onTaskDragStart, taskDropTarget, dropTargetActive = false,
    showStatus = false,
}: TaskDrawerProps) {
    const [open, setOpen] = useState(defaultOpen);
    const contentId = useId();
    const count = groups ? groups.length : tasks.length;
    const groupKey = groups
        ?.map(group => `${group.task.id}:${group.expandChildren ? 1 : 0}:${group.children.map(child => child.id).join(',')}`)
        .join('|');

    return (
        <div
            role={taskDropTarget ? 'group' : undefined}
            data-planner-task-drop-target={taskDropTarget}
            aria-label={taskDropTarget ? 'Drop task to move to Backlog' : undefined}
            className={cn(
                'border-b border-border/60 py-2 transition-colors',
                dropTargetActive && 'bg-primary/10 ring-2 ring-inset ring-primary',
            )}
        >
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls={contentId}
                className="flex min-h-11 w-full items-center gap-1 rounded px-3 py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                {dropTargetActive && taskDropTarget ? 'Drop to move to Backlog' : title}
                {count > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">{count}</span>
                )}
            </button>

            {open && (
                <div id={contentId} className="mt-1 space-y-1 px-3">
                    {count === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                            {emptyLabel}
                        </div>
                    ) : groups ? (
                        <PlannerSearchGroups
                            key={groupKey}
                            groups={groups}
                            showStatus={showStatus}
                            onTaskClick={onTaskClick}
                            onTaskDragStart={onTaskDragStart}
                        />
                    ) : (
                        tasks.map(task => (
                            <TaskSearchRow
                                key={task.id}
                                task={task}
                                showStatus={showStatus}
                                draggable
                                onTaskClick={onTaskClick}
                                onTaskDragStart={onTaskDragStart}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
