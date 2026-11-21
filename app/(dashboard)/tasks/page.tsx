'use client';

import { useState, useEffect } from 'react';
import { Plus, LayoutGrid, List, Calendar, X, LayoutTemplate } from 'lucide-react';
import { TaskCard } from '@/components/tasks/TaskCard';
import { TaskListView } from '@/components/tasks/TaskListView';
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView';
import { TaskDetailModal } from '@/components/tasks/TaskDetailModal';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { TaskTemplateLibrary } from '@/components/tasks/TaskTemplateLibrary';
import { Task, TaskTemplate } from '@/lib/types';
import { mergeSavedTask } from '@/lib/tasks/merge-saved-task';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { MyTasksQueue } from '@/components/tasks/MyTasksQueue';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { filterTasks, groupMyTasks, localDateKey, myTasksSubtitle, resolveTaskFilter, taskFilterLabels, type TaskFilter } from '@/lib/tasks/my-tasks';
import { useSearchParams } from 'next/navigation';
import { useOrganization } from '@/components/providers/organization-provider';
import { getTasks } from '@/lib/supabase/tasks';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { reconcileTaskQuerySelection } from '@/lib/planner/task-selection';

const columns = [
    { id: 'todo', title: 'To Do' },
    { id: 'in_progress', title: 'In Progress' },
    { id: 'done', title: 'Done' },
] as const;

export default function TasksPage() {
    const searchParams = useSearchParams();
    const clientFilter = searchParams.get('client');
    const taskQuery = searchParams.get('task');
    const clearClientParams = new URLSearchParams(searchParams.toString());
    clearClientParams.delete('client');
    const { organization, isLoading: organizationLoading } = useOrganization();
    const { userId, isLoading: memberLoading } = useCurrentMember();
    const [view, setView] = useState<'kanban' | 'list' | 'calendar'>('list');
    const [calendarCreateDate, setCalendarCreateDate] = useState<string | undefined>(undefined);
    const [isTemplateLibraryOpen, setIsTemplateLibraryOpen] = useState(false);
    const [templatePrefill, setTemplatePrefill] = useState<TaskTemplate | undefined>(undefined);
    const [selectedTask, setSelectedTask] = useState<Task | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadedTasksOrganizationId, setLoadedTasksOrganizationId] = useState<string | null>(null);
    const filterMode = resolveTaskFilter(searchParams.get('filter'), searchParams.has('client'));
    const [memberMap, setMemberMap] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!organization?.id) return;
        getOrganizationMembers(organization.id).then(members => {
            const map: Record<string, string> = {};
            members.forEach(m => { map[m.userId] = m.user?.fullName || m.user?.email || 'Team'; });
            setMemberMap(map);
        }).catch(() => {});
    }, [organization?.id]);

    useEffect(() => {
        const organizationId = organization?.id;
        let cancelled = false;
        if (!organizationId) {
            setTasks([]);
            setLoadedTasksOrganizationId(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        void getTasks(organizationId).then(data => {
            if (cancelled) return;
            setTasks(data);
            setLoadedTasksOrganizationId(organizationId);
            setLoading(false);
        });
        return () => { cancelled = true; };
    }, [organization?.id]);

    useEffect(() => {
        const context = {
            tasks,
            taskId: taskQuery,
            organizationId: organization?.id ?? null,
            loadedOrganizationId: loadedTasksOrganizationId,
            loading,
        };
        setSelectedTask(current => reconcileTaskQuerySelection({
            ...context,
            selectedTask: current,
            isDetailOpen: false,
        }).selectedTask);
        setIsDetailOpen(current => reconcileTaskQuerySelection({
            ...context,
            selectedTask,
            isDetailOpen: current,
        }).isDetailOpen);
    }, [taskQuery, tasks, organization?.id, loadedTasksOrganizationId, loading, selectedTask]);

    const today = localDateKey();
    const isLoading = organizationLoading || loading ||
        loadedTasksOrganizationId !== (organization?.id ?? null) ||
        (filterMode === 'mine' && memberLoading);
    const scopedTasks = isLoading ? [] : tasks.filter(task =>
        !clientFilter || task.clientId === clientFilter ||
        task.clientName?.toLowerCase().includes(clientFilter.toLowerCase())
    );
    const filteredTasks = filterTasks(scopedTasks, filterMode, today, userId);
    const groups = groupMyTasks(filterMode === 'mine' ? filteredTasks : [], today);

    const clearTaskQuery = () => {
        if (!taskQuery) return;
        const params = new URLSearchParams(searchParams.toString());
        params.delete('task');
        window.history.replaceState(null, '', params.size ? `/tasks?${params}` : '/tasks');
    };

    const handleTaskClick = (task: Task) => {
        clearTaskQuery();
        setSelectedTask(task);
        setIsDetailOpen(true);
    };

    const handleTaskUpdated = (updated: Task) => {
        setTasks(prev => prev.map(t => t.id === updated.id ? mergeSavedTask(t, updated) : t));
        setSelectedTask(current => current && current.id === updated.id ? mergeSavedTask(current, updated) : updated);
    };

    const handleTaskCreated = (created: Task) => {
        setTasks(prev => [created, ...prev]);
    };

    return (
        <div className="h-full flex flex-col space-y-6 p-6 overflow-y-auto w-full max-w-7xl mx-auto custom-scrollbar">
            <div className="flex flex-wrap items-center justify-between gap-3 shrink-0">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight text-foreground">{filterMode === 'mine' ? 'My Tasks' : 'Task List'}</h2>
                    <p className="text-muted-foreground text-sm">{filterMode === 'mine' ? (isLoading ? 'Loading tasks…' : myTasksSubtitle(groups)) : 'View and manage team tasks.'}</p>
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

            <nav aria-label="Task filters" className="flex shrink-0 flex-wrap gap-2">
                {(Object.keys(taskFilterLabels) as TaskFilter[]).map(filter => {
                    const params = new URLSearchParams(searchParams.toString());
                    params.set('filter', filter);
                    return (
                        <Link key={filter} href={`/tasks?${params}`} scroll={false}
                            aria-current={filterMode === filter ? 'true' : undefined}
                            className={cn("rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                                filterMode === filter ? "border-primary bg-primary/10 text-primary" : "border-border bg-card hover:bg-muted")}
                        >
                            {taskFilterLabels[filter]}
                        </Link>
                    );
                })}
            </nav>

            {/* Active client filter chip */}
            {clientFilter && (
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">Filtered by client:</span>
                    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        {clientFilter}
                        <Link href={clearClientParams.size ? `/tasks?${clearClientParams}` : '/tasks'} aria-label="Clear client filter" className="ml-1 hover:text-primary/70">
                            <X className="h-3 w-3" />
                        </Link>
                    </span>
                </div>
            )}

            <div className="flex-1 min-h-0">
                {isLoading ? (
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
                ) : filterMode === 'mine' ? (
                    <MyTasksQueue groups={groups} onTaskClick={handleTaskClick} />
                ) : (
                    <TaskListView
                        tasks={filteredTasks}
                        onTaskClick={handleTaskClick}
                        onTaskUpdated={handleTaskUpdated}
                    />
                )}
            </div>

            <TaskDetailModal
                task={selectedTask}
                isOpen={isDetailOpen && selectedTask?.organizationId === organization?.id}
                onClose={() => { clearTaskQuery(); setIsDetailOpen(false); }}
                onUpdate={handleTaskUpdated}
                onDelete={(id) => setTasks(prev => prev.filter(t => t.id !== id))}
                currentUserId={userId}
            />

            <CreateTaskModal
                isOpen={isCreateOpen}
                onClose={() => { setIsCreateOpen(false); setCalendarCreateDate(undefined); setTemplatePrefill(undefined); }}
                onCreated={handleTaskCreated}
                organizationId={organization?.id ?? ''}
                currentUserId={userId}
                defaultDueDate={calendarCreateDate}
                templatePrefill={templatePrefill}
            />

            <TaskTemplateLibrary
                isOpen={isTemplateLibraryOpen}
                onClose={() => setIsTemplateLibraryOpen(false)}
                currentUserId={userId}
                onUseTemplate={(template) => {
                    setTemplatePrefill(template);
                    setIsTemplateLibraryOpen(false);
                    setIsCreateOpen(true);
                }}
            />
        </div>
    );
}
