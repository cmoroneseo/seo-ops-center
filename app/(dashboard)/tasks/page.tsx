'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, LayoutGrid, List, Calendar, User, Filter, X, LayoutTemplate } from 'lucide-react';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { TaskTemplateLibrary } from '@/components/tasks/TaskTemplateLibrary';
import { Task, TaskTemplate } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'next/navigation';
import { useOrganization } from '@/components/providers/organization-provider';
import { getTasks, updateTask } from '@/lib/supabase/tasks';
import { getOrganizationMembers } from '@/lib/supabase/organizations';

const columns = [
    { id: 'todo', title: 'To Do' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'review', title: 'Review' },
    { id: 'approved', title: 'Approved' },
    { id: 'done', title: 'Done' },
] as const;

export default function TasksPage() {
    const searchParams = useSearchParams();
    const clientFilter = searchParams.get('client');
    const { organization, memberships } = useOrganization();
    const member = memberships.find(m => m.organizationId === organization?.id);
    const [view, setView] = useState<'kanban' | 'list' | 'calendar'>('list');
    const [calendarCreateDate, setCalendarCreateDate] = useState<string | undefined>(undefined);
    const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
    const [templatePrefill, setTemplatePrefill] = useState<TaskTemplate | undefined>(undefined);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [filterMode, setFilterMode] = useState<'all' | 'unassigned' | 'overdue'>('all');
    const [memberMap, setMemberMap] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!organization?.id) return;
        getOrganizationMembers(organization.id).then(members => {
            const map: Record<string, string> = {};
            members.forEach(m => { map[m.userId] = (m.user as any)?.fullName || (m.user as any)?.email || 'Team'; });
            setMemberMap(map);
        }).catch(() => {});
    }, [organization?.id]);

    const loadTasks = useCallback(async () => {
        if (!organization) return;
        setLoading(true);
        const data = await getTasks(organization.id);
        setTasks(data);
        setLoading(false);
    }, [organization?.id]);

    useEffect(() => { loadTasks(); }, [loadTasks]);

    const today = new Date().toISOString().slice(0, 10);

    const filteredTasks = tasks.filter(t => {
        // Client URL filter
        if (clientFilter && !t.clientName?.toLowerCase().includes(clientFilter.toLowerCase()) && t.clientId !== clientFilter) return false;
        // Button filters
        if (filterMode === 'unassigned' && (t.assigneeIds ?? []).length > 0) return false;
        if (filterMode === 'overdue' && (t.status === 'done' || !t.dueDate || t.dueDate >= today)) return false;
        return true;
    });

    const unassignedCount = tasks.filter(t => t.status !== 'done' && (t.assigneeIds ?? []).length === 0).length;
    const overdueCount = tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today).length;

    const handleTaskClick = (task: Task) => {
        setSelectedTask(task);
        setIsDetailOpen(true);
    };

    const handleTaskUpdated = (updated: Task) => {
        setTasks(prev => prev.map(t => t.id === updated.id ? updated : t));
        setSelectedTask(updated);
    };

    const handleTaskCreated = (created: Task) => {
        setTasks(prev => [created, ...prev]);
    };

    const handleStatusChange = async (taskId: string, status: Task['status']) => {
        const result = await updateTask(taskId, { status, updatedBy: member?.userId });
        if (result.success && result.data) handleTaskUpdated(result.data);
    };

    return (
        <div className="h-full flex flex-col space-y-6 p-6 overflow-y-auto w-full max-w-7xl mx-auto custom-scrollbar">
            <div className="flex items-center justify-between shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">Task List</h2>
                    <p className="text-muted-foreground text-sm">View and manage all tasks across projects</p>
                </div>
                <div className="flex items-center gap-3">
                    {/* View toggle */}
                    <div className="bg-muted p-1 rounded-lg flex items-center gap-1">
                        <button
                            onClick={() => setView('kanban')}
                            title="Kanban view"
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                view === 'kanban' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setView('list')}
                            title="List view"
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                view === 'list' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <List className="h-4 w-4" />
                        </button>
                        <button
                            onClick={() => setView('calendar')}
                            title="Calendar view"
                            className={cn(
                                "p-1.5 rounded-md transition-all",
                                view === 'calendar' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Calendar className="h-4 w-4" />
                        </button>
                    </div>

                    {/* All Tasks filter */}
                    <button
                        onClick={() => setFilterMode('all')}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-colors shadow-sm",
                            filterMode === 'all'
                                ? "bg-red-600 text-white shadow-red-600/20"
                                : "bg-card border border-border hover:bg-muted"
                        )}
                    >
                        All Tasks
                        <span className="ml-1 px-1.5 rounded bg-white/20 text-[10px] font-bold">{tasks.length}</span>
                    </button>

                    {/* Unassigned filter */}
                    <button
                        onClick={() => setFilterMode(filterMode === 'unassigned' ? 'all' : 'unassigned')}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                            filterMode === 'unassigned'
                                ? "bg-orange-500/15 border border-orange-500/30 text-orange-500"
                                : "bg-card border border-border hover:bg-muted"
                        )}
                    >
                        <User className="h-4 w-4" />
                        Unassigned
                        {unassignedCount > 0 && (
                            <span className="ml-1 px-1.5 rounded bg-orange-500/10 text-orange-500 text-[10px] font-bold">{unassignedCount}</span>
                        )}
                    </button>

                    {/* Overdue filter */}
                    <button
                        onClick={() => setFilterMode(filterMode === 'overdue' ? 'all' : 'overdue')}
                        className={cn(
                            "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                            filterMode === 'overdue'
                                ? "bg-red-500/15 border border-red-500/30 text-red-500"
                                : "bg-card border border-border hover:bg-muted"
                        )}
                    >
                        <Filter className="h-4 w-4" />
                        Overdue
                        {overdueCount > 0 && (
                            <span className="ml-1 px-1.5 rounded bg-red-500/10 text-red-500 text-[10px] font-bold">{overdueCount}</span>
                        )}
                    </button>

                    {/* Templates */}
                    <button
                        onClick={() => setIsTemplateLibraryOpen(true)}
                        className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border border-border hover:bg-muted transition-colors"
                    >
                        <LayoutTemplate className="h-4 w-4" />
                        Templates
                    </button>

                    {/* New Task */}
                    <button
                        onClick={() => setIsCreateOpen(true)}
                        className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 transition-colors shadow-lg shadow-red-600/20"
                    >
                        <Plus className="h-4 w-4" />
                        New Task
                    </button>
                </div>
            </div>

            {/* Active client filter chip */}
            {clientFilter && (
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">Filtered by client:</span>
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {clientFilter}
                        <a href="/tasks" className="ml-1 hover:text-primary/70">
                            <X className="h-3 w-3" />
                        </a>
                    </span>
                </div>
            )}

            <div className="flex-1 min-h-0">
                {loading ? (
                    <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                        Loading tasks...
                    </div>
                ) : view === 'calendar' ? (
                    <TaskCalendarView
                        tasks={filteredTasks}
                        onTaskClick={handleTaskClick}
                        onTaskUpdated={handleTaskUpdated}
                        onDateClick={(date) => {
                            setCalendarCreateDate(date);
                            setIsCreateOpen(true);
                        }}
                    />
                ) : view === 'kanban' ? (
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
                                                <TaskCard
                                                    task={task}
                                                    clientId={task.clientId}
                                                    clientName={task.clientName}
                                                    memberMap={memberMap}
                                                />
                                            </div>
                                        ))}
                                    {filteredTasks.filter(t => t.status === col.id).length === 0 && (
                                        <div className="flex-1 flex items-center justify-center py-8 text-muted-foreground/40 text-xs italic">
                                            No tasks
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <TaskListView
                        tasks={filteredTasks}
                        onTaskClick={handleTaskClick}
                    />
                )}
            </div>

            <TaskDetailModal
                task={selectedTask}
                isOpen={isDetailOpen}
                onClose={() => setIsDetailOpen(false)}
                onUpdate={handleTaskUpdated}
                currentUserId={member?.userId}
            />

            <CreateTaskModal
                isOpen={isCreateOpen}
                onClose={() => { setIsCreateOpen(false); setCalendarCreateDate(undefined); setTemplatePrefill(undefined); }}
                onCreated={handleTaskCreated}
                organizationId={organization?.id ?? ''}
                currentUserId={member?.userId}
                defaultDueDate={calendarCreateDate}
                templatePrefill={templatePrefill}
            />

            <TaskTemplateLibrary
                isOpen={isTemplateLibraryOpen}
                onClose={() => setIsTemplateLibraryOpen(false)}
                currentUserId={member?.userId}
                onUseTemplate={(template) => {
                    setTemplatePrefill(template);
                    setIsTemplateLibraryOpen(false);
                    setIsCreateOpen(true);
                }}
            />
        </div>
    );
}
