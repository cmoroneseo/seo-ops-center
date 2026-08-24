'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { format } from 'date-fns';
import {
    X, Trash2, MapPin, Users, Building2, Clock, Check, AlertCircle, ExternalLink,
    Pause, Play, Square,
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
    onTimerAction?: (action: PlannerTimerAction, item: PlannerItem) => void;
    canControlTimer?: boolean;
}

export function EventDetailPanel({
    item, members, organizationId, userId, recentProjects = [], onProjectUsed,
    onClose, onChanged, onDeleted, restoreFocusRef, onTimerAction,
    canControlTimer = false,
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
    const [showCompletion, setShowCompletion] = useState(false);
    const [isCompleting, setIsCompleting] = useState(false);
    const [completionError, setCompletionError] = useState<string | null>(null);
    const completionOperationId = useRef<string | null>(null);

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

    useEffect(() => {
        if (!event?.clientId) { setBcAvailable(false); return; }
        let cancelled = false;
        void getClientTimesheetSyncEnabled(event.clientId).then(on => {
            if (!cancelled) setBcAvailable(on);
        });
        return () => { cancelled = true; };
    }, [event?.clientId]);

    const blockMinutes = event ? Math.max(1, durationMinutes(item.startsAt, item.endsAt)) : 0;
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
                <button
                    type="button"
                    data-dialog-autofocus
                    onClick={() => requestClose('dismiss')}
                    aria-label="Close details"
                    className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <X className="h-4 w-4" />
                </button>
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
                                className="w-full cursor-pointer bg-transparent capitalize text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <option value="todo">To Do</option>
                                <option value="in_progress">In Progress</option>
                                <option value="review">Review</option>
                                <option value="approved">Approved</option>
                                <option value="blocked">Blocked</option>
                                <option value="done">Done</option>
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

                {timerActions.length > 0 && (
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
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Open task
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    ) : item.source === 'actual_time' && attempt?.taskId ? (
                        <Link
                            href={`/tasks?task=${encodeURIComponent(attempt.taskId)}`}
                            className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                            Open task
                            <ExternalLink className="h-3.5 w-3.5" />
                        </Link>
                    ) : (
                        <p className="text-xs text-muted-foreground">This is a reminder.</p>
                    )
                )}
            </div>

            {isEvent && event && (
                <button
                    type="button"
                    onClick={async () => {
                        if (!confirm('Delete this event?')) return;
                        const ok = await deletePlannerEvent(event.id);
                        if (ok) onDeleted();
                    }}
                    className="mx-4 mb-4 mt-auto flex min-h-11 items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                >
                    <Trash2 className="h-3.5 w-3.5" /> Delete event
                </button>
            )}

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
