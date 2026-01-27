'use client';

import { useState } from 'react';
import { Plus, LayoutGrid, List, Search, Filter, User } from 'lucide-react';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { ClientListPanel } from '@/components/workspace/ClientListPanel';
import { Task, ClientProject } from '@/lib/types';
import { cn } from '@/lib/utils';
import { mockClients } from '@/lib/mock-data/workspace';
import { mockTasks as initialTasks } from '@/lib/mock-data/tasks';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

const mockTasks = initialTasks;

const columns = [
    { id: 'todo', title: 'To Do' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'review', title: 'Review' },
    { id: 'done', title: 'Done' },
];

export default function TasksPage() {
    const searchParams = useSearchParams();
    const clientFilter = searchParams.get('client');
    const [view, setView] = useState<'kanban' | 'list'>('list');
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [tasks, setTasks] = useState<Task[]>(mockTasks);

    const filteredTasks = clientFilter
        ? tasks.filter(t => t.id === clientFilter || t.clientName === mockClients.find((c: ClientProject) => c.id === clientFilter)?.clientName)
        : tasks;

    const handleTaskClick = (task: Task) => {
        setSelectedTask(task);
        setIsDetailOpen(true);
    };

    const toggleTimer = (taskId: string) => {
        setTasks(prev => prev.map(t => {
            if (t.id === taskId) {
                const isRunning = !t.isTimerRunning;
                return {
                    ...t,
                    isTimerRunning: isRunning,
                    startTime: isRunning ? new Date().toISOString() : t.startTime,
                    elapsedTime: t.elapsedTime || 0
                };
            }
            return { ...t, isTimerRunning: false };
        }));
    };

    return (
        <div className="h-full flex flex-col space-y-6 p-6 overflow-y-auto w-full max-w-7xl mx-auto custom-scrollbar">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">Task List</h2>
                    <p className="text-muted-foreground text-sm">View and manage all tasks across projects</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-muted p-1 rounded-lg flex items-center gap-1">
                        <button
                            onClick={() => setView('kanban')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                view === 'kanban' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setView('list')}
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                view === 'list' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <List className="h-4 w-4" />
                        </button>
                    </div>
                    <button className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20">
                        All Tasks
                    </button>
                    <button className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                        <User className="h-4 w-4" />
                        Unassigned <span className="ml-1 px-1.5 rounded bg-orange-500/10 text-orange-500 text-[10px] font-bold">6</span>
                    </button>
                    <button className="flex items-center gap-2 rounded-lg bg-card border border-border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                        <Filter className="h-4 w-4" />
                        Overdue <span className="ml-1 px-1.5 rounded bg-red-500/10 text-red-500 text-[10px] font-bold">2</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0">
                {view === 'kanban' ? (
                    <div className="flex h-full gap-6 overflow-x-auto pb-4 custom-scrollbar">
                        {columns.map((col) => (
                            <div key={col.id} className="flex h-full w-80 shrink-0 flex-col rounded-xl border border-border/50 bg-card/50 p-4">
                                <div className="mb-4 flex items-center justify-between">
                                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{col.title}</h3>
                                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                        {filteredTasks.filter(t => t.status === col.id).length}
                                    </span>
                                </div>
                                <div className="flex flex-1 flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
                                    {filteredTasks
                                        .filter((task) => task.status === col.id)
                                        .map((task) => (
                                            <div key={task.id} onClick={() => handleTaskClick(task)}>
                                                <TaskCard task={task as any} />
                                            </div>
                                        ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <TaskListView
                        tasks={filteredTasks}
                        onTaskClick={handleTaskClick}
                        onToggleTimer={toggleTimer}
                    />
                )}
            </div>

            <TaskDetailModal
                task={selectedTask}
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
            />
        </div>
    );
}
