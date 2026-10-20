'use client';

import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { X, Clock, Calendar, Tag, Check, CheckSquare, MessageSquare, ChevronDown, Trash2, Plus, UserCircle2, PenLine, RefreshCw, Building2 } from 'lucide-react';
import {
    createTimeLog,
    getClientTimesheetSyncEnabled,
    getTaskTimeLogs,
    logTaskCompletionTime,
    retryTimeLogBasecampSync,
} from '@/lib/supabase/time-logs';
import { cn } from '@/lib/utils';
import { taskDescriptionText, taskDescriptionChanged } from '@/lib/tasks/description';
import { descriptionSaveLabel } from '@/lib/tasks/description-save';
import { useDescriptionAutosave } from '@/lib/tasks/use-description-autosave';
import { mergeSavedTask } from '@/lib/tasks/merge-saved-task';
import { listedSubtaskProgress, progressOf } from '@/lib/tasks/subtask-progress';
import { SubtaskProgressText } from './SubtaskProgressText';
import { Task, TaskComment, TaskStatus, TaskPriority, TaskCategory, TimerAttempt } from '@/lib/types';
import { getTask, updateTask, createTask, deleteTask, getTaskComments, createTaskComment, getClientBasecampConfig } from '@/lib/supabase/tasks';
import { PUSH_OUTCOME_MESSAGE, pushOutcomeFor, type PushOutcome } from '@/lib/timesheets/push-outcome';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';
import { groupSegmentsForDisplay, sumActiveSeconds } from '@/lib/timer/segments';
import { timeLogSyncState, canPushToBasecamp } from '@/lib/timesheets/log-sync-state';
import { completeTaskWithReconciliation } from '@/lib/tasks/task-completion';
import { TaskCompletionDrawer } from './TaskCompletionDrawer';
import { startDateForDay, scheduleDateError, estimateFromInput } from '@/lib/tasks/schedule-edit';
import { parseLiveUrlInput } from '@/lib/tasks/live-url';
import { normalizeBlockedReason } from '@/lib/tasks/status';
import { PILLAR_TIME_BEHAVIOR, timeTrackingTaskId } from '@/lib/tasks/pillars';
import { queuePlanBasecampPush } from '@/lib/seo-plan/basecamp-push-queue';
import { LiveUrlControl } from './LiveUrlControl';
import { StopConfirmSheet } from '@/components/timer/StopConfirmSheet';
import { localTimeZone, workedWindowForEdit } from '@/lib/timer/manual-segment';

interface TaskDetailModalProps {
    task: Task | null;
    isOpen: boolean;
    initialCompletion?: boolean;
    /** Render the shared editor inside an existing workspace drawer. */
    embedded?: boolean;
    onClose: () => void;
    onUpdate?: (task: Task) => void;
    onDelete?: (taskId: string) => void;
    currentUserId?: string;
    /**
     * The SEO Plan pushes on its own. Hide the manual send control and queue
     * the shared push after a field save.
     */
    hideBasecampSend?: boolean;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'done', label: 'Done' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
    { value: 'urgent', label: 'Urgent', color: 'bg-red-600' },
    { value: 'high', label: 'High', color: 'bg-red-500' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
    { value: 'low', label: 'Low', color: 'bg-blue-400' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical SEO' },
    { value: 'local', label: 'Local SEO' },
    { value: 'links', label: 'Link Building' },
    { value: 'reporting', label: 'Reporting' },
    { value: 'admin', label: 'Admin' },
];

function formatClockRange(startedAt: string, endedAt?: string): string {
    const time = (value: string) => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return endedAt ? `${time(startedAt)} \u2013 ${time(endedAt)}` : time(startedAt);
}

function formatActiveDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** One finalized entry: who, how long, which sessions, and its Basecamp state. */
function TaskTimeLogRow({
    log,
    loggerName,
    retrying,
    onRetryBasecamp,
    basecampAvailable,
}: {
    log: TimerAttempt;
    loggerName?: string;
    retrying: boolean;
    onRetryBasecamp: (log: TimerAttempt) => void;
    /** Whether this client syncs timesheets at all. */
    basecampAvailable: boolean;
}) {
    const groups = groupSegmentsForDisplay(log.segments);
    const activeSeconds = sumActiveSeconds(log.segments);

    return (
        <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                    {log.hours.toFixed(2)}h
                    {activeSeconds > 0 && (
                        <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                            {formatActiveDuration(activeSeconds)} active
                        </span>
                    )}
                </p>
                <span className="text-[11px] text-muted-foreground">{log.date.slice(0, 10)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
                {loggerName ?? 'Team member'}
                {groups.length > 0 && (
                    <span className="ml-1.5">
                        {'\u00b7'} {groups.length} {groups.length === 1 ? 'session' : 'sessions'}
                    </span>
                )}
            </p>
            {groups.length > 0 && (
                <ul className="text-[11px] text-muted-foreground/70 space-y-0.5">
                    {groups.map(group => (
                        <li key={group.startsAt}>{formatClockRange(group.startsAt, group.endsAt)}</li>
                    ))}
                </ul>
            )}
            {(() => {
                const state = timeLogSyncState(log, basecampAvailable);
                if (state === 'synced') {
                    return <p className="text-[11px] text-muted-foreground/70">Synced to Basecamp</p>;
                }
                if (!canPushToBasecamp(state)) return null;
                return (
                    <div className="flex items-center gap-2 pt-0.5">
                        <span
                            className={cn(
                                'text-[11px]',
                                state === 'failed' ? 'text-destructive' : 'text-muted-foreground',
                            )}
                        >
                            {state === 'failed' ? 'Basecamp sync failed' : 'Not sent to Basecamp'}
                        </span>
                        <button
                            type="button"
                            onClick={() => onRetryBasecamp(log)}
                            disabled={retrying}
                            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                        >
                            <RefreshCw className={cn('h-3 w-3', retrying && 'animate-spin')} />
                            {retrying ? 'Sending' : state === 'failed' ? 'Retry' : 'Send'}
                        </button>
                    </div>
                );
            })()}
        </div>
    );
}

export function TaskDetailModal({ task, isOpen, onClose, onUpdate, onDelete, currentUserId, initialCompletion = false, embedded = false, hideBasecampSend = false }: TaskDetailModalProps) {
    const { organization, memberships } = useOrganization();
    const { runningTimer, pausedTimers, startTask, pause, beginStop } = useTimer();
    const [mounted, setMounted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [postingComment, setPostingComment] = useState(false);
    const [loggedHours, setLoggedHours] = useState(0);
    const [loadingTaskTime, setLoadingTaskTime] = useState(false);
    const [timeLogs, setTimeLogs] = useState<TimerAttempt[]>([]);
    const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
    // Whether this client syncs timesheets. Needed as state, not on demand,
    // because the log rows have to say when time never reached Basecamp.
    const [basecampAvailable, setBasecampAvailable] = useState(false);
    // Whether this client takes Basecamp to-dos at all, so a task that never
    // reached Basecamp can be sent without leaving this screen.
    const [basecampTodoTarget, setBasecampTodoTarget] = useState<{ projectId: string } | null>(null);
    const [pushingTodo, setPushingTodo] = useState(false);
    const [todoPushOutcome, setTodoPushOutcome] = useState<PushOutcome | null>(null);
    const [subtaskNestNote, setSubtaskNestNote] = useState<string | null>(null);
    const [subtasks, setSubtasks] = useState<Task[]>([]);
    const [subtasksReady, setSubtasksReady] = useState(false);
    const [subtasksUnavailable, setSubtasksUnavailable] = useState(false);
    const taskRef = useRef(task);
    const onUpdateRef = useRef(onUpdate);
    taskRef.current = task;
    onUpdateRef.current = onUpdate;
    const descriptionSave = useDescriptionAutosave({
        savedText: taskDescriptionText(task?.description),
        resetKey: task?.id ?? '',
        persist: async text => {
            const current = taskRef.current;
            if (!current) return false;
            if (!taskDescriptionChanged(current.description, text)) return true;
            onUpdateRef.current?.(mergeSavedTask(current, { ...current, description: text }));
            const result = await updateTask(current.id, { description: text, updatedBy: currentUserId });
            if (!result.success || !result.data) {
                onUpdateRef.current?.(current);
                return false;
            }
            const latest = taskRef.current ?? current;
            onUpdateRef.current?.(mergeSavedTask({ ...latest, description: text }, result.data));
            if (hideBasecampSend) queuePlanBasecampPush(result.data.id);
            return true;
        },
    });
    const closePanel = () => {
        descriptionSave.flush();
        onClose();
    };
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [addingSubtask, setAddingSubtask] = useState(false);

    // Local editable state
    const [title, setTitle] = useState('');
    const [liveUrl, setLiveUrl] = useState<string | undefined>();
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [blockedReason, setBlockedReason] = useState<string | null>(null);
    const [blockedDraft, setBlockedDraft] = useState('');
    const [blockedError, setBlockedError] = useState<string | null>(null);
    const [showBlockedForm, setShowBlockedForm] = useState(false);
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const fieldId = useId();
    const [dueDate, setDueDate] = useState('');
    const [startDate, setStartDate] = useState('');
    const [estimate, setEstimate] = useState('');
    const [saveError, setSaveError] = useState<string | null>(null);
    const [tags, setTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [orgMembers, setOrgMembers] = useState<{ id: string; name: string }[]>([]);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showLogForm, setShowLogForm] = useState(false);
    const [logHours, setLogHours] = useState('');
    const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
    const [logStart, setLogStart] = useState('');
    const [logFinish, setLogFinish] = useState('');
    const [logNote, setLogNote] = useState('');
    const [logFormError, setLogFormError] = useState('');
    const [submittingLog, setSubmittingLog] = useState(false);
    const [showCompletion, setShowCompletion] = useState(false);
    const [completing, setCompleting] = useState(false);
    const [completionError, setCompletionError] = useState<string | null>(null);
    const [completionReviewAttemptId, setCompletionReviewAttemptId] = useState<string | null>(null);
    const completionOperationId = useRef<string | null>(null);

    useEffect(() => { setMounted(true); }, []);

    // Reset state when task changes
    useEffect(() => {
        if (!task) return;
        setTitle(task.title ?? '');
        setLiveUrl(task.publishedUrl);
        setStatus(task.status ?? 'todo');
        setBlockedReason(task.blockedReason?.trim() ? task.blockedReason.trim() : null);
        setBlockedDraft('');
        setBlockedError(null);
        setShowBlockedForm(false);
        setPriority(task.priority ?? 'medium');
        setCategory((task.category as TaskCategory) ?? '');
        setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '');
        setStartDate(task.startDate?.slice(0, 10) ?? '');
        setEstimate(task.estimatedHours == null ? '' : String(task.estimatedHours));
        setSaveError(null);
        setTags(task.tags ?? []);
        setAssigneeIds(task.assigneeIds ?? []);
        setLoggedHours(0);
        setTimeLogs([]);
        setLoadingTaskTime(true);
        setShowCompletion(false);
        setCompletionError(null);
        completionOperationId.current = null;
    }, [task?.id]);

    useEffect(() => {
        if (isOpen && initialCompletion && task && task.status !== 'done') setShowCompletion(true);
    }, [isOpen, initialCompletion, task?.id]);

    // Fetch org members once per organization
    useEffect(() => {
        if (!organization?.id || orgMembers.length > 0) return;
        getOrganizationMembers(organization.id).then(members => {
            setOrgMembers(members.map(m => ({
                id: m.userId,
                name: (m.user as any)?.fullName || (m.user as any)?.email || 'Team member',
            })));
        }).catch(() => {});
    }, [organization?.id]);

    // Load comments + hours when task opens
    const publishSubtasks = useCallback((rows: Task[]) => {
        const current = taskRef.current;
        if (!current) return;
        onUpdateRef.current?.(mergeSavedTask(current, {
            ...current,
            subtasks: rows.map(row => ({ id: row.id, title: row.title, completed: row.status === 'done' })),
            subtasksState: 'ready',
        }));
    }, []);

    const loadTaskData = useCallback(async () => {
        const current = taskRef.current;
        if (!current) return;
        const requestedId = current.id;
        setLoadingTaskTime(true);
        try {
            const [commentsData, taskData] = await Promise.all([
                getTaskComments(requestedId),
                getTask(requestedId),
            ]);
            if (taskRef.current?.id !== requestedId) return;
            const logs = await getTaskTimeLogs(requestedId, taskData.subtasks.map(subtask => subtask.id));
            if (taskRef.current?.id !== requestedId) return;
            setComments(commentsData);
            setLoggedHours(taskData.loggedHours);
            setTimeLogs(logs);
            if (!taskData.task) {
                setSubtasksUnavailable(true);
                setSubtasksReady(true);
                return;
            }
            setSubtasks(taskData.subtasks);
            setSubtasksUnavailable(false);
            setSubtasksReady(true);
            const latest = taskRef.current;
            if (latest) {
                onUpdateRef.current?.(mergeSavedTask(latest, {
                    ...latest,
                    subtasks: taskData.task.subtasks,
                    subtasksState: 'ready',
                }));
            }
        } catch {
            if (taskRef.current?.id === requestedId) {
                setSubtasksUnavailable(true);
                setSubtasksReady(true);
            }
        } finally {
            setLoadingTaskTime(false);
        }
    }, []);

    useEffect(() => {
        if (!task?.clientId) { setBasecampAvailable(false); return; }
        let cancelled = false;
        void getClientTimesheetSyncEnabled(task.clientId).then(on => {
            if (!cancelled) setBasecampAvailable(on);
        });
        return () => { cancelled = true; };
    }, [task?.clientId]);

    useEffect(() => {
        if (!task?.clientId) { setBasecampTodoTarget(null); return; }
        let cancelled = false;
        void getClientBasecampConfig(task.clientId).then(config => {
            if (!cancelled) setBasecampTodoTarget(config);
        });
        return () => { cancelled = true; };
    }, [task?.clientId]);

    /**
     * Send a task to Basecamp that never made it.
     *
     * The push only ever ran once, at creation time on the timesheet import
     * screen, and a failure there left the task stranded — created here, absent
     * in Basecamp, with no route back short of making the to-do by hand.
     */
    const handlePushTodo = useCallback(async () => {
        if (!task || pushingTodo) return;
        setPushingTodo(true);
        setTodoPushOutcome(null);
        try {
            const res = await fetch('/api/integrations/basecamp/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create_todo', taskId: task.id }),
            });
            const body = await res.json().catch(() => null);
            setTodoPushOutcome(pushOutcomeFor(res.status, body));
            const skipped = body && typeof body.subtasksSkipped === 'number' ? body.subtasksSkipped : 0;
            const preserved = body && typeof body.subtasksPreserved === 'number' ? body.subtasksPreserved : 0;
            setSubtaskNestNote(skipped > 0
                ? `Sent the to-do. This list did not accept nested subtasks, so ${skipped} stayed in SEO PM only.`
                : preserved > 0
                    ? `Sent the pillar. ${preserved} existing Basecamp ${preserved === 1 ? 'to-do stays' : 'to-dos stay'} linked on ${preserved === 1 ? 'its task' : 'their tasks'}.`
                    : null);
        } catch {
            setTodoPushOutcome(pushOutcomeFor(null, null));
        } finally {
            setPushingTodo(false);
            await loadTaskData();
        }
    }, [task, pushingTodo, loadTaskData]);

    const handleRetryBasecamp = useCallback(async (log: TimerAttempt) => {
        setRetryingLogId(log.id);
        try {
            await retryTimeLogBasecampSync(log.id);
        } catch (error) {
            // A failed retry leaves the logged time and its stored error intact.
            console.error('Basecamp retry failed');
            void error;
        } finally {
            setRetryingLogId(null);
            await loadTaskData();
        }
    }, [loadTaskData]);

    useEffect(() => {
        setSubtasks([]);
        setSubtasksReady(false);
        setSubtasksUnavailable(false);
    }, [task?.id]);

    useEffect(() => {
        if (isOpen && task) loadTaskData();
    }, [isOpen, task?.id, loadTaskData]);

    const wasOpen = useRef(isOpen);
    useEffect(() => {
        if (wasOpen.current && !isOpen) descriptionSave.flush();
        wasOpen.current = isOpen;
    }, [isOpen, descriptionSave.flush]);

    // Confirmed time must appear here as soon as a Stop confirmation lands.
    useEffect(() => {
        if (!isOpen || !task) return;
        const refresh = () => { void loadTaskData(); };
        window.addEventListener('timer:data-changed', refresh);
        return () => window.removeEventListener('timer:data-changed', refresh);
    }, [isOpen, task?.id, loadTaskData]);

    const save = useCallback(async (patch: Parameters<typeof updateTask>[1]) => {
        const current = taskRef.current;
        if (!current) return;
        const optimistic = mergeSavedTask(current, { ...current, ...patch } as Task);
        onUpdateRef.current?.(optimistic);
        setSaving(true);
        setSaveError(null);
        try {
            const result = await updateTask(current.id, { ...patch, updatedBy: currentUserId });
            if (result.success && result.data) {
                const latest = taskRef.current ?? optimistic;
                onUpdateRef.current?.(mergeSavedTask(latest, result.data));
                if (hideBasecampSend) queuePlanBasecampPush(result.data.id);
                return true;
            }
            onUpdateRef.current?.(current);
            setSaveError('Could not save changes. Check the task and try again.');
            return false;
        } catch {
            onUpdateRef.current?.(current);
            setSaveError('Could not confirm the save. Refresh the task before retrying.');
            return false;
        } finally { setSaving(false); }
    }, [currentUserId, hideBasecampSend]);

    const handleStatusChange = async (newStatus: TaskStatus) => {
        if (newStatus === 'done' && status !== 'done') {
            setCompletionError(null);
            setShowCompletion(true);
            return;
        }
        const previous = status;
        setStatus(newStatus);
        if (!await save({ status: newStatus })) setStatus(previous);
    };

    const openAttempt = task
        ? [runningTimer, ...pausedTimers].find(attempt => attempt?.taskId === task.id) ?? null
        : null;

    const completeTask = async (additionalMinutes: number) => {
        if (!task || completing) return;
        setCompleting(true);
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
                const updated = await updateTask(taskId, {
                    status: 'done',
                    updatedBy: currentUserId,
                });
                return {
                    success: updated.success,
                    task: updated.data,
                    error: updated.error,
                };
            },
        });
        setCompleting(false);
        if (!result.success) {
            setCompletionError(result.timeLogId
                ? 'Time was saved, but the task could not be completed. Retry to finish it.'
                : result.error);
            return;
        }
        setStatus('done');
        setBlockedReason(null);
        setShowBlockedForm(false);
        setShowCompletion(false);
        completionOperationId.current = null;
        if (hideBasecampSend) queuePlanBasecampPush(task.id);
        onUpdate?.(result.task);
        await loadTaskData();
        window.dispatchEvent(new Event('planner:data-changed'));
        window.dispatchEvent(new Event('task:data-changed'));
    };

    const stopAndComplete = async () => {
        if (!openAttempt) return;
        try {
            if (!openAttempt.reviewingAt) await beginStop(openAttempt);
            setShowCompletion(false);
            setCompletionReviewAttemptId(openAttempt.id);
        } catch (error) {
            setCompletionError(error instanceof Error ? error.message : 'Unable to stop the timer.');
        }
    };

    const finishStopReview = async () => {
        setCompletionReviewAttemptId(null);
        if (!task) return;
        const refreshed = await getTask(task.id);
        if (refreshed.task) {
            setStatus(refreshed.task.status);
            setBlockedReason(refreshed.task.blockedReason?.trim() ? refreshed.task.blockedReason.trim() : null);
            onUpdate?.(refreshed.task);
        }
        await loadTaskData();
    };

    const saveBlockedReason = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!task || status === 'done') return;
        const parsed = normalizeBlockedReason(blockedDraft);
        if (!parsed.ok) {
            setBlockedError(parsed.error);
            return;
        }
        const previous = blockedReason;
        setBlockedReason(parsed.reason);
        setBlockedError(null);
        if (!await save({ blockedReason: parsed.reason })) {
            setBlockedReason(previous);
            return;
        }
        setShowBlockedForm(false);
        setBlockedDraft('');
    };

    const clearBlockedReason = async () => {
        const previous = blockedReason;
        setBlockedReason(null);
        setBlockedError(null);
        if (!await save({ blockedReason: null })) setBlockedReason(previous);
    };

    const handlePriorityChange = async (newPriority: TaskPriority) => {
        setPriority(newPriority);
        await save({ priority: newPriority });
    };

    const handleTitleBlur = async () => {
        if (title !== task?.title) await save({ title });
    };

    const handleDueDateChange = async (date: string) => {
        const error = scheduleDateError(startDate, date);
        if (error) { setSaveError(error); return; }
        const previous = dueDate;
        setDueDate(date);
        if (!await save({ dueDate: date || null })) setDueDate(previous);
    };

    const handleCategoryChange = async (cat: TaskCategory | '') => {
        setCategory(cat);
        await save({ category: cat as TaskCategory || undefined });
    };

    const handleAddTag = async () => {
        const tag = newTag.trim().toLowerCase();
        if (!tag || tags.includes(tag)) { setNewTag(''); return; }
        const next = [...tags, tag];
        setTags(next);
        setNewTag('');
        await save({ tags: next });
    };

    const handleRemoveTag = async (tag: string) => {
        const next = tags.filter(t => t !== tag);
        setTags(next);
        await save({ tags: next });
    };

    const saveLiveUrl = async (taskId: string, raw: string) => {
        const parsed = parseLiveUrlInput(raw);
        if (!parsed.ok) return parsed.error;
        const result = await updateTask(taskId, { publishedUrl: parsed.publishedUrl, updatedBy: currentUserId });
        if (!result.success || !result.data) return result.error || 'Could not save that link.';
        return result.data;
    };

    const handleAddSubtask = async () => {
        const t = newSubtaskTitle.trim();
        if (!t || !task || !organization) return;
        setAddingSubtask(true);
        const result = await createTask({
            organizationId: organization.id,
            projectId: task.projectId,
            clientId: task.clientId,
            title: t,
            parentTaskId: task.id,
            priority: 'medium',
            status: 'todo',
            createdBy: currentUserId,
        });
        if (result.success && result.data) {
            const next = [...subtasks, result.data];
            setSubtasks(next);
            publishSubtasks(next);
            setNewSubtaskTitle('');
            if (hideBasecampSend) queuePlanBasecampPush(task.id);
        }
        setAddingSubtask(false);
    };

    const handleSubtaskToggle = async (subtask: Task) => {
        const newStatus: TaskStatus = subtask.status === 'done' ? 'todo' : 'done';
        const previous = subtasks;
        const next = previous.map(item => item.id === subtask.id ? { ...item, status: newStatus } : item);
        setSubtasks(next);
        publishSubtasks(next);
        const result = await updateTask(subtask.id, { status: newStatus });
        if (result.success && result.data) {
            const reconciled = next.map(item => item.id === subtask.id ? { ...item, status: result.data!.status } : item);
            setSubtasks(reconciled);
            publishSubtasks(reconciled);
            if (hideBasecampSend) queuePlanBasecampPush(subtask.id);
            return;
        }
        setSubtasks(previous);
        publishSubtasks(previous);
    };

    const handlePostComment = async () => {
        if (!newComment.trim() || !task || !organization) return;
        const currentMember = memberships.find(m => m.organizationId === organization.id);
        setPostingComment(true);
        const result = await createTaskComment({
            organizationId: organization.id,
            taskId: task.id,
            authorId: currentUserId,
            authorName: currentMember ? undefined : 'Unknown',
            body: newComment.trim(),
        });
        if (result.success && result.data) {
            setComments(prev => [...prev, result.data!]);
            setNewComment('');
        }
        setPostingComment(false);
    };

    const handleAssigneeToggle = async (memberId: string) => {
        const next = assigneeIds.includes(memberId)
            ? assigneeIds.filter(id => id !== memberId)
            : [...assigneeIds, memberId];
        const previous = assigneeIds;
        setAssigneeIds(next);
        if (!await save({ assigneeIds: next })) setAssigneeIds(previous);
    };

    const trackingTaskId = task ? timeTrackingTaskId(task) : undefined;
    const isThisTaskRunning = !!trackingTaskId && (runningTimer?.taskId === trackingTaskId || runningTimer?.taskId === task?.id);

    const handleTimerClick = async () => {
        if (!task || !trackingTaskId) return;
        if (isThisTaskRunning && runningTimer) {
            await pause(runningTimer);
        } else if (task.clientId || task.projectId) {
            await startTask({
                clientId: task.clientId ?? task.projectId ?? '',
                clientName: task.clientName ?? 'Unknown',
                taskId: trackingTaskId,
                taskTitle: task.title,
            });
        }
    };

    const setQuickDate = async (offset: number) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        const iso = d.toISOString().slice(0, 10);
        await handleDueDateChange(iso);
    };

    const subtaskProgressView = !task || !subtasksReady
        ? (task?.subtasksState === 'ready' ? listedSubtaskProgress(task) : progressOf(null))
        : subtasksUnavailable
            ? { state: 'unavailable' as const, done: 0, total: 0, label: null, ids: [] as string[] }
            : progressOf(subtasks.map(row => ({ id: row.id, title: row.title, status: row.status })));

    if (!mounted || !task) return null;

    const manualPlacement = workedWindowForEdit({
        segmentCount: 0,
        date: logDate,
        startTime: logStart,
        finishTime: logFinish,
        timeZone: localTimeZone(),
    });
    const hoursLocked = Boolean(manualPlacement.window);
    const hoursValue = manualPlacement.window ? String(manualPlacement.window.hours) : logHours;
    const hoursOk = parseFloat(hoursValue) > 0;

    return (
        <>
            {!embedded && <div className={cn("fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm transition-opacity duration-300", isOpen ? "opacity-100" : "opacity-0 pointer-events-none")} onClick={closePanel} />}

            {/* Slide-over panel */}
            <div
                className={cn(
                    embedded ? "h-full min-h-0 w-full bg-card" : "fixed inset-y-0 right-0 z-[120] w-full max-w-xl bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out",
                    !embedded && (isOpen ? "translate-x-0" : "translate-x-full")
                )}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50 shrink-0">
                        <div className="flex items-center gap-2">
                            {saving && (
                                <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {(task.clientId || task.projectId) && (
                                <button
                                    onClick={handleTimerClick}
                                    title={isThisTaskRunning ? 'Pause timer' : 'Start timer'}
                                    className={cn(
                                        "p-2 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5",
                                        isThisTaskRunning
                                            ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                                            : "hover:bg-muted text-muted-foreground"
                                    )}
                                >
                                    <Clock className="h-4 w-4" />
                                    {isThisTaskRunning ? 'Pause' : 'Start Timer'}
                                </button>
                            )}
                            {confirmDelete ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-red-500 font-medium">Delete this task?</span>
                                    <button
                                        onClick={async () => {
                                            if (!task) return;
                                            await deleteTask(task.id);
                                            onDelete?.(task.id);
                                            onClose();
                                        }}
                                        className="px-2 py-1 text-xs font-medium bg-red-500 text-white rounded-md hover:bg-red-600 transition-colors"
                                    >
                                        Yes, delete
                                    </button>
                                    <button
                                        onClick={() => setConfirmDelete(false)}
                                        className="px-2 py-1 text-xs font-medium bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setConfirmDelete(true)}
                                    className="p-2 hover:bg-red-500/10 rounded-lg text-muted-foreground hover:text-red-500 transition-colors"
                                    title="Delete task"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            )}
                            <button
                                onClick={closePanel}
                                aria-label="Close task details"
                                className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar">
                        {saveError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{saveError}</p>}
                        {/* Title */}
                        <div>
                            <input
                                type="text"
                                disabled={saving}
                                value={title}
                                onChange={e => {
                                    const next = e.target.value;
                                    setTitle(next);
                                    const current = taskRef.current;
                                    if (current) onUpdateRef.current?.(mergeSavedTask(current, { ...current, title: next }));
                                }}
                                onBlur={handleTitleBlur}
                                className="w-full bg-transparent border-none text-xl font-bold p-0 focus:ring-0 placeholder:text-muted-foreground"
                                placeholder="Task title…"
                            />
                            {task.clientName && (
                                <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <Building2 className="h-3.5 w-3.5" />
                                    <span>{task.clientName}</span>
                                </div>
                            )}
                            <LiveUrlControl
                                url={liveUrl}
                                category={category || task.category}
                                prominent
                                onSave={async raw => {
                                    const saved = await saveLiveUrl(task.id, raw);
                                    if (typeof saved === 'string') return saved;
                                    setLiveUrl(saved.publishedUrl);
                                    onUpdate?.(saved);
                                    return null;
                                }}
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label htmlFor={`${fieldId}-description`} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                            <textarea
                                id={`${fieldId}-description`}
                                value={descriptionSave.text}
                                onChange={e => {
                                    const next = e.target.value;
                                    descriptionSave.edit(next);
                                    const current = taskRef.current;
                                    if (current) onUpdateRef.current?.(mergeSavedTask(current, { ...current, description: next }));
                                }}
                                onBlur={() => descriptionSave.flush()}
                                className="w-full bg-transparent border-none text-sm p-0 mt-1 focus:ring-0 resize-none min-h-[80px] placeholder:text-muted-foreground"
                                placeholder="Add details…"
                            />
                            {descriptionSaveLabel(descriptionSave.phase) && (
                                <p role="status" data-description-save={descriptionSave.phase} className="mt-1 text-[11px] text-muted-foreground">
                                    {descriptionSaveLabel(descriptionSave.phase)}
                                    {descriptionSave.phase === 'failed' && (
                                        <>
                                            {' · '}
                                            <button type="button" onClick={() => descriptionSave.retry()} className="font-medium text-primary hover:underline">Retry</button>
                                        </>
                                    )}
                                </p>
                            )}
                        </div>

                        {/* Status & Priority */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`${fieldId}-status`}>Status</label>
                                <div className="relative">
                                    <select
                                        id={`${fieldId}-status`}
                                        data-testid="task-status-field"
                                        disabled={saving}
                                        value={status}
                                        onChange={e => handleStatusChange(e.target.value as TaskStatus)}
                                        className="w-full appearance-none p-2 pr-8 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                    >
                                        {STATUS_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <div className="relative">
                                    <select
                                        disabled={saving}
                                        value={priority}
                                        onChange={e => handlePriorityChange(e.target.value as TaskPriority)}
                                        className="w-full appearance-none p-2 pr-8 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                    >
                                        {PRIORITY_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {status !== 'done' && (
                            <div data-testid="task-blocked-label" className="space-y-2">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Blocked</p>
                                {blockedReason ? (
                                    <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
                                        <p className="text-sm text-foreground">{blockedReason}</p>
                                        <button
                                            type="button"
                                            disabled={saving}
                                            onClick={clearBlockedReason}
                                            className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ) : showBlockedForm ? (
                                    <form onSubmit={saveBlockedReason} className="space-y-2">
                                        <label htmlFor={`${fieldId}-blocked`} className="sr-only">Why is this blocked?</label>
                                        <input
                                            id={`${fieldId}-blocked`}
                                            value={blockedDraft}
                                            disabled={saving}
                                            maxLength={200}
                                            onChange={event => {
                                                setBlockedDraft(event.target.value);
                                                setBlockedError(null);
                                            }}
                                            placeholder="One-line reason"
                                            className="w-full rounded-lg border border-border bg-muted/30 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                        {blockedError && <p className="text-xs text-destructive">{blockedError}</p>}
                                        <div className="flex gap-2">
                                            <button type="submit" disabled={saving} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">Save block</button>
                                            <button type="button" disabled={saving} onClick={() => { setShowBlockedForm(false); setBlockedError(null); }} className="rounded-lg border border-border px-3 py-1.5 text-xs">Cancel</button>
                                        </div>
                                    </form>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={saving}
                                        onClick={() => setShowBlockedForm(true)}
                                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                                    >
                                        Mark blocked
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Category */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">SEO Category</label>
                            <div className="flex flex-wrap gap-2">
                                {CATEGORY_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => handleCategoryChange(category === opt.value ? '' : opt.value)}
                                        className={cn(
                                            "px-3 py-1 rounded-full text-xs font-medium transition-all border",
                                            category === opt.value
                                                ? "bg-primary/15 border-primary text-primary"
                                                : "border-border hover:bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label htmlFor={`${fieldId}-start-date`} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Start date</label>
                                <input id={`${fieldId}-start-date`} type="date" value={startDate} disabled={saving} max={dueDate || undefined} onChange={async event => {
                                    const date = event.target.value;
                                    const error = scheduleDateError(date, dueDate);
                                    if (error) { setSaveError(error); return; }
                                    const previous = startDate;
                                    setStartDate(date);
                                    if (!await save({ startDate: startDateForDay(date, task.startDate) })) setStartDate(previous);
                                }} className="w-full rounded-lg border border-border bg-muted/30 p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
                            </div>
                            <div className="space-y-2">
                                <label htmlFor={`${fieldId}-estimate-hours`} className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Estimate (hours)</label>
                                <input id={`${fieldId}-estimate-hours`} type="number" min="0" step="any" value={estimate} disabled={saving} placeholder="No estimate" onChange={event => setEstimate(event.target.value)} onBlur={async () => {
                                    const parsed = estimateFromInput(estimate);
                                    if (parsed.error) { setSaveError(parsed.error); return; }
                                    if (parsed.value !== (task.estimatedHours ?? null)) await save({ estimatedHours: parsed.value });
                                }} className="w-full rounded-lg border border-border bg-muted/30 p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
                            </div>
                        </div>

                        {/* Due Date */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground" htmlFor={`${fieldId}-due-date`}>Due Date</label>
                            <div className="flex gap-2 mb-2">
                                {[{ label: 'Today', offset: 0 }, { label: 'Tomorrow', offset: 1 }, { label: 'Next Week', offset: 7 }].map(({ label, offset }) => (
                                    <button
                                        key={label}
                                        disabled={saving}
                                        onClick={() => setQuickDate(offset)}
                                        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
                                    >
                                        <Calendar className="h-3 w-3" /> {label}
                                    </button>
                                ))}
                            </div>
                            <input
                                type="date"
                                id={`${fieldId}-due-date`}
                                min={startDate || undefined}
                                disabled={saving}
                                value={dueDate}
                                onChange={e => handleDueDateChange(e.target.value)}
                                className="w-full bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                            />
                        </div>

                        {/* Assignees */}
                        {orgMembers.length > 0 && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <UserCircle2 className="h-3 w-3" /> Assigned To
                                </label>
                                <div className="flex flex-wrap gap-2">
                                    {orgMembers.map(m => {
                                        const selected = assigneeIds.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                disabled={saving}
                                                onClick={() => handleAssigneeToggle(m.id)}
                                                className={cn(
                                                    'px-3 py-1.5 rounded-full text-xs border transition-all',
                                                    selected
                                                        ? 'bg-primary/15 border-primary text-primary font-semibold'
                                                        : 'border-border hover:bg-muted text-muted-foreground hover:text-foreground',
                                                )}
                                            >
                                                {m.name.split(' ')[0]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Tags */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</label>
                            <div className="flex flex-wrap gap-2 items-center">
                                {tags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => handleRemoveTag(tag)}
                                        className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-600 text-[10px] border border-yellow-500/20 font-bold uppercase tracking-tight hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-colors group"
                                        title="Click to remove"
                                    >
                                        {tag} <span className="opacity-0 group-hover:opacity-100">×</span>
                                    </button>
                                ))}
                                <div className="flex items-center gap-1">
                                    <input
                                        type="text"
                                        value={newTag}
                                        onChange={e => setNewTag(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                                        placeholder="Add tag…"
                                        className="text-[11px] bg-muted/40 border border-dashed border-border rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    {newTag && (
                                        <button onClick={handleAddTag} className="text-[10px] text-primary hover:underline">Add</button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Subtasks */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <CheckSquare className="h-3 w-3" /> Subtasks
                                <SubtaskProgressText progress={subtaskProgressView} className="ml-1 font-normal normal-case tracking-normal text-muted-foreground" />
                            </label>
                            {subtasks.length > 0 && (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">These chores stay under this task and do not each need a plan row.</p>
                            )}
                            <div className="space-y-2">
                                {subtasks.map(sub => (
                                    <div key={sub.id} className="flex items-center gap-3 group">
                                        <button
                                            type="button"
                                            role="checkbox"
                                            aria-checked={sub.status === 'done'}
                                            aria-label={sub.status === 'done' ? `Mark "${sub.title}" not done` : `Mark "${sub.title}" done`}
                                            onClick={() => { void handleSubtaskToggle(sub); }}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
                                            }}
                                            className={cn(
                                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                                sub.status === 'done' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-transparent',
                                            )}
                                        >
                                            {sub.status === 'done' && <Check className="h-3 w-3" strokeWidth={3} />}
                                        </button>
                                        <div className="min-w-0 flex-1">
                                            <span className={cn(
                                                "text-sm",
                                                sub.status === 'done' && "line-through text-muted-foreground"
                                            )}>
                                                {sub.title}
                                            </span>
                                            <LiveUrlControl
                                                url={sub.publishedUrl}
                                                category={sub.category ?? category}
                                                onSave={async raw => {
                                                    const saved = await saveLiveUrl(sub.id, raw);
                                                    if (typeof saved === 'string') return saved;
                                                    setSubtasks(prev => prev.map(item => item.id === sub.id ? saved : item));
                                                    return null;
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="text"
                                        value={newSubtaskTitle}
                                        onChange={e => setNewSubtaskTitle(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
                                        placeholder="Add subtask…"
                                        className="text-sm bg-muted/30 border border-dashed border-border rounded-lg px-3 py-1.5 flex-1 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                                    />
                                    {newSubtaskTitle && (
                                        <button
                                            onClick={handleAddSubtask}
                                            disabled={addingSubtask}
                                            className="p-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/*
                          Only when this client takes Basecamp to-dos and this
                          task has none. A task that already synced says nothing.
                        */}
                        {!hideBasecampSend && basecampTodoTarget && !task.basecampTodoId && (
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <RefreshCw className="h-3 w-3" /> Basecamp
                                </label>
                                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                                    <span className="text-[11px] text-muted-foreground">Not in Basecamp</span>
                                    <button
                                        type="button"
                                        onClick={() => void handlePushTodo()}
                                        disabled={pushingTodo}
                                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
                                    >
                                        <RefreshCw className={cn('h-3 w-3', pushingTodo && 'animate-spin')} />
                                        {pushingTodo ? 'Sending' : 'Send to Basecamp'}
                                    </button>
                                </div>
                                {todoPushOutcome && todoPushOutcome !== 'pushed' && (
                                    <p className="text-[11px] leading-relaxed text-destructive">
                                        {PUSH_OUTCOME_MESSAGE[todoPushOutcome]}
                                    </p>
                                )}
                                {subtaskNestNote && (
                                    <p className="text-[11px] leading-relaxed text-muted-foreground">{subtaskNestNote}</p>
                                )}
                            </div>
                        )}

                        {/* Time Log */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> Time Logged
                                </label>
                                <button
                                    onClick={() => {
                                        setShowLogForm(v => !v);
                                        setLogHours('');
                                        setLogStart('');
                                        setLogFinish('');
                                        setLogNote('');
                                        setLogFormError('');
                                        setLogDate(new Date().toISOString().slice(0, 10));
                                    }}
                                    className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                                >
                                    <PenLine className="h-3 w-3" /> Log time manually
                                </button>
                            </div>
                            {(subtasks.length > 0 || timeTrackingTaskId(task) !== task.id) && (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">{PILLAR_TIME_BEHAVIOR}</p>
                            )}

                            {/* Summary */}
                            {loggedHours > 0 ? (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
                                        <Clock className="h-5 w-5 text-muted-foreground" />
                                        <p className="text-sm font-semibold">{loggedHours.toFixed(1)}h logged</p>
                                    </div>
                                    {timeLogs.slice(0, 5).map(log => (
                                        <TaskTimeLogRow
                                            key={log.id}
                                            log={log}
                                            loggerName={orgMembers.find(m => m.id === log.userId)?.name}
                                            retrying={retryingLogId === log.id}
                                            onRetryBasecamp={handleRetryBasecamp}
                                            basecampAvailable={basecampAvailable}
                                        />
                                    ))}
                                    {timeLogs.length > 5 && (
                                        <p className="text-[11px] text-muted-foreground">
                                            Showing the 5 most recent of {timeLogs.length} entries.
                                        </p>
                                    )}
                                </div>
                            ) : !showLogForm ? (
                                <div className="border border-dashed border-border rounded-xl py-6 flex flex-col items-center justify-center text-muted-foreground gap-2">
                                    <Clock className="h-6 w-6 opacity-20" />
                                    <p className="text-xs italic">No time logged yet</p>
                                </div>
                            ) : null}

                            {/* Manual entry form */}
                            {showLogForm && (
                                <div className="border border-border rounded-xl p-4 space-y-3 bg-muted/20">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <label htmlFor="task-log-start" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Start time</label>
                                            <input
                                                id="task-log-start"
                                                type="time"
                                                step={60}
                                                value={logStart}
                                                onChange={e => { setLogStart(e.target.value); setLogFormError(''); }}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label htmlFor="task-log-finish" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Finish time</label>
                                            <input
                                                id="task-log-finish"
                                                type="time"
                                                step={60}
                                                value={logFinish}
                                                onChange={e => { setLogFinish(e.target.value); setLogFormError(''); }}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[11px] text-muted-foreground">Optional. Both times place this work on the planner. Leave them blank to record hours only.</p>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <label htmlFor="task-log-hours" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hours</label>
                                            <input
                                                id="task-log-hours"
                                                type="number"
                                                min="0.01"
                                                step="0.01"
                                                placeholder="e.g. 1.5"
                                                value={hoursValue}
                                                readOnly={hoursLocked}
                                                onChange={e => setLogHours(e.target.value)}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary read-only:bg-muted/40"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label htmlFor="task-log-date" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</label>
                                            <input
                                                id="task-log-date"
                                                type="date"
                                                value={logDate}
                                                onChange={e => setLogDate(e.target.value)}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label htmlFor="task-log-note" className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Note (optional)</label>
                                        <input
                                            id="task-log-note"
                                            type="text"
                                            placeholder="What did you work on?"
                                            value={logNote}
                                            onChange={e => setLogNote(e.target.value)}
                                            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                    {(manualPlacement.error || logFormError) && (
                                        <p className="text-[11px] text-destructive">{manualPlacement.error || logFormError}</p>
                                    )}
                                    <div className="flex items-center gap-2 justify-end">
                                        <button
                                            onClick={() => setShowLogForm(false)}
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            disabled={!hoursOk || Boolean(manualPlacement.error) || submittingLog || !task.clientId}
                                            onClick={async () => {
                                                if (!task.clientId || !organization || manualPlacement.error || !hoursOk) return;
                                                setSubmittingLog(true);
                                                setLogFormError('');
                                                const currentMember = memberships.find(m => m.organizationId === organization.id);
                                                const result = await createTimeLog({
                                                    organizationId: organization.id,
                                                    clientId: task.clientId,
                                                    taskId: timeTrackingTaskId(task),
                                                    userId: currentUserId ?? currentMember?.userId,
                                                    hours: manualPlacement.window?.hours ?? parseFloat(hoursValue),
                                                    date: logDate,
                                                    description: logNote || undefined,
                                                    billable: true,
                                                }, {
                                                    syncToBasecamp: basecampAvailable,
                                                    workedWindow: manualPlacement.window,
                                                });
                                                if (result.success) {
                                                    void loadTaskData();
                                                    if (result.segmentWarning) {
                                                        setLogFormError(result.segmentWarning);
                                                    } else {
                                                        setShowLogForm(false);
                                                        setLogHours('');
                                                        setLogStart('');
                                                        setLogFinish('');
                                                        setLogNote('');
                                                    }
                                                } else {
                                                    setLogFormError(result.error || 'Could not save this entry.');
                                                }
                                                setSubmittingLog(false);
                                            }}
                                            className="px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                                        >
                                            {submittingLog ? 'Saving…' : 'Save Entry'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Comments */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" /> Comments
                                {comments.length > 0 && <span className="ml-1 text-muted-foreground">({comments.length})</span>}
                            </label>

                            {/* Existing comments */}
                            {comments.length > 0 && (
                                <div className="space-y-4">
                                    {comments.map(c => (
                                        <div key={c.id} className="flex gap-3">
                                            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                                {(c.authorName ?? 'U').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-bold">{c.authorName ?? 'Team member'}</span>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-foreground whitespace-pre-wrap">{c.body}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* New comment */}
                            <div className="bg-muted/30 border border-border rounded-lg p-3">
                                <textarea
                                    className="w-full bg-transparent border-none text-sm p-0 focus:ring-0 resize-none min-h-[60px] placeholder:text-muted-foreground"
                                    placeholder="Add a comment…"
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePostComment();
                                    }}
                                />
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-[10px] text-muted-foreground">⌘+Enter to post</span>
                                    <button
                                        onClick={handlePostComment}
                                        disabled={!newComment.trim() || postingComment}
                                        className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                                    >
                                        {postingComment ? 'Posting…' : 'Post Comment'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {showCompletion && (
                        <TaskCompletionDrawer
                            task={task}
                            trackedHours={loggedHours}
                            hasOpenAttempt={Boolean(openAttempt)}
                            isLoadingTime={loadingTaskTime}
                            isSubmitting={completing}
                            error={completionError}
                            onClose={() => {
                                setShowCompletion(false);
                                setCompletionError(null);
                            }}
                            onComplete={minutes => void completeTask(minutes)}
                            onStopAndReview={() => void stopAndComplete()}
                        />
                    )}
                </div>
            </div>

            {completionReviewAttemptId && (
                <StopConfirmSheet
                    attemptId={completionReviewAttemptId}
                    defaultMarkTaskComplete
                    onClose={() => void finishStopReview()}
                />
            )}
        </>
    );
}
