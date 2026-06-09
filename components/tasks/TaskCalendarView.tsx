'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import {
    startOfMonth, endOfMonth, startOfWeek, endOfWeek,
    eachDayOfInterval, isSameMonth, isToday,
    format, addMonths, subMonths,
} from 'date-fns';
import { Task } from '@/lib/types';
import { updateTask } from '@/lib/supabase/tasks';
import { cn } from '@/lib/utils';

interface TaskCalendarViewProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    onDateClick?: (date: string) => void;
    onTaskUpdated?: (task: Task) => void;
}

const PRIORITY_CHIP: Record<string, string> = {
    urgent: 'bg-red-500/15 text-red-600 border-red-500/25',
    high: 'bg-orange-500/15 text-orange-600 border-orange-500/25',
    medium: 'bg-blue-500/15 text-blue-600 border-blue-500/25',
    low: 'bg-muted text-muted-foreground border-border',
};

const STATUS_DOT: Record<string, string> = {
    done: 'bg-green-500',
    in_progress: 'bg-orange-500',
    review: 'bg-yellow-500',
    approved: 'bg-blue-500',
    blocked: 'bg-red-500',
    todo: 'bg-muted-foreground/40',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE = 3;

export function TaskCalendarView({ tasks, onTaskClick, onDateClick, onTaskUpdated }: TaskCalendarViewProps) {
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [dragTaskId, setDragTaskId] = useState<string | null>(null);
    const [dragOverDate, setDragOverDate] = useState<string | null>(null);

    // Build grid: startOfWeek(startOfMonth) → endOfWeek(endOfMonth) — 35 or 42 cells
    const gridStart = startOfWeek(startOfMonth(currentMonth));
    const gridEnd = endOfWeek(endOfMonth(currentMonth));
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

    // Index tasks by due date
    const tasksByDate = tasks.reduce<Record<string, Task[]>>((acc, task) => {
        if (!task.dueDate) return acc;
        const key = task.dueDate.slice(0, 10);
        (acc[key] = acc[key] ?? []).push(task);
        return acc;
    }, {});

    // Drag handlers
    const handleDragStart = (e: React.DragEvent, taskId: string) => {
        setDragTaskId(taskId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, dateStr: string) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverDate(dateStr);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOverDate(null);
        }
    };

    const handleDrop = async (e: React.DragEvent, dateStr: string) => {
        e.preventDefault();
        setDragOverDate(null);
        if (!dragTaskId) return;
        setDragTaskId(null);
        const result = await updateTask(dragTaskId, { dueDate: dateStr });
        if (result.success && result.data) onTaskUpdated?.(result.data);
    };

    return (
        <div className="flex flex-col h-full gap-3">
            {/* Month navigation */}
            <div className="flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
                        className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <h3 className="text-base font-bold w-40 text-center">
                        {format(currentMonth, 'MMMM yyyy')}
                    </h3>
                    <button
                        onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
                        className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
                <button
                    onClick={() => setCurrentMonth(new Date())}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                >
                    Today
                </button>
            </div>

            {/* Day-of-week labels */}
            <div className="grid grid-cols-7 shrink-0">
                {DAY_LABELS.map(d => (
                    <div key={d} className="text-center text-[11px] font-bold uppercase tracking-wider text-muted-foreground py-1">
                        {d}
                    </div>
                ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 flex-1 gap-px bg-border/30 rounded-xl overflow-hidden border border-border/40">
                {days.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayTasks = tasksByDate[dateStr] ?? [];
                    const inMonth = isSameMonth(day, currentMonth);
                    const todayCell = isToday(day);
                    const isDrop = dragOverDate === dateStr;

                    const visible = dayTasks.slice(0, MAX_VISIBLE);
                    const overflow = dayTasks.length - MAX_VISIBLE;

                    return (
                        <div
                            key={dateStr}
                            onDragOver={e => handleDragOver(e, dateStr)}
                            onDragLeave={handleDragLeave}
                            onDrop={e => handleDrop(e, dateStr)}
                            onClick={() => onDateClick?.(dateStr)}
                            className={cn(
                                'bg-card p-2 flex flex-col gap-1 cursor-pointer transition-colors min-h-[100px]',
                                !inMonth && 'bg-muted/10',
                                isDrop && 'ring-2 ring-inset ring-primary bg-primary/5',
                                'hover:bg-muted/20',
                            )}
                        >
                            {/* Date number */}
                            <div className={cn(
                                'text-[11px] font-semibold w-6 h-6 flex items-center justify-center rounded-full shrink-0 self-start',
                                todayCell && 'bg-red-600 text-white',
                                !todayCell && inMonth && 'text-foreground',
                                !todayCell && !inMonth && 'text-muted-foreground/35',
                            )}>
                                {format(day, 'd')}
                            </div>

                            {/* Task chips */}
                            {visible.map(task => (
                                <div
                                    key={task.id}
                                    draggable
                                    onDragStart={e => { e.stopPropagation(); handleDragStart(e, task.id); }}
                                    onClick={e => { e.stopPropagation(); onTaskClick(task); }}
                                    title={task.title}
                                    className={cn(
                                        'flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border truncate cursor-grab active:cursor-grabbing select-none',
                                        PRIORITY_CHIP[task.priority] ?? PRIORITY_CHIP.medium,
                                    )}
                                >
                                    <span className={cn('shrink-0 w-1.5 h-1.5 rounded-full', STATUS_DOT[task.status] ?? STATUS_DOT.todo)} />
                                    <span className="truncate leading-tight">{task.title}</span>
                                </div>
                            ))}

                            {/* Overflow badge */}
                            {overflow > 0 && (
                                <span
                                    onClick={e => e.stopPropagation()}
                                    className="text-[10px] text-muted-foreground font-medium pl-1"
                                >
                                    +{overflow} more
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-4 shrink-0 text-[11px] text-muted-foreground px-1">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
                    <span key={p} className={cn('flex items-center gap-1 capitalize px-2 py-0.5 rounded border', PRIORITY_CHIP[p])}>
                        {p}
                    </span>
                ))}
                <span className="ml-auto opacity-60">Drag tasks to reschedule</span>
            </div>
        </div>
    );
}
