'use client';

import { Task } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Play, Pause, ChevronDown, ChevronRight, User, Calendar, Tag, MoreVertical } from 'lucide-react';
import { useState } from 'react';

interface TaskListViewProps {
    tasks: Task[];
    onTaskClick: (task: Task) => void;
    onToggleTimer: (taskId: string) => void;
}

export function TaskListView({ tasks, onTaskClick, onToggleTimer }: TaskListViewProps) {
    const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set(['Sunrise Medical Center', 'Pacific Coast Realty', 'Green Thumb Landscaping']));

    // Group tasks by client
    const groupedTasks = tasks.reduce((acc, task) => {
        const clientName = task.clientName || 'General';
        if (!acc[clientName]) acc[clientName] = [];
        acc[clientName].push(task);
        return acc;
    }, {} as Record<string, Task[]>);

    const toggleClient = (clientName: string) => {
        const newExpanded = new Set(expandedClients);
        if (newExpanded.has(clientName)) {
            newExpanded.delete(clientName);
        } else {
            newExpanded.add(clientName);
        }
        setExpandedClients(newExpanded);
    };

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
                                            {expandedClients.has(clientName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                            <span className="font-bold text-foreground">{clientName}</span>
                                            <span className="text-xs text-muted-foreground font-normal ml-2">{clientTasks.length} tasks</span>
                                        </div>
                                    </td>
                                </tr>
                                {expandedClients.has(clientName) && clientTasks.map((task) => (
                                    <tr
                                        key={task.id}
                                        className="group hover:bg-muted/20 transition-colors cursor-pointer border-b border-border/10 last:border-b-0"
                                        onClick={() => onTaskClick(task)}
                                    >
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-4">
                                                <input
                                                    type="checkbox"
                                                    className="rounded border-border text-primary focus:ring-primary"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-foreground">{task.title}</span>
                                                    <span className="text-[10px] text-muted-foreground">Full Service Marketing</span>
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
                                            <button className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-muted/50 border border-border text-[11px] w-24">
                                                <span className="capitalize">{task.status.replace('_', ' ')}</span>
                                                <ChevronDown className="h-3 w-3 opacity-50" />
                                            </button>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Calendar className="h-3 w-3" />
                                                {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center justify-center -space-x-1">
                                                {task.assignees.map((assignee, i) => (
                                                    <div
                                                        key={i}
                                                        className="w-6 h-6 rounded-full border-2 border-card bg-primary/20 flex items-center justify-center text-[8px] font-bold text-primary"
                                                        title={assignee}
                                                    >
                                                        {assignee.charAt(0)}
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-2">
                                                <button
                                                    className={cn(
                                                        "p-1.5 rounded-full transition-all",
                                                        task.isTimerRunning ? "bg-red-500/10 text-red-500 opacity-100" : "hover:bg-muted opacity-0 group-hover:opacity-100 text-muted-foreground"
                                                    )}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onToggleTimer(task.id);
                                                    }}
                                                >
                                                    {task.isTimerRunning ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                                                </button>
                                                <button className="p-1.5 rounded-full hover:bg-muted text-muted-foreground">
                                                    <MoreVertical className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
