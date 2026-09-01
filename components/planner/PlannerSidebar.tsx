'use client';

import { Task, PlannerPriority } from '@/lib/types';
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
}

export function PlannerSidebar(props: PlannerSidebarProps) {
    return (
        <aside className="hidden h-full w-[257px] shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
            <div className="px-3 py-3 text-base font-semibold">Planner</div>

            <PrioritiesList
                priorities={props.priorities}
                tasks={props.tasks}
                onAdd={props.onAddPriority}
                onRemove={props.onRemovePriority}
                onReorder={props.onReorderPriorities}
                dropTargetActive={props.activeTaskDropTarget === 'priorities'}
            />

            <MeetWithFilter
                members={props.members}
                selectedIds={props.selectedMemberIds}
                onToggle={props.onToggleMember}
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
        </aside>
    );
}
