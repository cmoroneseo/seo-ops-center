'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { format } from 'date-fns';
import {
    X, Trash2, MapPin, Users, Building2, Clock, Check, AlertCircle, ExternalLink,
    Pause, Play, Square,
    CalendarMinus, MoreHorizontal, ListPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEvent, Task, TimeLog, TimerAttempt } from '@/lib/types';
import {
    PlannerItem, plannerSourceLabel, plannerTimeLabel,
} from '@/lib/planner/items';
import {
    plannerTimerActionLabel, timerActionsForItem, type PlannerTimerAction,
} from '@/lib/planner/actual-items';
import { updatePlannerEvent, deletePlannerEvent } from '@/lib/supabase/planner-events';
import {
    createTimeLog, getTimeLogForPlannerEvent, getClientTimesheetSyncEnabled,
    getTaskTimeLogs, logTaskCompletionTime,
} from '@/lib/supabase/time-logs';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { localDateForInstant, parseLocalDate } from '@/lib/planner/local-date';
import { durationMinutes } from '@/lib/planner/layout';
import {
    formatBlockDuration, parseDurationInput, taskBlockLogInput,
} from '@/lib/planner/task-block-log';
import {
    backdatedStartFromTime, defaultBackdatedStartTime, formatBackdatedElapsed,
} from '@/lib/timer/backdated-start';
import { TASK_STATUS_LABELS, taskStatusLabel } from '@/lib/tasks/status-labels';
import { TeamMember } from './MeetWithFilter';
import { BasecampProjectPicker, type BasecampProject } from './BasecampProjectPicker';
import { ACTUAL_STYLE, KIND_STYLES } from './EventCard';
import { usePlannerDialogFocus } from './usePlannerDialogFocus';
import { usePlannerSurfaceBehavior } from './usePlannerSurfaceBehavior';
import { TaskCompletionDrawer } from '@/components/tasks/TaskCompletionDrawer';
import { completeTaskWithReconciliation } from '@/lib/tasks/task-completion';

interface EventDetailPanelProps {
    item: PlannerItem;
    members: TeamMember[];
    organizationId?: string;
    userId?: string;
    /** Most-recent-first Basecamp projects for internal time. */
    recentProjects?: BasecampProject[];
    onProjectUsed?: (project: BasecampProject) => void;
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
    restoreFocusRef?: RefObject<HTMLElement | null>;
    onTimerAction?: (
        action: PlannerTimerAction,
        item: PlannerItem,
        options?: { startedAt?: string },
    ) => void;
    canControlTimer?: boolean;
    canStartEarlier?: boolean;
    onUnscheduleTask?: (taskId: string) => Promise<boolean>;
    onCreateTaskFromEvent?: (event: PlannerEvent) => void;
}

export function EventDetailPanel({
    item, members, organizationId, userId, recentProjects = [], onProjectUsed,
    onClose, onChanged, onDeleted, restoreFocusRef, onTimerAction,
    canControlTimer = false, canStartEarlier = true, onUnscheduleTask, onCreateTaskFromEvent,
}: EventDetailPanelProps) {
    const dialogRef = useRef<HTMLElement>(null);
    const surface = usePlannerSurfaceBehavior('detail');
    const requestClose = usePlannerDialogFocus(dialogRef, true, onClose, {
        trapFocus: surface.trapFocus,
        restoreFocusRef,
    });
    const isEvent = item.source === 'event';
    const isTask = item.source === 'task';
    const isActual = item.source === 'actual_time';
    const event = isEvent ? (item.raw as PlannerEvent) : null;
    const task = isTask ? (item.raw as Task) : null;
    const attempt = isActual ? (item.raw as TimerAttempt) : null;
    const timerActions = canControlTimer ? timerActionsForItem(item) : [];

    const [title, setTitle] = useState(task?.title ?? item.title);
    const [description, setDescription] = useState(event?.description ?? '');
    const [loggedLog, setLoggedLog] = useState<TimeLog | null>(null);
    const [isLogging, setIsLogging] = useState(false);
    // Only offer "Send to Basecamp" when this client has timesheet sync on —
    // same gate the timer and Log Hours modal use.
    const [bcAvailable, setBcAvailable] = useState(false);
    const [sendToBasecamp, setSendToBasecamp] = useState(true);
    // Internal time stays in SEO PM unless the person explicitly chooses a
    // Basecamp destination. Recents remain shortcuts, never an implicit sync.
    const [internalProject, setInternalProject] = useState<BasecampProject | undefined>(undefined);
    const [taskTrackedHours, setTaskTrackedHours] = useState(0);
    const [isLoadingTaskTime, setIsLoadingTaskTime] = useState(false);
    // Logging a worked task block. Seeded from the block itself so the common
    // case — "I worked the time I planned" — is one click with nothing to type.
    const [taskLogDuration, setTaskLogDuration] = useState('');
    const [taskLogNote, setTaskLogNote] = useState('');
    const [taskLogCountsBudget, setTaskLogCountsBudget] = useState(true);
    const [isLoggingTaskBlock, setIsLoggingTaskBlock] = useState(false);
    const [taskLogError, setTaskLogError] = useState<string | null>(null);
    const [taskLoggedMinutes, setTaskLoggedMinutes] = useState<number | null>(null);
    const [showCompletion, setShowCompletion] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [completionError, setCompletionError] = useState<string | null>(null);
    const [isUnscheduling, setIsUnscheduling] = useState(false);
    const [unscheduleError, setUnscheduleError] = useState<string | null>(null);
    const [showEventActions, setShowEventActions] = useState(false);
    const [showEarlierStart, setShowEarlierStart] = useState(false);
    const [earlierStartTime, setEarlierStartTime] = useState('');
    const [earlierStartPreview, setEarlierStartPreview] = useState<string | null>(null);
    const [earlierStartError, setEarlierStartError] = useState<string | null>(null);
    const eventActionsRef = useRef<HTMLDivElement>(null);
    const eventActionsTriggerRef = useRef<HTMLButtonElement>(null);
    const eventActionsMenuRef = useRef<HTMLDivElement>(null);
    const completionOperationId = useRef<string | null>(null);

    const openEarlierStart = () => {
        if (!canStartEarlier) return;
        const now = new Date();
        const defaultTime = defaultBackdatedStartTime(now);
        const result = backdatedStartFromTime(defaultTime, now);
        setEarlierStartTime(defaultTime);
        setEarlierStartPreview('elapsedMinutes' in result
            ? formatBackdatedElapsed(result.elapsedMinutes)
            : null);
        setEarlierStartError('error' in result ? result.error : null);
        setShowEarlierStart(true);
    };

    const updateEarlierStart = (value: string) => {
        const result = backdatedStartFromTime(value, new Date());
        setEarlierStartTime(value);
        setEarlierStartPreview('elapsedMinutes' in result
            ? formatBackdatedElapsed(result.elapsedMinutes)
            : null);
        setEarlierStartError('error' in result ? result.error : null);
    };

    const startEarlier = () => {
        const result = backdatedStartFromTime(earlierStartTime, new Date());
        if ('error' in result) {
            setEarlierStartError(result.error);
            setEarlierStartPreview(null);
            return;
        }
        onTimerAction?.('start', item, { startedAt: result.startedAt });
    };

    useEffect(() => {
        if (!showEventActions) return;
        const closeOnOutsideClick = (pointerEvent: PointerEvent) => {
            if (!eventActionsRef.current?.contains(pointerEvent.target as Node)) {
                setShowEventActions(false);
            }
        };
        const closeOnEscape = (keyboardEvent: KeyboardEvent) => {
            if (keyboardEvent.key === 'Escape') {
                setShowEventActions(false);
                eventActionsTriggerRef.current?.focus();
            }
        };
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [showEventActions]);

    useEffect(() => {
        if (!showEventActions) return;
        eventActionsMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    }, [showEventActions]);

    const navigateEventActions = (keyboardEvent: React.KeyboardEvent<HTMLDivElement>) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(keyboardEvent.key)) return;
        const items = Array.from(
            eventActionsMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
        );
        if (items.length === 0) return;
        keyboardEvent.preventDefault();
        const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = keyboardEvent.key === 'Home'
            ? 0
            : keyboardEvent.key === 'End'
                ? items.length - 1
                : keyboardEvent.key === 'ArrowUp'
                    ? (activeIndex - 1 + items.length) % items.length
                    : (activeIndex + 1) % items.length;
        items[nextIndex]?.focus();
    };

    useEffect(() => {
        setInternalProject(undefined);
    }, [organizationId]);

    useEffect(() => {
        if (!task?.id) {
            setTaskTrackedHours(0);
            setIsLoadingTaskTime(false);
            return;
        }
        let cancelled = false;
        setTaskTrackedHours(0);
        setIsLoadingTaskTime(true);
        void getTaskTimeLogs(task.id)
            .then(logs => {
                if (!cancelled) {
                    setTaskTrackedHours(logs.reduce((sum, log) => sum + log.hours, 0));
                }
            })
            .finally(() => {
                if (!cancelled) setIsLoadingTaskTime(false);
            });
        return () => { cancelled = true; };
    }, [task?.id]);

    // Seed (and re-seed) the duration from the block being viewed. A task block
    // can be logged more than once — two sittings on the same block is normal —
    // so this is deliberately NOT made idempotent the way an event log is.
    useEffect(() => {
        setTaskLogDuration(formatBlockDuration(
            Math.max(1, durationMinutes(item.startsAt, item.endsAt)),
        ));
        setTaskLogNote('');
        setTaskLogCountsBudget(true);
        setTaskLogError(null);
        setTaskLoggedMinutes(null);
    }, [item.id, item.startsAt, item.endsAt]);

    // Has this block already been turned into time? Keeps the action idempotent.
    const eventId = event?.id;
    useEffect(() => {
        if (!eventId) { setLoggedLog(null); return; }
        let cancelled = false;
        void getTimeLogForPlannerEvent(eventId).then(log => {
            if (!cancelled) setLoggedLog(log);
        });
        return () => { cancelled = true; };
    }, [eventId]);

    // Covers tasks as well as events. When this only looked at events, a task
    // block logged real hours and never attempted a Basecamp push at all —
    // not a failed sync, an unattempted one, which left no error to retry.
    const syncClientId = event?.clientId ?? task?.clientId;
    useEffect(() => {
        if (!syncClientId) { setBcAvailable(false); return; }
        let cancelled = false;
        void getClientTimesheetSyncEnabled(syncClientId).then(on => {
            if (!cancelled) setBcAvailable(on);
        });
        return () => { cancelled = true; };
    }, [syncClientId]);

    const blockMinutes = (event || task)
        ? Math.max(1, durationMinutes(item.startsAt, item.endsAt))
        : 0;
    const isPast = new Date(item.endsAt).getTime() <= Date.now();

    /**
     * Turn the block into a time log. A client meeting is tracked but must not
     * eat SEO budget, so anything with a client that is not task work is flagged
     * countsTowardBudget: false.
     */
    const logTime = async () => {
        if (!event || !organizationId || isLogging) return;
        setIsLogging(true);
        const hours = Math.round((blockMinutes / 60) * 100) / 100;
        const res = await createTimeLog({
            organizationId,
            userId,
            clientId: event.clientId,
            plannerEventId: event.id,
            date: localDateForInstant(item.startsAt),
            hours,
            description: event.title,
            billable: Boolean(event.clientId),
            countsTowardBudget: false,
            // Only meaningful for internal work; client logs resolve their own.
            basecampProjectId: !event.clientId && internalProject
                ? Number(internalProject.id)
                : undefined,
        }, {
            // Independent of countsTowardBudget: a meeting is excluded from SEO
            // budget but still belongs on the client's Basecamp timesheet.
            syncToBasecamp: event.clientId
                ? (bcAvailable && sendToBasecamp)
                : Boolean(internalProject),
        });
        setIsLogging(false);
        if (!res.success) {
            console.error('[planner] log time failed:', res.error);
            return;
        }
        setLoggedLog(res.data ?? null);
        if (!event.clientId && internalProject) onProjectUsed?.(internalProject);
        // The Basecamp push is fire-and-forget and takes a few round trips, so
        // poll briefly until it resolves either way. A single delayed read was
        // too early and left a successful sync looking like it never happened.
        const pushed = (event.clientId && bcAvailable && sendToBasecamp)
            || (!event.clientId && Boolean(internalProject));
        if (pushed) void pollForSyncResult(event.id);
    };

    /**
     * Log a worked task block WITHOUT touching the task's status.
     *
     * The gap this closes: the only one-click route to a task's hours was
     * marking it done, which conflated "record my time" with "this work is
     * finished". Someone who worked 3:15–6:00 and intends to continue tomorrow
     * had to leave the panel, open the task modal, and retype a duration the
     * panel was already showing them.
     */
    const logTaskBlock = async () => {
        if (!task || !organizationId || !task.clientId || isLoggingTaskBlock) return;
        const minutes = parseDurationInput(taskLogDuration);
        if (!minutes) {
            setTaskLogError('Enter a duration like 2h 45m, 2:45, or 2.75.');
            return;
        }
        setTaskLogError(null);
        setIsLoggingTaskBlock(true);
        const res = await createTimeLog(taskBlockLogInput(
            {
                organizationId,
                userId,
                taskId: task.id,
                clientId: task.clientId,
                taskTitle: task.title,
                // The block's own date. Logging after the fact is the norm here,
                // so defaulting to today would silently misdate the work.
                date: localDateForInstant(item.startsAt),
                plannedStartsAt: item.startsAt,
                plannedMinutes: blockMinutes,
            },
            { minutes, note: taskLogNote, countsTowardBudget: taskLogCountsBudget },
        ), { syncToBasecamp: bcAvailable && sendToBasecamp });
        setIsLoggingTaskBlock(false);
        if (!res.success) {
            setTaskLogError(res.error || 'Could not log this time. Try again.');
            return;
        }
        setTaskLoggedMinutes(minutes);
        setTaskTrackedHours(hours => hours + (Math.round((minutes / 60) * 100) / 100));
        onChanged();
    };

    /** Re-read the log until Basecamp reports success or failure, then stop. */
    const pollForSyncResult = async (evId: string) => {
        for (const delay of [1500, 2500, 4000, 6000]) {
            await new Promise(r => setTimeout(r, delay));
            const fresh = await getTimeLogForPlannerEvent(evId);
            if (!fresh) return;
            setLoggedLog(fresh);
            if (fresh.basecampEntryId || fresh.basecampSyncError) return;
        }
    };

    useEffect(() => {
        setTitle(item.source === 'task' ? (item.raw as Task).title : item.title);
        setDescription(item.source === 'event' ? (item.raw as PlannerEvent).description ?? '' : '');
    }, [item]);

    const save = async () => {
        if (!event) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        if (trimmed === event.title && description === (event.description ?? '')) return;
        const saved = await updatePlannerEvent(event.id, { title: trimmed, description });
        if (saved) onChanged();
    };

    const changeTaskStatus = async (status: Task['status']) => {
        if (!task) return;
        if (status === 'done' && task.status !== 'done') {
            setCompletionError(null);
            setShowCompletion(true);
            return;
        }
        const result = await updateTask(task.id, { status, updatedBy: userId });
        if (result.success) onChanged();
    };

    const unschedule = async () => {
        if (!task || !onUnscheduleTask || isUnscheduling) return;
        setIsUnscheduling(true);
        setUnscheduleError(null);
        const success = await onUnscheduleTask(task.id);
        setIsUnscheduling(false);
        if (success) onChanged();
        else setUnscheduleError('Could not remove this task from the calendar. Try again.');
    };

    const completeTask = async (additionalMinutes: number) => {
        if (!task || isCompleting) return;
        setIsCompleting(true);
        setCompletionError(null);
        completionOperationId.current ??= crypto.randomUUID();
        const operationId = completionOperationId.current;
        const syncToBasecamp = additionalMinutes > 0
            ? await getClientTimesheetSyncEnabled(task.clientId)
            : false;
        const result = await completeTaskWithReconciliation({
            taskId: task.id,
            additionalMinutes,
            operationId,
        }, {
            logTime: input => logTaskCompletionTime({
                ...input,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                syncToBasecamp,
            }),
            markDone: async taskId => {
                const current = await getTask(taskId);
                if (current.task?.status === 'done') {
                    return { success: true, task: current.task };
                }
                const updated = await updateTask(taskId, { status: 'done', updatedBy: userId });
                return {
                    success: updated.success,
                    task: updated.data,
                    error: updated.error,
                };
            },
        });
        setIsCompleting(false);
        if (!result.success) {
            setCompletionError(result.timeLogId
                ? 'Time was saved, but the task could not be completed. Retry to finish it.'
                : result.error);
            return;
        }
        completionOperationId.current = null;
        setShowCompletion(false);
        window.dispatchEvent(new Event('planner:data-changed'));
        window.dispatchEvent(new Event('task:data-changed'));
        onChanged();
    };

    const attendeeNames = (event?.attendeeIds ?? [])
        .map(id => members.find(m => m.userId === id)?.name)
        .filter(Boolean);
    const taskAssigneeNames = (task?.assigneeIds ?? [])
        .map(id => members.find(m => m.userId === id)?.name ?? 'Team member');
    const assigneeLabel = taskAssigneeNames.length > 0
        ? taskAssigneeNames.join(', ')
        : task?.assignees?.length
            ? task.assignees.join(', ')
            : 'Unassigned';
    const dueDate = task?.dueDate ? parseLocalDate(task.dueDate) : null;

    return (
        <>
        {surface.backdrop && (
            <div
                className="fixed inset-0 z-[60] bg-black/35"
                onClick={() => requestClose('dismiss')}
                aria-hidden="true"
            />
        )}
        <aside
            ref={dialogRef}
            role={surface.role}
            aria-modal={surface.modal || undefined}
            aria-labelledby="planner-detail-heading"
            tabIndex={-1}
            className="fixed inset-x-0 bottom-0 z-[70] flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl lg:relative lg:z-auto lg:h-full lg:max-h-none lg:w-[28rem] lg:shrink-0 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none"
        >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <h2 id="planner-detail-heading" className="sr-only">{plannerSourceLabel(item)} details</h2>
                <span className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    item.source === 'actual_time'
                        ? ACTUAL_STYLE.accent
                        : KIND_STYLES[item.kind].accent,
                )} />
                <span className="text-xs font-medium text-muted-foreground">
                    {plannerSourceLabel(item)}
                </span>
                <div className="ml-auto flex items-center gap-1">
                    {isEvent && event && (
                        <div ref={eventActionsRef} className="relative">
                            <button
                                ref={eventActionsTriggerRef}
                                type="button"
                                aria-label="Event actions"
                                aria-haspopup="menu"
                                aria-expanded={showEventActions}
                                onClick={() => setShowEventActions(open => !open)}
                                onKeyDown={keyboardEvent => {
                                    if (keyboardEvent.key === 'ArrowDown') {
                                        keyboardEvent.preventDefault();
                                        setShowEventActions(true);
                                    }
                                }}
                                className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <MoreHorizontal className="h-4 w-4" />
                            </button>
                            {showEventActions && (
                                <div
                                    ref={eventActionsMenuRef}
                                    role="menu"
                                    onKeyDown={navigateEventActions}
                                    className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-xl"
                                >
                                    {onCreateTaskFromEvent && (
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={() => {
                                                setShowEventActions(false);
                                                onCreateTaskFromEvent({
                                                    ...event,
                                                    title: title.trim() || event.title,
                                                    description: description.trim() || undefined,
                                                });
                                            }}
                                            className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                        >
                                            <ListPlus className="h-4 w-4" />
                                            Create task from event…
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={async () => {
                                            setShowEventActions(false);
                                            if (!confirm('Delete this event?')) return;
                                            const ok = await deletePlannerEvent(event.id);
                                            if (ok) onDeleted();
                                        }}
                                        className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        Delete event
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                    <button
                        type="button"
                        data-dialog-autofocus
                        onClick={() => requestClose('dismiss')}
                        aria-label="Close details"
                        className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="space-y-4 px-4 py-4">
                <input
                    aria-label={isEvent ? 'Title' : 'Task title'}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={() => void save()}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    readOnly={!isEvent}
                    className="w-full rounded-md bg-transparent text-base font-semibold outline-none focus:bg-muted focus:px-2 focus:py-1"
                />

                {task?.clientName && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5" />
                        <span>{task.clientName}</span>
                    </div>
                )}

                {task && !task.startDate ? (
                    <div className="text-xs text-muted-foreground">Unscheduled</div>
                ) : (
                    <div className="text-xs text-muted-foreground">
                        {format(new Date(item.startsAt), 'EEEE, MMMM d')}
                        <br />
                        {plannerTimeLabel(item)}
                    </div>
                )}

                {task && (
                    <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-lg border border-border p-3 text-xs">
                        <dt className="text-muted-foreground">Source</dt>
                        <dd>{plannerSourceLabel(item)}</dd>
                        <dt className="text-muted-foreground">Status</dt>
                        <dd>
                            <select
                                value={task.status}
                                onChange={event => void changeTaskStatus(event.target.value as Task['status'])}
                                aria-label="Task status"
                                className="-ml-1 w-full cursor-pointer appearance-none bg-transparent px-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </select>
                        </dd>
                        <dt className="text-muted-foreground">Priority</dt>
                        <dd className="capitalize">{task.priority}</dd>
                        <dt className="text-muted-foreground">Assignee</dt>
                        <dd>{assigneeLabel}</dd>
                        <dt className="text-muted-foreground">Due</dt>
                        <dd>{dueDate ? format(dueDate, 'MMM d, yyyy') : 'No due date'}</dd>
                    </dl>
                )}

                {attempt && (
                    <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-lg border border-border p-3 text-xs">
                        <dt className="text-muted-foreground">Source</dt>
                        <dd>{plannerSourceLabel(item)}</dd>
                        <dt className="text-muted-foreground">Timer</dt>
                        <dd className="capitalize">{item.timerState ?? 'logged'}</dd>
                        <dt className="text-muted-foreground">Active</dt>
                        <dd>{plannerTimeLabel(item).split(' · ')[1] ?? 'Tracked work'}</dd>
                    </dl>
                )}

                {timerActions.includes('start') ? (
                    <div className="grid grid-cols-2 gap-2" aria-label="Timer controls">
                        <button
                            type="button"
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                                e.stopPropagation();
                                onTimerAction?.('start', item);
                            }}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            <Play className="h-3.5 w-3.5" />
                            Start Now
                        </button>
                        <button
                            type="button"
                            disabled={!canStartEarlier}
                            aria-expanded={showEarlierStart}
                            aria-describedby={!canStartEarlier ? 'planner-earlier-start-unavailable' : undefined}
                            title={canStartEarlier ? undefined : 'Pause or stop the current timer first.'}
                            onPointerDown={e => e.stopPropagation()}
                            onClick={e => {
                                e.stopPropagation();
                                openEarlierStart();
                            }}
                            className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"
                        >
                            <Clock className="h-3.5 w-3.5" />
                            Started Earlier
                        </button>

                        {!canStartEarlier && (
                            <p
                                id="planner-earlier-start-unavailable"
                                className="col-span-2 text-[11px] text-muted-foreground"
                            >
                                Pause or stop the current timer first.
                            </p>
                        )}

                        {showEarlierStart && (
                            <div className="col-span-2 space-y-3 rounded-xl border border-border bg-muted/30 p-3">
                                <div className="flex items-center justify-between gap-3">
                                    <label htmlFor="planner-earlier-start" className="text-xs font-medium">
                                        Actual start time
                                    </label>
                                    {earlierStartPreview && (
                                        <span className="text-[11px] text-primary" aria-live="polite">
                                            {earlierStartPreview}
                                        </span>
                                    )}
                                </div>
                                <input
                                    id="planner-earlier-start"
                                    type="time"
                                    value={earlierStartTime}
                                    onInput={event => updateEarlierStart(event.currentTarget.value)}
                                    aria-describedby={earlierStartError ? 'planner-earlier-start-error' : undefined}
                                    className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                />
                                {earlierStartError && (
                                    <p id="planner-earlier-start-error" role="alert" className="text-[11px] text-destructive">
                                        {earlierStartError}
                                    </p>
                                )}
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowEarlierStart(false)}
                                        className="min-h-11 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        disabled={Boolean(earlierStartError)}
                                        onClick={startEarlier}
                                        className="min-h-11 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                        Start timer
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                ) : timerActions.length > 0 ? (
                    <div className="flex flex-wrap gap-2" aria-label="Timer controls">
                        {timerActions.map(action => {
                            const Icon = action === 'pause' ? Pause : action === 'stop' ? Square : Play;
                            const label = plannerTimerActionLabel(action, item)
                                .replace(/ timer$/, '');
                            return (
                                <button
                                    type="button"
                                    key={action}
                                    onPointerDown={e => e.stopPropagation()}
                                    onClick={e => {
                                        e.stopPropagation();
                                        onTimerAction?.(action, item);
                                    }}
                                    className={cn(
                                        'flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                        action === 'start' || action === 'resume'
                                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                            : 'border border-border bg-background hover:bg-muted',
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5" />
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                ) : null}

                {task && (
                    <div className="rounded-lg border border-border p-3">
                        {taskLoggedMinutes !== null ? (
                            <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                                    <Check className="h-3.5 w-3.5" />
                                    Logged {formatBlockDuration(taskLoggedMinutes)}
                                </div>
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                    {taskTrackedHours.toFixed(2)}h on this task now.
                                    Still {taskStatusLabel(task.status)}.
                                    {bcAvailable && (sendToBasecamp
                                        ? ' Sent to Basecamp.'
                                        : ' Not sent to Basecamp.')}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => setTaskLoggedMinutes(null)}
                                    className="text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    Log more time
                                </button>
                            </div>
                        ) : !task.clientId ? (
                            <p className="text-[11px] leading-relaxed text-muted-foreground">
                                Give this task a client to log time against it.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex items-baseline justify-between">
                                    <span className="text-[11px] font-medium text-foreground/70">
                                        Log time
                                    </span>
                                    {taskTrackedHours > 0 && (
                                        <span className="text-[11px] text-muted-foreground">
                                            {taskTrackedHours.toFixed(2)}h so far
                                        </span>
                                    )}
                                </div>

                                {/* Same column grid as the details above, so the
                                    card reads as part of the panel rather than a
                                    form dropped into it. */}
                                <div className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-2">
                                    <label
                                        htmlFor="task-block-duration"
                                        className="text-[11px] text-muted-foreground"
                                    >
                                        Duration
                                    </label>
                                    <input
                                        id="task-block-duration"
                                        value={taskLogDuration}
                                        onChange={e => { setTaskLogDuration(e.target.value); setTaskLogError(null); }}
                                        className="min-h-9 w-full rounded-lg bg-background/60 px-2.5 py-1.5 text-xs outline-none ring-1 ring-inset ring-border focus:ring-primary"
                                    />

                                    <label
                                        htmlFor="task-block-note"
                                        className="text-[11px] text-muted-foreground"
                                    >
                                        Note
                                    </label>
                                    <input
                                        id="task-block-note"
                                        value={taskLogNote}
                                        onChange={e => setTaskLogNote(e.target.value)}
                                        placeholder="What did you work on?"
                                        className="min-h-9 w-full rounded-lg bg-background/60 px-2.5 py-1.5 text-xs outline-none ring-1 ring-inset ring-border placeholder:text-muted-foreground/60 focus:ring-primary"
                                    />
                                </div>

                                {bcAvailable && (
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={sendToBasecamp}
                                        onClick={() => setSendToBasecamp(v => !v)}
                                        className="flex min-h-9 w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        <span
                                            className={cn(
                                                'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                                                sendToBasecamp ? 'bg-primary' : 'bg-border',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                                                    sendToBasecamp ? 'translate-x-3.5' : 'translate-x-0.5',
                                                )}
                                            />
                                        </span>
                                        <span className="text-[11px]">Send to Basecamp timesheet</span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={taskLogCountsBudget}
                                    onClick={() => setTaskLogCountsBudget(v => !v)}
                                    className="flex min-h-9 w-full items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                >
                                    <span
                                        className={cn(
                                            'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                                            taskLogCountsBudget ? 'bg-primary' : 'bg-border',
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                                                taskLogCountsBudget ? 'translate-x-3.5' : 'translate-x-0.5',
                                            )}
                                        />
                                    </span>
                                    <span className="text-[11px]">Counts toward SEO budget</span>
                                </button>

                                {taskLogError && (
                                    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive">
                                        <AlertCircle className="mt-px h-3 w-3 shrink-0" />
                                        {taskLogError}
                                    </p>
                                )}

                                {/* The action of this card, so it carries the
                                    card's weight. It was grey while two
                                    navigation buttons beside it were filled. */}
                                <button
                                    type="button"
                                    onClick={() => void logTaskBlock()}
                                    disabled={isLoggingTaskBlock || !organizationId}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary/25 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                                >
                                    <Clock className="h-3.5 w-3.5" />
                                    {isLoggingTaskBlock
                                        ? 'Logging…'
                                        : `Log ${formatBlockDuration(parseDurationInput(taskLogDuration) ?? blockMinutes)}`}
                                </button>

                            </div>
                        )}
                    </div>
                )}

                {event?.location && (
                    <div className="flex items-center gap-2 text-xs">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {event.location}
                    </div>
                )}

                {item.clientName && !task && (
                    <div className="flex items-center gap-2 text-xs">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.clientName}
                    </div>
                )}

                {attendeeNames.length > 0 && (
                    <div className="flex items-start gap-2 text-xs">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{attendeeNames.join(', ')}</span>
                    </div>
                )}

                {isEvent && (
                    <div className="rounded-lg border border-border p-2.5">
                        {loggedLog ? (
                            <div className="space-y-1">
                                <div className="flex items-center gap-2 text-xs text-emerald-500">
                                    <Check className="h-3.5 w-3.5 shrink-0" />
                                    <span>{loggedLog.hours}h logged from this block</span>
                                </div>
                                {loggedLog.basecampSyncError ? (
                                    <div className="flex items-start gap-2 text-[10px] text-destructive">
                                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                                        <span>Basecamp: {loggedLog.basecampSyncError}</span>
                                    </div>
                                ) : loggedLog.basecampEntryId ? (
                                    <div className="text-[10px] text-muted-foreground">
                                        Synced to the Basecamp timesheet.
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <>
                                {!event?.clientId && (
                                    <div className="mb-2">
                                        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                            Basecamp project
                                        </div>
                                        <BasecampProjectPicker
                                            key={organizationId ?? 'missing-organization'}
                                            organizationId={organizationId}
                                            value={internalProject}
                                            recents={recentProjects}
                                            onChange={setInternalProject}
                                        />
                                    </div>
                                )}

                                {bcAvailable && (
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={sendToBasecamp}
                                        onClick={() => setSendToBasecamp(v => !v)}
                                        className="mb-2 flex min-h-11 w-full items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                        <span
                                            className={cn(
                                                'relative h-4 w-7 shrink-0 rounded-full transition-colors',
                                                sendToBasecamp ? 'bg-green-500' : 'bg-muted',
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                                                    sendToBasecamp ? 'translate-x-3.5' : 'translate-x-0.5',
                                                )}
                                            />
                                        </span>
                                        <span className="text-[11px]">Send to Basecamp timesheet</span>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => void logTime()}
                                    disabled={isLogging || !organizationId}
                                    className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                                >
                                    <Clock className="h-3.5 w-3.5" />
                                    {isLogging
                                        ? 'Logging…'
                                        : !event?.clientId && internalProject
                                            ? `Log ${blockMinutes} min → ${internalProject.name}`
                                            : `Log ${blockMinutes} min`}
                                </button>
                                <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                                    {event?.clientId
                                        ? 'Tracked against the client, but does not count toward their SEO budget.'
                                        : internalProject
                                            ? 'Tracked as internal time and sent to that Basecamp timesheet.'
                                            : 'Tracked as internal time. Choose a project to also send it to Basecamp.'}
                                    {!isPast && ' This block has not finished yet.'}
                                </p>
                            </>
                        )}
                    </div>
                )}

                {isEvent ? (
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        onBlur={() => void save()}
                        placeholder="Add description"
                        rows={5}
                        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                ) : (
                    item.source === 'task' ? (
                        <Link
                            href={`/tasks?task=${encodeURIComponent(item.raw.id)}`}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Open task
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    ) : item.source === 'actual_time' && attempt?.taskId ? (
                        <Link
                            href={`/tasks?task=${encodeURIComponent(attempt.taskId)}`}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Open task
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    ) : (
                        <p className="text-xs text-muted-foreground">This is a reminder.</p>
                    )
                )}

                {task?.startDate && onUnscheduleTask && (
                    <div className="space-y-1.5">
                        <button
                            type="button"
                            onClick={() => void unschedule()}
                            disabled={isUnscheduling}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                        >
                            <CalendarMinus className="h-3.5 w-3.5" />
                            {isUnscheduling ? 'Removing…' : 'Remove from calendar'}
                        </button>
                        {unscheduleError && (
                            <p className="text-[11px] text-destructive" role="alert">{unscheduleError}</p>
                        )}
                    </div>
                )}
            </div>

            {showCompletion && task && (
                <TaskCompletionDrawer
                    task={task}
                    trackedHours={taskTrackedHours}
                    hasOpenAttempt={false}
                    isLoadingTime={isLoadingTaskTime}
                    isSubmitting={isCompleting}
                    error={completionError}
                    onClose={() => {
                        setShowCompletion(false);
                        setCompletionError(null);
                    }}
                    onComplete={minutes => void completeTask(minutes)}
                />
            )}
        </aside>
        </>
    );
}
