'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    addDays, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isPast,
    startOfMonth, endOfMonth, addMonths,
} from 'date-fns';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { PlannerEvent, Task, Reminder, PlannerPriority } from '@/lib/types';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import {
    listPlannerPriorities, createPlannerPriority,
    reorderPlannerPriorities, deletePlannerPriority,
} from '@/lib/supabase/planner-priorities';
import { listPlannerEvents, updatePlannerEvent } from '@/lib/supabase/planner-events';
import { getTasks, updateTask } from '@/lib/supabase/tasks';
import { DragCommit } from '@/lib/planner/use-planner-drag';
import { durationMinutes } from '@/lib/planner/layout';
import { listReminders } from '@/lib/supabase/personal-reminders';
import {
    PlannerItem, eventToItem, taskToItem, reminderToItem, TASK_DEFAULT_MINUTES,
} from '@/lib/planner/items';
import { PlannerHeader, PlannerView } from '@/components/planner/PlannerHeader';
import { WeekGrid, PlannerDragHandles } from '@/components/planner/WeekGrid';
import { QuickCreatePopover } from '@/components/planner/QuickCreatePopover';
import { PlannerSidebar } from '@/components/planner/PlannerSidebar';
import { TeamMember } from '@/components/planner/MeetWithFilter';
import { EventDetailPanel } from '@/components/planner/EventDetailPanel';
import { MonthGrid } from '@/components/planner/MonthGrid';
import { PlannerCommandBar } from '@/components/planner/PlannerCommandBar';

export default function PlannerPage() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();

    const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
    const [view, setView] = useState<PlannerView>('week');
    const [events, setEvents] = useState<PlannerEvent[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [quickCreate, setQuickCreate] = useState<{
        anchor: { x: number; y: number };
        startsAt: string;
        endsAt: string;
    } | null>(null);
    const [priorities, setPriorities] = useState<PlannerPriority[]>([]);
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [dragHandles, setDragHandles] = useState<PlannerDragHandles | null>(null);
    const [selected, setSelected] = useState<PlannerItem | null>(null);

    // Visible range. Week spans Sun-Sat, day is a single day, month covers the
    // whole month grid including the leading and trailing partial weeks.
    const range = useMemo(() => {
        if (view === 'day') {
            const start = new Date(anchorDate);
            start.setHours(0, 0, 0, 0);
            return { start, end: addDays(start, 1) };
        }
        if (view === 'month') {
            return {
                start: startOfWeek(startOfMonth(anchorDate)),
                end: addDays(endOfWeek(endOfMonth(anchorDate)), 1),
            };
        }
        return { start: startOfWeek(anchorDate), end: addDays(endOfWeek(anchorDate), 1) };
    }, [anchorDate, view]);

    const load = useCallback(async () => {
        if (!organization?.id || !userId) return;
        setIsLoading(true);
        const [e, t, r] = await Promise.all([
            listPlannerEvents({
                organizationId: organization.id,
                rangeStart: range.start.toISOString(),
                rangeEnd: range.end.toISOString(),
            }),
            getTasks(organization.id, {}),
            listReminders({ organizationId: organization.id, userId }),
        ]);
        setEvents(e);
        setTasks(t);
        setReminders(r);
        setIsLoading(false);
    }, [organization?.id, userId, range.start, range.end]);

    useEffect(() => { void load(); }, [load]);

    // Priorities and the teammate roster do not depend on the visible range.
    useEffect(() => {
        if (!organization?.id || !userId) return;
        void listPlannerPriorities({ organizationId: organization.id, userId }).then(setPriorities);
        void getOrganizationMembers(organization.id).then(rows =>
            setMembers(rows.map(m => ({
                userId: m.userId,
                name: m.user?.fullName || m.user?.email || 'Team member',
            }))));
    }, [organization?.id, userId]);

    // Everything that belongs on the grid, normalized to one shape.
    const items: PlannerItem[] = useMemo(() => {
        const fromTasks = tasks
            .map(taskToItem)
            .filter((i): i is PlannerItem => i !== null);
        return [
            ...events.map(eventToItem),
            ...fromTasks,
            ...reminders.filter(r => r.status === 'pending').map(reminderToItem),
        ];
    }, [events, tasks, reminders]);

    // An empty teammate selection means no filter at all.
    const visibleItems = useMemo(() => {
        if (selectedMemberIds.length === 0) return items;
        return items.filter(i =>
            (i.ownerId && selectedMemberIds.includes(i.ownerId)) ||
            i.attendeeIds.some(id => selectedMemberIds.includes(id)));
    }, [items, selectedMemberIds]);

    // Tasks with no startDate are the backlog.
    const backlog = useMemo(
        () => tasks.filter(t => !t.startDate && t.status !== 'done'),
        [tasks],
    );

    const assignedToMe = useMemo(
        () => tasks.filter(t => (t.assigneeIds ?? []).includes(userId) && t.status !== 'done'),
        [tasks, userId],
    );

    const todayAndOverdue = useMemo(
        () => tasks.filter(t =>
            t.status !== 'done' && t.dueDate &&
            (isToday(new Date(t.dueDate)) || isPast(new Date(t.dueDate)))),
        [tasks],
    );

    const days = useMemo(
        () => (view === 'day'
            ? [range.start]
            : eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) })),
        [range.start, range.end, view],
    );

    const handlePrev = () => setAnchorDate(d =>
        view === 'month' ? addMonths(d, -1) : addDays(d, view === 'day' ? -1 : -7));
    const handleNext = () => setAnchorDate(d =>
        view === 'month' ? addMonths(d, 1) : addDays(d, view === 'day' ? 1 : 7));
    const handleToday = () => setAnchorDate(new Date());

    /**
     * Optimistic: move it locally first so the card lands under the cursor with
     * no round-trip, then persist. A failed write reloads from the server rather
     * than leaving the UI lying.
     */
    const handleCommit = useCallback(async (commit: DragCommit) => {
        const rawId = commit.itemId.split(':')[1];
        if (!rawId) return;

        if (commit.source === 'event') {
            setEvents(prev => prev.map(e =>
                e.id === rawId ? { ...e, startsAt: commit.startsAt, endsAt: commit.endsAt } : e));
            const saved = await updatePlannerEvent(rawId, {
                startsAt: commit.startsAt,
                endsAt: commit.endsAt,
            });
            if (!saved) {
                console.error('[planner] failed to move event, reloading');
                void load();
            }
            return;
        }

        if (commit.source === 'task') {
            const hours = durationMinutes(commit.startsAt, commit.endsAt) / 60;
            setTasks(prev => prev.map(t =>
                t.id === rawId ? { ...t, startDate: commit.startsAt, estimatedHours: hours } : t));
            const res = await updateTask(rawId, {
                startDate: commit.startsAt,
                estimatedHours: hours,
            });
            if (!res.success) {
                console.error('[planner] failed to move task:', res.error);
                void load();
            }
        }
    }, [load]);

    const handleCreate = useCallback((dayIndex: number, startMin: number, endMin: number) => {
        const day = days[dayIndex];
        if (!day) return;
        const at = (minutes: number) => {
            const d = new Date(day);
            d.setHours(0, 0, 0, 0);
            d.setMinutes(minutes);
            return d.toISOString();
        };
        setQuickCreate({
            // The popover is 340px wide; keep it fully on screen.
            anchor: { x: Math.min(window.innerWidth - 360, window.innerWidth / 2), y: 160 },
            startsAt: at(startMin),
            endsAt: at(endMin),
        });
    }, [days]);

    const handleAddPriority = useCallback(async (label: string) => {
        if (!organization?.id || !userId) return;
        const created = await createPlannerPriority({
            organizationId: organization.id, userId, label, sortOrder: priorities.length,
        });
        if (created) setPriorities(prev => [...prev, created]);
    }, [organization?.id, userId, priorities.length]);

    const handleRemovePriority = useCallback(async (id: string) => {
        setPriorities(prev => prev.filter(p => p.id !== id));
        await deletePlannerPriority(id);
    }, []);

    const handleReorderPriorities = useCallback(async (orderedIds: string[]) => {
        setPriorities(prev => orderedIds
            .map((id, i) => {
                const p = prev.find(x => x.id === id);
                return p ? { ...p, sortOrder: i } : null;
            })
            .filter((p): p is PlannerPriority => p !== null));
        await reorderPlannerPriorities(orderedIds.map((id, i) => ({ id, sortOrder: i })));
    }, []);

    const handleTaskDragStart = useCallback((task: Task, e: React.PointerEvent) => {
        const minutes = task.estimatedHours
            ? Math.round(task.estimatedHours * 60)
            : TASK_DEFAULT_MINUTES;
        dragHandles?.beginSchedule(task.id, task.title, minutes, e);
    }, [dragHandles]);

    return (
        <div className="flex h-full min-h-0 w-full">
            <PlannerSidebar
                priorities={priorities}
                tasks={tasks}
                assignedToMe={assignedToMe}
                todayAndOverdue={todayAndOverdue}
                backlog={backlog}
                members={members}
                selectedMemberIds={selectedMemberIds}
                onToggleMember={id => setSelectedMemberIds(prev =>
                    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
                onAddPriority={handleAddPriority}
                onRemovePriority={handleRemovePriority}
                onReorderPriorities={handleReorderPriorities}
                onTaskDragStart={handleTaskDragStart}
            />

            <div className="flex flex-1 min-w-0 flex-col">
                <PlannerHeader
                    anchorDate={anchorDate}
                    view={view}
                    onPrev={handlePrev}
                    onNext={handleNext}
                    onToday={handleToday}
                    onViewChange={setView}
                />
                {isLoading && (
                    <div className="h-0.5 w-full overflow-hidden bg-primary/10">
                        <div className="h-full w-1/3 animate-pulse bg-primary" />
                    </div>
                )}

                {view === 'month' ? (
                    <MonthGrid
                        anchorDate={anchorDate}
                        items={visibleItems}
                        onItemClick={setSelected}
                        onDayClick={day => { setAnchorDate(day); setView('day'); }}
                    />
                ) : (
                    <WeekGrid
                        days={days}
                        items={visibleItems}
                        onItemClick={setSelected}
                        onCommit={handleCommit}
                        onCreate={handleCreate}
                        onDragHandlesReady={setDragHandles}
                    />
                )}
            </div>

            {selected && (
                <EventDetailPanel
                    item={selected}
                    members={members}
                    onClose={() => setSelected(null)}
                    onChanged={() => { setSelected(null); void load(); }}
                    onDeleted={() => { setSelected(null); void load(); }}
                />
            )}

            <PlannerCommandBar
                items={items}
                members={members}
                onSelectItem={item => { setAnchorDate(new Date(item.startsAt)); setSelected(item); }}
                onSelectMember={id => setSelectedMemberIds(prev =>
                    prev.includes(id) ? prev : [...prev, id])}
                onGoToToday={handleToday}
                onViewChange={setView}
            />

            {quickCreate && organization?.id && userId && (
                <QuickCreatePopover
                    organizationId={organization.id}
                    userId={userId}
                    anchor={quickCreate.anchor}
                    draft={{ startsAt: quickCreate.startsAt, endsAt: quickCreate.endsAt }}
                    onClose={() => setQuickCreate(null)}
                    onCreated={() => void load()}
                />
            )}
        </div>
    );
}
