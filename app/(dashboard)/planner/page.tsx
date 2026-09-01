'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
    addDays, startOfWeek, endOfWeek, eachDayOfInterval, isToday, isPast, isWeekend,
    addMonths, startOfDay,
} from 'date-fns';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import {
    PlannerEvent, Task, Reminder, PlannerPriority, PlannerEventKind, TimerAttempt,
} from '@/lib/types';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import {
    listPlannerPriorities, createPlannerPriority,
    reorderPlannerPriorities, deletePlannerPriority, unschedulePlannerTask,
} from '@/lib/supabase/planner-priorities';
import { listPlannerEvents, updatePlannerEvent } from '@/lib/supabase/planner-events';
import { getTasks, updateTask } from '@/lib/supabase/tasks';
import { DragCommit } from '@/lib/planner/use-planner-drag';
import { durationMinutes } from '@/lib/planner/layout';
import type { PlannerTaskDropTarget } from '@/lib/planner/layout';
import { listReminders } from '@/lib/supabase/personal-reminders';
import { getTimerAttemptsForRange } from '@/lib/supabase/time-logs';
import {
    PlannerItem, eventToItem, taskToItem, reminderToItem, overdueTaskToItem, taskBlockMinutes,
    taskToDetailItem,
    unscheduleTask,
} from '@/lib/planner/items';
import { planTaskDrop } from '@/lib/planner/priority-updates';
import { createLatestRequestGate } from '@/lib/planner/latest-request';
import {
    actualAttemptToItems, resolvePlannerSelection, shouldRenderForecast,
    type PlannerTimerAction,
} from '@/lib/planner/actual-items';
import { PlannerHeader, PlannerView } from '@/components/planner/PlannerHeader';
import { WeekGrid, PlannerDragHandles } from '@/components/planner/WeekGrid';
import { QuickCreatePopover, FullTaskDraft } from '@/components/planner/QuickCreatePopover';
import { CreateTaskModal } from '@/components/tasks/CreateTaskModal';
import { useClients } from '@/lib/hooks/use-clients';
import { PlannerSidebar } from '@/components/planner/PlannerSidebar';
import { TeamMember } from '@/components/planner/MeetWithFilter';
import { EventDetailPanel } from '@/components/planner/EventDetailPanel';
import { MonthGrid } from '@/components/planner/MonthGrid';
import { PlannerCommandBar } from '@/components/planner/PlannerCommandBar';
import {
    PlannerPreferences, DEFAULT_PREFERENCES, loadPreferences, recentProjectsForOrganization,
    savePreferences, withRecentProject,
} from '@/lib/planner/preferences';
import { localDateForInstant, parseLocalDate } from '@/lib/planner/local-date';
import { buildMonthDays } from '@/lib/planner/month-range';
import { clampOverlayAnchor } from '@/lib/planner/responsive';
import { StopConfirmSheet } from '@/components/timer/StopConfirmSheet';
import { eventToTaskDraft, type EventTaskDraft } from '@/lib/planner/event-to-task';

export default function PlannerPage() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const {
        runningTimer, pausedTimers, startTask, pause, resume, beginStop, getAttemptById,
    } = useTimer();
    const plannerSurfaceRef = useRef<HTMLDivElement>(null);
    const workRequestGateRef = useRef(createLatestRequestGate());
    const priorityRequestGateRef = useRef(createLatestRequestGate());

    const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
    const [view, setView] = useState<PlannerView>('week');

    // A 7-column week grid is unusable on a phone. Default to Day view below the
    // lg breakpoint (matches the sidebar/command-bar gating) on first mount only,
    // so a deliberate switch to Week on a small screen is respected afterward.
    useEffect(() => {
        if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
            setView('day');
        }
    }, []);
    const [events, setEvents] = useState<PlannerEvent[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [attempts, setAttempts] = useState<TimerAttempt[]>([]);
    const [clockNow, setClockNow] = useState(() => Date.now());
    const [isLoading, setIsLoading] = useState(true);
    const [quickCreate, setQuickCreate] = useState<{
        anchor: { x: number; y: number };
        startsAt: string;
        endsAt: string;
        // Mirrors the popover's selected tab so the block on the grid recolours.
        kind: PlannerEventKind;
        label: string;
    } | null>(null);
    const [priorities, setPriorities] = useState<PlannerPriority[]>([]);
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [dragHandles, setDragHandles] = useState<PlannerDragHandles | null>(null);
    const [activeTaskDropTarget, setActiveTaskDropTarget] = useState<PlannerTaskDropTarget | null>(null);
    const [selected, setSelected] = useState<PlannerItem | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [announcement, setAnnouncement] = useState('');
    const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
    // Set when the quick-create popover hands off to the full task editor.
    const [fullTaskDraft, setFullTaskDraft] = useState<FullTaskDraft | null>(null);
    const [eventTaskDraft, setEventTaskDraft] = useState<EventTaskDraft | null>(null);
    const { clients } = useClients({ statuses: ['Active'] });
    // Read on mount rather than in useState so server and client render alike.
    const [prefs, setPrefs] = useState<PlannerPreferences>(DEFAULT_PREFERENCES);
    useEffect(() => { setPrefs(loadPreferences()); }, []);

    const updatePrefs = useCallback((next: PlannerPreferences) => {
        setPrefs(next);
        savePreferences(next);
    }, []);

    const monthDays = useMemo(
        () => buildMonthDays(anchorDate, prefs.weekStartsOn),
        [anchorDate, prefs.weekStartsOn],
    );

    // Errors are transient: show, then get out of the way.
    useEffect(() => {
        if (!error) return;
        const id = setTimeout(() => setError(null), 6000);
        return () => clearTimeout(id);
    }, [error]);

    // Visible range. Week spans Sun-Sat, day is a single day, month covers the
    // whole month grid including the leading and trailing partial weeks.
    const range = useMemo(() => {
        const opts = { weekStartsOn: prefs.weekStartsOn } as const;
        if (view === 'day') {
            const start = startOfDay(anchorDate);
            return { start, end: addDays(start, 1) };
        }
        if (view === 'month') {
            return {
                start: monthDays[0],
                end: addDays(monthDays[monthDays.length - 1], 1),
            };
        }
        return {
            start: startOfWeek(anchorDate, opts),
            end: addDays(endOfWeek(anchorDate, opts), 1),
        };
    }, [anchorDate, view, prefs.weekStartsOn, monthDays]);

    /** Events are range-scoped independently from task/timer work. */
    const loadEvents = useCallback(async () => {
        if (!organization?.id) return;
        setIsLoading(true);
        setEvents(await listPlannerEvents({
            organizationId: organization.id,
            rangeStart: range.start.toISOString(),
            rangeEnd: range.end.toISOString(),
        }));
        setIsLoading(false);
    }, [organization?.id, range.start, range.end]);

    const loadWork = useCallback(async () => {
        if (!organization?.id || !userId) return;
        const mayApply = workRequestGateRef.current.start();
        const [t, r, a] = await Promise.all([
            getTasks(organization.id, {}),
            listReminders({ organizationId: organization.id, userId }),
            getTimerAttemptsForRange(organization.id, range.start, range.end),
        ]);
        if (!mayApply()) return;
        setTasks(t);
        setReminders(r);
        setAttempts(a);
        setClockNow(Date.now());
    }, [organization?.id, range.end, range.start, userId]);

    /** Everything — used after a write whose effect could span both. */
    const reloadAll = useCallback(async () => {
        await Promise.all([loadEvents(), loadWork()]);
    }, [loadEvents, loadWork]);

    useEffect(() => { void loadEvents(); }, [loadEvents]);
    useEffect(() => { void loadWork(); }, [loadWork]);

    // Timer transitions update the attempt and consume a task forecast in
    // one workflow. Coalesce the provider's paired events and reload both facts
    // together so the planner never briefly duplicates or loses the card.
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const reload = () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { void loadWork(); }, 0);
        };
        window.addEventListener('planner:data-changed', reload);
        window.addEventListener('timer:data-changed', reload);
        return () => {
            if (timer) clearTimeout(timer);
            window.removeEventListener('planner:data-changed', reload);
            window.removeEventListener('timer:data-changed', reload);
        };
    }, [loadWork]);

    const hasRunningActual = attempts.some(attempt => (
        attempt.status === 'in_progress'
        && attempt.segments.some(segment => segment.endedAt === undefined)
    ));
    useEffect(() => {
        if (!hasRunningActual) return;
        const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [hasRunningActual]);

    const loadPriorities = useCallback(async () => {
        if (!organization?.id || !userId) return;
        const mayApply = priorityRequestGateRef.current.start();
        const loaded = await listPlannerPriorities({ organizationId: organization.id, userId });
        if (mayApply()) setPriorities(loaded);
    }, [organization?.id, userId]);

    // Priorities and the teammate roster do not depend on the visible range.
    useEffect(() => {
        if (!organization?.id || !userId) return;
        void loadPriorities();
        void getOrganizationMembers(organization.id).then(rows =>
            setMembers(rows.map(m => ({
                userId: m.userId,
                name: m.user?.fullName || m.user?.email || 'Team member',
            }))));
    }, [organization?.id, userId, loadPriorities]);

    // Everything that belongs on the grid, normalized to one shape.
    const items: PlannerItem[] = useMemo(() => {
        const fromTasks = tasks
            .filter(task => shouldRenderForecast(task, attempts))
            .map(taskToItem)
            .filter((i): i is PlannerItem => i !== null);
        const actual = attempts.flatMap(attempt => (
            actualAttemptToItems(attempt, new Date(clockNow))
        ));

        // Overdue work that isn't scheduled anywhere would otherwise be invisible
        // on the grid. Surfaced as all-day chips on today so it stays in view.
        const overdue = prefs.rollOverdueIntoToday
            ? tasks
                .filter(t => {
                    if (t.status === 'done' || t.startDate || !t.dueDate) return false;
                    const due = parseLocalDate(t.dueDate) ?? new Date(t.dueDate);
                    return isPast(startOfDay(due)) && !isToday(due);
                })
                .map(t => overdueTaskToItem(t))
            : [];

        return [
            ...events.map(eventToItem),
            ...fromTasks,
            ...actual,
            ...overdue,
            ...reminders.filter(r => r.status === 'pending').map(reminderToItem),
        ];
    }, [attempts, clockNow, events, tasks, reminders, prefs.rollOverdueIntoToday]);

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
        () => tasks.filter(t => {
            if (t.status === 'done' || !t.dueDate) return false;
            const due = parseLocalDate(t.dueDate) ?? new Date(t.dueDate);
            return isToday(due) || isPast(due);
        }),
        [tasks],
    );

    const days = useMemo(() => {
        // Day view always shows the day you asked for, even a Saturday.
        if (view === 'day') return [range.start];
        const all = eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) });
        return prefs.showWeekends ? all : all.filter(d => !isWeekend(d));
    }, [range.start, range.end, view, prefs.showWeekends]);

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
                setError("Couldn't save that move — it's been put back.");
                void loadEvents();
            }
            return;
        }

        if (commit.source === 'task') {
            // scheduled_minutes, never estimated_hours: blocking an hour for a
            // three-hour task must not rewrite the estimate (migration 028).
            const minutes = durationMinutes(commit.startsAt, commit.endsAt);
            setTasks(prev => prev.map(t =>
                t.id === rawId ? { ...t, startDate: commit.startsAt, scheduledMinutes: minutes } : t));
            const res = await updateTask(rawId, {
                startDate: commit.startsAt,
                scheduledMinutes: minutes,
            });
            if (!res.success) {
                setError("Couldn't save that move — it's been put back.");
                void loadWork();
            }
        }
    }, [loadEvents, loadWork]);

    const handleUnschedule = useCallback(async (
        itemId: string,
        target: PlannerTaskDropTarget = 'backlog',
    ): Promise<boolean> => {
        const rawId = itemId.includes(':') ? itemId.split(':')[1] : itemId;
        const existing = tasks.find(task => task.id === rawId);
        if (!rawId || !existing) return false;
        const plan = planTaskDrop(target, rawId, priorities);
        const optimisticPriorityId = `optimistic:${rawId}`;

        setTasks(prev => prev.map(task => task.id === rawId ? unscheduleTask(task) : task));
        if (plan.addPriority && organization?.id && userId) {
            setPriorities(prev => [...prev, {
                id: optimisticPriorityId,
                organizationId: organization.id,
                userId,
                taskId: rawId,
                sortOrder: prev.length,
                createdAt: new Date().toISOString(),
            }]);
        }

        const succeeded = await unschedulePlannerTask({
            taskId: rawId,
            // The database independently prevents duplicates, even if this
            // browser's priority list is stale.
            addToPriorities: target === 'priorities',
        });
        if (!succeeded) {
            setError("Couldn't remove that task from the calendar — it's been restored.");
            setTasks(prev => prev.map(task => task.id === rawId ? existing : task));
            setPriorities(prev => prev.filter(priority => priority.id !== optimisticPriorityId));
            await Promise.all([loadWork(), loadPriorities()]);
            return false;
        }

        // Replace optimistic state with the authoritative transaction result.
        await Promise.all([loadWork(), loadPriorities()]);
        setAnnouncement(target === 'priorities'
            ? `${existing.title} moved from the calendar to Priorities.`
            : `${existing.title} moved from the calendar to Backlog.`);
        return true;
    }, [loadPriorities, loadWork, organization?.id, priorities, tasks, userId]);

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
            anchor: {
                x: clampOverlayAnchor(window.innerWidth / 2, window.innerWidth),
                y: clampOverlayAnchor(160, window.innerHeight, 520),
            },
            startsAt: at(startMin),
            endsAt: at(endMin),
            kind: 'event',
            label: 'New event',
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
        const deleted = await deletePlannerPriority(id);
        if (!deleted) {
            setError("Couldn't remove that priority — it's been restored.");
            void loadPriorities();
        }
    }, [loadPriorities]);

    const handleReorderPriorities = useCallback(async (orderedIds: string[]) => {
        setPriorities(prev => orderedIds
            .map((id, i) => {
                const p = prev.find(x => x.id === id);
                return p ? { ...p, sortOrder: i } : null;
            })
            .filter((p): p is PlannerPriority => p !== null));
        const reordered = await reorderPlannerPriorities(
            orderedIds.map((id, i) => ({ id, sortOrder: i })),
        );
        if (!reordered) {
            setError("Couldn't save that priority order — it's been restored.");
            void loadPriorities();
        }
    }, [loadPriorities]);

    const handleTaskDragStart = useCallback((task: Task, e: React.PointerEvent) => {
        // Same rule the grid uses to size a block — one definition, in items.ts.
        dragHandles?.beginSchedule(task.id, task.title, taskBlockMinutes(task), e);
    }, [dragHandles]);

    const handleTaskClick = useCallback((task: Task) => {
        // A completed pointer drag emits a synthetic click; only a true click
        // should open details after every drawer gains scheduling affordances.
        if (dragHandles?.consumeDragClick()) return;
        setSelected(taskToDetailItem(task));
    }, [dragHandles]);

    const announceTimer = useCallback((message: string) => {
        setAnnouncement('');
        window.requestAnimationFrame(() => setAnnouncement(message));
    }, []);

    const canControlTimer = useCallback((item: PlannerItem) => {
        if (item.source === 'actual_time') {
            return Boolean(item.attemptId && getAttemptById(item.attemptId));
        }
        if (item.source !== 'task') return false;
        const task = item.raw as Task;
        const assigned = task.assigneeIds ?? [];
        const alreadyTracking = [runningTimer, ...pausedTimers].some(attempt => (
            attempt?.taskId === task.id
        ));
        return !alreadyTracking
            && task.status !== 'done'
            && (assigned.length === 0 || assigned.includes(userId));
    }, [getAttemptById, pausedTimers, runningTimer, userId]);

    const handleTimerAction = useCallback(async (
        action: PlannerTimerAction,
        item: PlannerItem,
    ) => {
        try {
            if (action === 'start') {
                if (item.source !== 'task') return;
                const task = item.raw as Task;
                if ([runningTimer, ...pausedTimers].some(attempt => attempt?.taskId === task.id)) return;
                const changed = await startTask({
                    taskId: task.id,
                    taskTitle: task.title,
                    clientId: task.clientId,
                    clientName: task.clientName ?? 'Internal work',
                });
                if (changed) announceTimer(`Timer started for ${task.title}.`);
                return;
            }

            const attempt = item.attemptId ? getAttemptById(item.attemptId) : null;
            if (!attempt) throw new Error('Timer state changed. Refresh and try again.');
            const title = attempt.taskTitle ?? item.title;
            if (action === 'pause') {
                if (!attempt.segments.some(segment => segment.endedAt === undefined)) return;
                await pause(attempt);
                announceTimer(`Timer paused for ${title}.`);
                return;
            }
            if (action === 'resume') {
                if (attempt.segments.some(segment => segment.endedAt === undefined)) return;
                const changed = await resume(attempt);
                if (changed) announceTimer(`Timer resumed for ${title}.`);
                return;
            }
            if (attempt.reviewingAt) {
                setReviewAttemptId(attempt.id);
                return;
            }
            await beginStop(attempt);
            setReviewAttemptId(attempt.id);
            announceTimer(`Timer stopped for ${title}. Review the time entry.`);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : 'Unable to update the timer.';
            setError(message);
            announceTimer(`Timer update failed. ${message}`);
        }
    }, [
        announceTimer, beginStop, getAttemptById, pause, pausedTimers, resume,
        runningTimer, startTask,
    ]);

    const selectedItem = useMemo(() => {
        if (!selected) return null;
        if (selected.source === 'task') {
            const task = selected.raw as Task;
            const activeAttempt = attempts.find(attempt => (
                attempt.taskId === task.id && attempt.status === 'in_progress'
            ));
            if (activeAttempt) {
                return actualAttemptToItems(activeAttempt, new Date(clockNow))[0] ?? selected;
            }
        }
        return resolvePlannerSelection(selected, items);
    }, [attempts, clockNow, items, selected]);

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
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
                onTaskClick={handleTaskClick}
                onTaskDragStart={handleTaskDragStart}
                activeTaskDropTarget={activeTaskDropTarget}
            />

            <div
                ref={plannerSurfaceRef}
                role="region"
                aria-label="Planner calendar"
                tabIndex={-1}
                className="flex flex-1 min-w-0 flex-col"
            >
                <PlannerHeader
                    anchorDate={anchorDate}
                    view={view}
                    onPrev={handlePrev}
                    onNext={handleNext}
                    onToday={handleToday}
                    onViewChange={setView}
                    prefs={prefs}
                    onPrefsChange={updatePrefs}
                />
                {isLoading && (
                    <div className="h-0.5 w-full overflow-hidden bg-primary/10">
                        <div className="h-full w-1/3 animate-pulse bg-primary" />
                    </div>
                )}

                {view === 'month' ? (
                    <MonthGrid
                        key={`${anchorDate.getFullYear()}-${anchorDate.getMonth()}`}
                        anchorDate={anchorDate}
                        days={monthDays}
                        items={visibleItems}
                        onItemClick={setSelected}
                        onTimerAction={handleTimerAction}
                        canControlTimer={canControlTimer}
                        onDayClick={day => { setAnchorDate(day); setView('day'); }}
                    />
                ) : (
                    <WeekGrid
                        days={days}
                        items={visibleItems}
                        startHour={prefs.dayStartHour}
                        endHour={prefs.dayEndHour}
                        workStartHour={prefs.workDayStartHour}
                        workEndHour={prefs.workDayEndHour}
                        onItemClick={setSelected}
                        onTimerAction={handleTimerAction}
                        canControlTimer={canControlTimer}
                        onCommit={handleCommit}
                        onCreate={handleCreate}
                        onUnschedule={handleUnschedule}
                        onDropTargetChange={setActiveTaskDropTarget}
                        pendingBlock={quickCreate && {
                            startsAt: quickCreate.startsAt,
                            endsAt: quickCreate.endsAt,
                            label: quickCreate.label,
                            kind: quickCreate.kind,
                        }}
                        onDragHandlesReady={setDragHandles}
                    />
                )}
            </div>

            {selectedItem && (
                <EventDetailPanel
                    key={`${organization?.id ?? 'missing-organization'}:${selectedItem.id}`}
                    item={selectedItem}
                    members={members}
                    organizationId={organization?.id}
                    userId={userId}
                    recentProjects={recentProjectsForOrganization(prefs, organization?.id)}
                    onProjectUsed={p => {
                        if (organization?.id) {
                            updatePrefs(withRecentProject(prefs, organization.id, p));
                        }
                    }}
                    onClose={() => setSelected(null)}
                    onChanged={() => { setSelected(null); void reloadAll(); }}
                    onDeleted={() => { setSelected(null); void reloadAll(); }}
                    restoreFocusRef={plannerSurfaceRef}
                    onTimerAction={handleTimerAction}
                    canControlTimer={canControlTimer(selectedItem)}
                    onUnscheduleTask={taskId => handleUnschedule(taskId, 'backlog')}
                    onCreateTaskFromEvent={event => {
                        const clientName = clients.find(client => client.id === event.clientId)?.clientName;
                        setEventTaskDraft(eventToTaskDraft(event, clientName));
                        setSelected(null);
                    }}
                />
            )}

            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {announcement}
            </div>

            {reviewAttemptId && (
                <StopConfirmSheet
                    attemptId={reviewAttemptId}
                    onClose={() => setReviewAttemptId(null)}
                />
            )}

            {error && (
                <div
                    role="alert"
                    className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-destructive/40 bg-popover px-4 py-2.5 text-xs shadow-lg"
                >
                    <span className="text-destructive">{error}</span>
                    <button
                        onClick={() => setError(null)}
                        aria-label="Dismiss"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            )}

            <PlannerCommandBar
                items={items}
                members={members}
                onSelectItem={item => { setAnchorDate(new Date(item.startsAt)); setSelected(item); }}
                onSelectMember={id => setSelectedMemberIds(prev =>
                    prev.includes(id) ? prev : [...prev, id])}
                onGoToToday={handleToday}
                onViewChange={setView}
                restoreFocusRef={plannerSurfaceRef}
            />

            {quickCreate && organization?.id && userId && (
                <QuickCreatePopover
                    organizationId={organization.id}
                    userId={userId}
                    anchor={quickCreate.anchor}
                    draft={{ startsAt: quickCreate.startsAt, endsAt: quickCreate.endsAt }}
                    clients={clients}
                    members={members}
                    tasks={tasks}
                    onClose={() => setQuickCreate(null)}
                    onCreated={() => void reloadAll()}
                    onBlockChange={block => setQuickCreate(qc => qc && { ...qc, ...block })}
                    onTimesChange={times => setQuickCreate(qc => qc && { ...qc, ...times })}
                    onOpenFullTask={setFullTaskDraft}
                    restoreFocusRef={plannerSurfaceRef}
                />
            )}

            {fullTaskDraft && organization?.id && (
                <CreateTaskModal
                    isOpen
                    organizationId={organization.id}
                    currentUserId={userId}
                    defaultTitle={fullTaskDraft.title}
                    defaultClientId={fullTaskDraft.clientId}
                    defaultClientName={fullTaskDraft.clientName}
                    defaultDueDate={localDateForInstant(fullTaskDraft.startsAt)}
                    defaultStartDate={fullTaskDraft.startsAt}
                    defaultScheduledMinutes={durationMinutes(
                        fullTaskDraft.startsAt, fullTaskDraft.endsAt,
                    )}
                    onClose={() => setFullTaskDraft(null)}
                    onCreated={() => { setFullTaskDraft(null); void reloadAll(); }}
                />
            )}

            {eventTaskDraft && organization?.id && (
                <CreateTaskModal
                    isOpen
                    organizationId={organization.id}
                    currentUserId={userId}
                    defaultTitle={eventTaskDraft.title}
                    defaultDescription={eventTaskDraft.description}
                    defaultClientId={eventTaskDraft.clientId}
                    defaultClientName={eventTaskDraft.clientName}
                    defaultDueDate={eventTaskDraft.dueDate}
                    defaultAssigneeIds={eventTaskDraft.assigneeIds}
                    clients={clients}
                    eventConversion={{
                        id: eventTaskDraft.eventId,
                        userId: eventTaskDraft.eventUserId,
                        title: eventTaskDraft.title,
                        startsAt: eventTaskDraft.startsAt,
                        endsAt: eventTaskDraft.endsAt,
                    }}
                    onClose={() => setEventTaskDraft(null)}
                    onCreated={() => { void reloadAll(); }}
                />
            )}
        </div>
    );
}
