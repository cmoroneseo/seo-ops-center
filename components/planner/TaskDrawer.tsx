'use client';

import { useId, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/types';

interface TaskDrawerProps {
    title: string;
    tasks: Task[];
    defaultOpen?: boolean;
    emptyLabel?: string;
    onTaskClick?: (task: Task) => void;
    /** Fires on pointerdown so the grid can pick the task up. */
    onTaskDragStart?: (task: Task, e: React.PointerEvent) => void;
}

export function TaskDrawer({
    title, tasks, defaultOpen = false, emptyLabel = 'No tasks match these filters',
    onTaskClick, onTaskDragStart,
}: TaskDrawerProps) {
    const [open, setOpen] = useState(defaultOpen);
    const contentId = useId();

    return (
        <div className="border-b border-border/60 py-2">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-expanded={open}
                aria-controls={contentId}
                className="flex min-h-11 w-full items-center gap-1 rounded px-3 py-1 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                {title}
                {tasks.length > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">{tasks.length}</span>
                )}
            </button>

            {open && (
                <div id={contentId} className="mt-1 space-y-1 px-3">
                    {tasks.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                            {emptyLabel}
                        </div>
                    ) : (
                        tasks.map(task => (
                            <button
                                type="button"
                                key={task.id}
                                onPointerDown={e => onTaskDragStart?.(task, e)}
                                onClick={() => onTaskClick?.(task)}
                                className={cn(
                                    'w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs',
                                    onTaskDragStart && 'cursor-grab active:cursor-grabbing',
                                    'hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                )}
                            >
                                <span className="block truncate font-medium">{task.title}</span>
                                {task.clientName && (
                                    <span className="block truncate text-[10px] text-muted-foreground">
                                        {task.clientName}
                                    </span>
                                )}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
