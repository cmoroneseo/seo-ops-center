'use client';

import { Task, PlannerPriority } from '@/lib/types';
import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchPlannerTasks } from '@/lib/planner/task-sessions';
import { PrioritiesList } from './PrioritiesList';
import { MeetWithFilter, TeamMember } from './MeetWithFilter';
import { TaskDrawer } from './TaskDrawer';
import type { PlannerTaskDropTarget } from '@/lib/planner/layout';

interface PlannerSidebarProps {
    priorities: PlannerPriority[];
    tasks: Task[];
    assignedToMe: Task[];
    todayAndOverdue: Task[];
    backlog: Task[];
    members: TeamMember[];
    selectedMemberIds: string[];
    onToggleMember: (userId: string) => void;
    onAddPriority: (label: string) => void;
    onRemovePriority: (id: string) => void;
    onReorderPriorities: (orderedIds: string[]) => void;
    onTaskClick: (task: Task) => void;
    onTaskDragStart: (task: Task, e: React.PointerEvent) => void;
    activeTaskDropTarget: PlannerTaskDropTarget | null;
    tasksLoading?: boolean;
    tasksError?: boolean;
    onRetryTasks?: () => void;
}

export function PlannerSidebar(props: PlannerSidebarProps) {
    const [query, setQuery] = useState('');
    const [includeCompleted, setIncludeCompleted] = useState(false);
    const searching = Boolean(query.trim()) || includeCompleted;
    const results = useMemo(() => searchPlannerTasks(props.tasks, query, includeCompleted),
        [props.tasks, query, includeCompleted]);
    return (
        <aside className="hidden h-full w-[257px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
            <div className="px-3 py-3 text-base font-semibold">Planner</div>

            <div className="sticky top-0 z-10 border-b border-border/60 bg-card px-3 py-3">
                <label htmlFor="planner-task-search" className="mb-2 block text-sm font-medium">Find tasks</label>
                <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        id="planner-task-search"
                        type="search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search tasks or clients…"
                        className="min-h-9 w-full rounded-md border border-border bg-transparent py-1.5 pl-7 pr-7 text-xs outline-none focus:border-primary [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && <button type="button" aria-label="Clear task search" onClick={() => setQuery('')}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary">
                        <X className="h-3.5 w-3.5" />
                    </button>}
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">Across all clients. Drag to add a new session.</p>
                <label className="mt-2 flex min-h-8 items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={includeCompleted} onChange={e => setIncludeCompleted(e.target.checked)} />
                    Include completed
                </label>
            </div>

            {props.tasksError ? (
                <div role="alert" className="px-3 py-4 text-xs text-muted-foreground">
                    Tasks couldn’t be loaded.
                    <button type="button" onClick={props.onRetryTasks} className="ml-2 rounded text-primary underline focus-visible:ring-2 focus-visible:ring-primary">Retry</button>
                </div>
            ) : props.tasksLoading && props.tasks.length === 0 ? (
                <p role="status" className="px-3 py-4 text-xs text-muted-foreground">Loading tasks…</p>
            ) : searching ? (
                <TaskDrawer title="Search results" tasks={results} defaultOpen showStatus
                    emptyLabel="No matching tasks. Try a task title or client name."
                    onTaskClick={props.onTaskClick} onTaskDragStart={props.onTaskDragStart} />
            ) : <>

                <PrioritiesList
                    priorities={props.priorities}
                    tasks={props.tasks}
                    onAdd={props.onAddPriority}
                    onRemove={props.onRemovePriority}
                    onReorder={props.onReorderPriorities}
                    dropTargetActive={props.activeTaskDropTarget === 'priorities'}
                />

                <TaskDrawer
                    title="Assigned to me"
                    tasks={props.assignedToMe}
                    onTaskClick={props.onTaskClick}
                    onTaskDragStart={props.onTaskDragStart}
                />
                <TaskDrawer
                    title="Today & overdue"
                    tasks={props.todayAndOverdue}
                    onTaskClick={props.onTaskClick}
                    onTaskDragStart={props.onTaskDragStart}
                />
                <TaskDrawer
                    title="Backlog"
                    tasks={props.backlog}
                    defaultOpen
                    taskDropTarget="backlog"
                    dropTargetActive={props.activeTaskDropTarget === 'backlog'}
                    onTaskClick={props.onTaskClick}
                    onTaskDragStart={props.onTaskDragStart}
                />
            </>}

            <details className="border-b border-border/60 px-3 py-3">
                <summary className="cursor-pointer rounded text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary">
                    Calendar filters{props.selectedMemberIds.length > 0 ? ` (${props.selectedMemberIds.length})` : ''}
                </summary>
                <MeetWithFilter members={props.members} selectedIds={props.selectedMemberIds} onToggle={props.onToggleMember} />
            </details>
        </aside>
    );
}
