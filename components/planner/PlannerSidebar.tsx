'use client';

import { Task, PlannerPriority } from '@/lib/types';
import { PrioritiesList } from './PrioritiesList';
import { MeetWithFilter, TeamMember } from './MeetWithFilter';
import { TaskDrawer } from './TaskDrawer';

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
    onTaskDragStart: (task: Task, e: React.PointerEvent) => void;
}

export function PlannerSidebar(props: PlannerSidebarProps) {
    return (
        <aside className="hidden h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
            <div className="px-3 py-3 text-base font-semibold">Planner</div>

            <PrioritiesList
                priorities={props.priorities}
                tasks={props.tasks}
                onAdd={props.onAddPriority}
                onRemove={props.onRemovePriority}
                onReorder={props.onReorderPriorities}
            />

            <MeetWithFilter
                members={props.members}
                selectedIds={props.selectedMemberIds}
                onToggle={props.onToggleMember}
            />

            <TaskDrawer title="Assigned to me" tasks={props.assignedToMe} />
            <TaskDrawer title="Today & overdue" tasks={props.todayAndOverdue} />
            <TaskDrawer
                title="Backlog"
                tasks={props.backlog}
                defaultOpen
                onTaskDragStart={props.onTaskDragStart}
            />
        </aside>
    );
}
