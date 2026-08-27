'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Clock, Calendar, Tag, CheckSquare, MessageSquare, ChevronDown, Trash2, Plus, UserCircle2, PenLine, RefreshCw, Building2 } from 'lucide-react';
import {
    createTimeLog,
    getClientTimesheetSyncEnabled,
    getTaskTimeLogs,
    logTaskCompletionTime,
    retryTimeLogBasecampSync,
} from '@/lib/supabase/time-logs';
import { cn } from '@/lib/utils';
import { Task, TaskComment, TaskStatus, TaskPriority, TaskCategory, TimerAttempt } from '@/lib/types';
import { getTask, updateTask, createTask, deleteTask, getTaskComments, createTaskComment } from '@/lib/supabase/tasks';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';
import { groupSegmentsForDisplay, sumActiveSeconds } from '@/lib/timer/segments';
import { timeLogSyncState, canPushToBasecamp } from '@/lib/timesheets/log-sync-state';
import { completeTaskWithReconciliation } from '@/lib/tasks/task-completion';
import { TaskCompletionDrawer } from './TaskCompletionDrawer';
import { StopConfirmSheet } from '@/components/timer/StopConfirmSheet';

interface TaskDetailModalProps {
    task: Task | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate?: (task: Task) => void;
    onDelete?: (taskId: string) => void;
    currentUserId?: string;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'blocked', label: 'Blocked' },
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

export function TaskDetailModal({ task, isOpen, onClose, onUpdate, onDelete, currentUserId }: TaskDetailModalProps) {
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
    const [subtasks, setSubtasks] = useState<Task[]>([]);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [addingSubtask, setAddingSubtask] = useState(false);

    // Local editable state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [dueDate, setDueDate] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [orgMembers, setOrgMembers] = useState<{ id: string; name: string }[]>([]);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [showLogForm, setShowLogForm] = useState(false);
    const [logHours, setLogHours] = useState('');
    const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
    const [logNote, setLogNote] = useState('');
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
        setDescription(task.description ?? '');
        setStatus(task.status ?? 'todo');
        setPriority(task.priority ?? 'medium');
        setCategory((task.category as TaskCategory) ?? '');
        setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '');
        setTags(task.tags ?? []);
        setAssigneeIds(task.assigneeIds ?? []);
        setLoggedHours(0);
        setTimeLogs([]);
        setLoadingTaskTime(true);
        setShowCompletion(false);
        setCompletionError(null);
        completionOperationId.current = null;
    }, [task?.id]);

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
    const loadTaskData = useCallback(async () => {
        if (!task) return;
        setLoadingTaskTime(true);
        try {
            const [commentsData, taskData, logs] = await Promise.all([
                getTaskComments(task.id),
                getTask(task.id),
                getTaskTimeLogs(task.id),
            ]);
            setComments(commentsData);
            setLoggedHours(taskData.loggedHours);
            setSubtasks(taskData.subtasks);
            setTimeLogs(logs);
        } finally {
            setLoadingTaskTime(false);
        }
    }, [task?.id]);

    useEffect(() => {
        if (!task?.clientId) { setBasecampAvailable(false); return; }
        let cancelled = false;
        void getClientTimesheetSyncEnabled(task.clientId).then(on => {
            if (!cancelled) setBasecampAvailable(on);
        });
        return () => { cancelled = true; };
    }, [task?.clientId]);

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
        if (isOpen && task) loadTaskData();
    }, [isOpen, task?.id]);

    // Confirmed time must appear here as soon as a Stop confirmation lands.
    useEffect(() => {
        if (!isOpen || !task) return;
        const refresh = () => { void loadTaskData(); };
        window.addEventListener('timer:data-changed', refresh);
        return () => window.removeEventListener('timer:data-changed', refresh);
    }, [isOpen, task?.id, loadTaskData]);

    const save = useCallback(async (patch: Parameters<typeof updateTask>[1]) => {
        if (!task) return;
        setSaving(true);
        const result = await updateTask(task.id, { ...patch, updatedBy: currentUserId });
        setSaving(false);
        if (result.success && result.data) {
            onUpdate?.(result.data);
        }
    }, [task?.id, currentUserId, onUpdate]);

    const handleStatusChange = async (newStatus: TaskStatus) => {
        if (newStatus === 'done' && status !== 'done') {
            setCompletionError(null);
            setShowCompletion(true);
            return;
        }
        setStatus(newStatus);
        await save({ status: newStatus });
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
        setShowCompletion(false);
        completionOperationId.current = null;
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
            onUpdate?.(refreshed.task);
        }
        await loadTaskData();
    };

    const handlePriorityChange = async (newPriority: TaskPriority) => {
        setPriority(newPriority);
        await save({ priority: newPriority });
    };

    const handleTitleBlur = async () => {
        if (title !== task?.title) await save({ title });
    };

    const handleDescriptionBlur = async () => {
        if (description !== task?.description) await save({ description });
    };

    const handleDueDateChange = async (date: string) => {
        setDueDate(date);
        await save({ dueDate: date || undefined });
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
            setSubtasks(prev => [...prev, result.data!]);
            setNewSubtaskTitle('');
        }
        setAddingSubtask(false);
    };

    const handleSubtaskToggle = async (subtask: Task) => {
        const newStatus: TaskStatus = subtask.status === 'done' ? 'todo' : 'done';
        const result = await updateTask(subtask.id, { status: newStatus });
        if (result.success && result.data) {
            setSubtasks(prev => prev.map(s => s.id === subtask.id ? result.data! : s));
        }
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
        setAssigneeIds(next);
        await save({ assigneeIds: next });
    };

    const isThisTaskRunning = runningTimer?.taskId === task?.id;

    const handleTimerClick = async () => {
        if (!task) return;
        if (isThisTaskRunning && runningTimer) {
            await pause(runningTimer);
        } else if (task.clientId || task.projectId) {
            await startTask({
                clientId: task.clientId ?? task.projectId ?? '',
                clientName: task.clientName ?? 'Unknown',
                taskId: task.id,
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

    if (!mounted || !task) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Slide-over panel */}
            <div
                className={cn(
                    "fixed inset-y-0 right-0 z-[120] w-full max-w-xl bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
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
                                onClick={onClose}
                                className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar">
                        {/* Title */}
                        <div>
                            <input
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
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
                        </div>

                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                onBlur={handleDescriptionBlur}
                                className="w-full bg-transparent border-none text-sm p-0 mt-1 focus:ring-0 resize-none min-h-[80px] placeholder:text-muted-foreground"
                                placeholder="Add details…"
                            />
                        </div>

                        {/* Status & Priority */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                                <div className="relative">
                                    <select
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

                        {/* Due Date */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <div className="flex gap-2 mb-2">
                                {[{ label: 'Today', offset: 0 }, { label: 'Tomorrow', offset: 1 }, { label: 'Next Week', offset: 7 }].map(({ label, offset }) => (
                                    <button
                                        key={label}
                                        onClick={() => setQuickDate(offset)}
                                        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
                                    >
                                        <Calendar className="h-3 w-3" /> {label}
                                    </button>
                                ))}
                            </div>
                            <input
                                type="date"
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
                                {subtasks.length > 0 && (
                                    <span className="ml-1 text-muted-foreground">
                                        ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})
                                    </span>
                                )}
                            </label>
                            <div className="space-y-2">
                                {subtasks.map(sub => (
                                    <div key={sub.id} className="flex items-center gap-3 group">
                                        <input
                                            type="checkbox"
                                            checked={sub.status === 'done'}
                                            onChange={() => handleSubtaskToggle(sub)}
                                            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                                        />
                                        <span className={cn(
                                            "text-sm flex-1",
                                            sub.status === 'done' && "line-through text-muted-foreground"
                                        )}>
                                            {sub.title}
                                        </span>
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

                        {/* Time Log */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> Time Logged
                                </label>
                                <button
                                    onClick={() => { setShowLogForm(v => !v); setLogHours(''); setLogNote(''); setLogDate(new Date().toISOString().slice(0, 10)); }}
                                    className="flex items-center gap-1 text-[10px] text-primary hover:underline"
                                >
                                    <PenLine className="h-3 w-3" /> Log time manually
                                </button>
                            </div>

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
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Hours</label>
                                            <input
                                                type="number"
                                                min="0.1"
                                                step="0.25"
                                                placeholder="e.g. 1.5"
                                                value={logHours}
                                                onChange={e => setLogHours(e.target.value)}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date</label>
                                            <input
                                                type="date"
                                                value={logDate}
                                                onChange={e => setLogDate(e.target.value)}
                                                className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Note (optional)</label>
                                        <input
                                            type="text"
                                            placeholder="What did you work on?"
                                            value={logNote}
                                            onChange={e => setLogNote(e.target.value)}
                                            className="w-full text-sm bg-background border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 justify-end">
                                        <button
                                            onClick={() => setShowLogForm(false)}
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            disabled={!logHours || parseFloat(logHours) <= 0 || submittingLog || !task.clientId}
                                            onClick={async () => {
                                                if (!task.clientId || !organization) return;
                                                setSubmittingLog(true);
                                                const currentMember = memberships.find(m => m.organizationId === organization.id);
                                                const result = await createTimeLog({
                                                    organizationId: organization.id,
                                                    clientId: task.clientId,
                                                    taskId: task.id,
                                                    userId: currentUserId ?? currentMember?.userId,
                                                    hours: parseFloat(logHours),
                                                    date: logDate,
                                                    description: logNote || undefined,
                                                    billable: true,
                                                }, { syncToBasecamp: basecampAvailable });
                                                if (result.success) {
                                                    void loadTaskData();
                                                    setShowLogForm(false);
                                                    setLogHours('');
                                                    setLogNote('');
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
