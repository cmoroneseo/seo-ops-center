'use client';

import { Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Play, Pause, ChevronDown, ChevronRight, Calendar, MoreVertical } from 'lucide-react';
import { useState } from 'react';
import { useTimer } from '@/components/providers/timer-provider';

interface TaskListViewProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    /** @deprecated — timer is now handled internally via useTimer */
    onToggleTimer?: (taskId: string) => void;
}

export function TaskListView({ tasks, onTaskClick }: TaskListViewProps) {
    const { timer, start, pause } = useTimer();
    const [expandedClients, setExpandedClients] = useState<Set<string>>(() => {
        // Expand all client groups by default
        const groups = new Set<string>();
        tasks.forEach(t => groups.add(t.clientName || 'General'));
        return groups;
    });

    const groupedTasks = tasks.reduce((acc, task) => {
        const key = task.clientName || 'General';
        if (!acc[key]) acc[key] = [];
        acc[key].push(task);
        return acc;
    }, {} as Record<string, Task[]>);

    const toggleClient = (clientName: string) => {
        setExpandedClients(prev => {
            const next = new Set(prev);
            next.has(clientName) ? next.delete(clientName) : next.add(clientName);
            return next;
        });
    };

    const handleTimerClick = async (e: React.MouseEvent, task: Task) => {
        e.stopPropagation();
        const isRunning = timer?.status === 'running' && timer.taskId === task.id;
        if (isRunning) {
            await pause();
        } else if (task.clientId || task.projectId) {
            await start({
                clientId: task.clientId ?? task.projectId ?? '',
                clientName: task.clientName ?? 'Unknown',
                taskId: task.id,
                taskTitle: task.title,
            });
        }
    };

    const today = new Date().toISOString().slice(0, 10);

    return (
        <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                        <tr>
                            <th className="px-4 py-3 min-w-[300px]">Task</th>
                            <th className="px-4 py-3">Tags</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Due Date</th>
                            <th className="px-4 py-3 text-center">Assignees</th>
                            <th className="px-4 py-3 w-10"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                        {Object.entries(groupedTasks).map(([clientName, clientTasks]) => (
                            <>
                                <tr
                                    key={clientName}
                                    className="bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                                    onClick={() => toggleClient(clientName)}
                                >
                                    <td colSpan={6} className="px-4 py-2">
                                        <div className="flex items-center gap-2">
                                            {expandedClients.has(clientName)
                                                ? <ChevronDown className="h-4 w-4" />
                                                : <ChevronRight className="h-4 w-4" />}
                                            <span className="font-bold text-foreground">{clientName}</span>
                                            <span className="text-xs text-muted-foreground font-normal ml-2">{clientTasks.length} task{clientTasks.length !== 1 ? 's' : ''}</span>
                                        </div>
                                    </td>
                                </tr>
                                {expandedClients.has(clientName) && clientTasks.map((task) => {
                                    const isRunning = timer?.status === 'running' && timer.taskId === task.id;
                                    const isOverdue = task.dueDate && task.dueDate < today && task.status !== 'done';
                                    const assignees = task.assigneeIds ?? task.assignees ?? [];
                                    const canTimer = !!(task.clientId || task.projectId);

                                    return (
                                        <tr
                                            key={task.id}
                                            className={cn(
                                                "group hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10 last:border-b-0",
                                                isOverdue && "bg-red-500/5"
                                            )}
                                            onClick={() => onTaskClick(task)}
                                        >
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-4">
                                                    <input
                                                        type="checkbox"
                                                        checked={task.status === 'done'}
                                                        className="rounded border-border text-primary focus:ring-primary"
                                                        onClick={(e) => e.stopPropagation()}
                                                        readOnly
                                                    />
                                                    <div className="flex flex-col">
                                                        <span className={cn(
                                                            "font-medium text-foreground",
                                                            task.status === 'done' && "line-through text-muted-foreground"
                                                        )}>
                                                            {task.title}
                                                        </span>
                                                        {task.category && (
                                                            <span className="text-[10px] text-muted-foreground capitalize">{task.category}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex flex-wrap gap-1">
                                                    {task.tags.map(tag => (
                                                        <span key={tag} className="px-2 py-0.5 rounded bg-muted text-[10px] text-muted-foreground font-medium">{tag}</span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className={cn(
                                                    "px-2 py-0.5 rounded text-[10px] font-bold capitalize",
                                                    task.status === 'done' ? "bg-green-500/10 text-green-500" :
                                                    task.status === 'review' ? "bg-yellow-500/10 text-yellow-500" :
                                                    task.status === 'approved' ? "bg-blue-500/10 text-blue-500" :
                                                    task.status === 'blocked' ? "bg-red-500/10 text-red-500" :
                                                    task.status === 'in_progress' ? "bg-orange-500/10 text-orange-500" :
                                                    "bg-muted text-muted-foreground"
                                                )}>
                                                    {task.status.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td className="px-4 py-4">
                                                {task.dueDate ? (
                                                    <div className={cn(
                                                        "flex items-center gap-2 text-xs",
                                                        isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"
                                                    )}>
                                                        <Calendar className="h-3 w-3" />
                                                        {new Date(task.dueDate + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                                        {isOverdue && <span className="text-[9px] font-bold">OVERDUE</span>}
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground/40 italic">No date</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center justify-center -space-x-1">
                                                    {assignees.length === 0 ? (
                                                        <span className="text-[10px] text-muted-foreground/50 italic">—</span>
                                                    ) : (
                                                        assignees.slice(0, 3).map((assignee, i) => (
                                                            <div
                                                                key={i}
                                                                className="w-6 h-6 rounded-full border-2 border-card bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary"
                                                                title={assignee}
                                                            >
                                                                {assignee.charAt(0).toUpperCase()}
                                                            </div>
                                                        ))
                                                    )}
                                                    {assignees.length > 3 && (
                                                        <div className="w-6 h-6 rounded-full border-2 border-card bg-muted flex items-center justify-center text-[8px] font-bold text-muted-foreground">
                                                            +{assignees.length - 3}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-4 py-4">
                                                <div className="flex items-center gap-2">
                                                    {canTimer && (
                                                        <button
                                                            className={cn(
                                                                "p-1.5 rounded-full transition-all",
                                                                isRunning
                                                                    ? "bg-amber-500/15 text-amber-500 opacity-100"
                                                                    : "hover:bg-muted opacity-0 group-hover:opacity-100 text-muted-foreground"
                                                            )}
                                                            onClick={(e) => handleTimerClick(e, task)}
                                                        >
                                                            {isRunning
                                                                ? <Pause className="h-3 w-3 fill-current" />
                                                                : <Play className="h-3 w-3 fill-current" />}
                                                        </button>
                                                    )}
                                                    <button className="p-1.5 rounded-full hover:bg-muted text-muted-foreground opacity-0 group-hover:opacity-100 transition-all">
                                                        <MoreVertical className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </>
                        ))}
                        {Object.keys(groupedTasks).length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground text-sm italic">
                                    No tasks found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
