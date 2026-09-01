'use client';

import { useState, useEffect } from 'react';
import {
    X, Plus, LayoutTemplate, UserCircle2, Bell, ListChecks, Trash2,
    CheckCircle2, AlertCircle, RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, TaskPriority, TaskStatus, TaskCategory, TaskTemplate, ClientProject } from '@/lib/types';
import { createTaskFromTemplate, createTask, type TaskInsert } from '@/lib/supabase/tasks';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { RecurrenceSelector } from './RecurrenceSelector';
import { createClient } from '@/lib/supabase/client';
import {
    createTimeLog,
    getTimeLogForPlannerEvent,
    reconcilePlannerEventTimeLog,
} from '@/lib/supabase/time-logs';
import { updatePlannerEvent } from '@/lib/supabase/planner-events';
import {
    convertPlannerEventToTask,
    type EventTaskConversionResult,
} from '@/lib/planner/event-task-conversion';
import {
    requestTaskBasecampSync,
    requestTimeLogBasecampSync,
} from '@/lib/basecamp/client-sync';
import { EventConversionFields } from './EventConversionFields';

type ClientOption = Pick<ClientProject, 'id' | 'clientName'>;
const EMPTY_CLIENT_OPTIONS: ClientOption[] = [];

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (task: Task) => void;
    organizationId: string;
    currentUserId?: string;
    /** Pre-fill these when opened from a client context */
    defaultClientId?: string;
    defaultClientName?: string;
    defaultProjectId?: string;
    /** Pre-fill due date (e.g., when clicking a calendar cell) */
    defaultDueDate?: string;
    /** Pre-fill the title (e.g., handed over from the planner's quick-create) */
    defaultTitle?: string;
    /** Pre-fill notes when creating a task from another work item. */
    defaultDescription?: string;
    defaultAssigneeIds?: string[];
    /** Pre-fill the scheduled block when opened from the planner grid */
    defaultStartDate?: string;
    defaultScheduledMinutes?: number;
    /** Pre-fill all fields from a template */
    templatePrefill?: TaskTemplate;
    /** Available only when a source flow needs a client to finish conversion. */
    clients?: ClientOption[];
    /** Original event context used to link the task and optionally log its block. */
    eventConversion?: {
        id: string;
        userId: string;
        title: string;
        startsAt: string;
        endsAt: string;
    };
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical SEO' },
    { value: 'local', label: 'Local SEO' },
    { value: 'links', label: 'Link Building' },
    { value: 'reporting', label: 'Reporting' },
    { value: 'admin', label: 'Admin' },
];

export function CreateTaskModal({
    isOpen,
    onClose,
    onCreated,
    organizationId,
    currentUserId,
    defaultClientId,
    defaultClientName,
    defaultProjectId,
    defaultDueDate,
    defaultTitle,
    defaultDescription,
    defaultAssigneeIds,
    defaultStartDate,
    defaultScheduledMinutes,
    templatePrefill,
    clients = EMPTY_CLIENT_OPTIONS,
    eventConversion,
}: CreateTaskModalProps) {
    const hasEventConversion = Boolean(eventConversion?.id);
    const [orgMembers, setOrgMembers] = useState<{ id: string; name: string }[]>([]);
    const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
    const [watcherIds, setWatcherIds] = useState<string[]>([]);
    const [subtaskTitles, setSubtaskTitles] = useState<string[]>([]);
    const [subtaskInput, setSubtaskInput] = useState('');

    // Fetch org members once per modal session
    useEffect(() => {
        if (!isOpen || !organizationId || orgMembers.length > 0) return;
        getOrganizationMembers(organizationId).then(members => {
            setOrgMembers(members.map(m => ({
                id: m.userId,
                name: (m.user as any)?.fullName || (m.user as any)?.email || 'Team member',
            })));
        }).catch(() => {});
    }, [isOpen, organizationId, orgMembers.length]);

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [dueDate, setDueDate] = useState(defaultDueDate ?? '');
    const [recurrence, setRecurrence] = useState<Task['recurrence']>(undefined);
    const [status] = useState<TaskStatus>('todo');
    const [syncToBasecamp, setSyncToBasecamp] = useState(false);
    const [clientHasBasecamp, setClientHasBasecamp] = useState(false);
    const [bcProjectId, setBcProjectId] = useState('');
    const [bcDefaultTodolistId, setBcDefaultTodolistId] = useState('');
    const [bcTodolistId, setBcTodolistId] = useState('');
    const [bcTodolists, setBcTodolists] = useState<{ id: number; title: string; name: string }[]>([]);
    const [bcLoadingLists, setBcLoadingLists] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState(defaultClientId ?? '');
    const [clientSearch, setClientSearch] = useState(defaultClientName ?? '');
    const [logEventTime, setLogEventTime] = useState(hasEventConversion);
    const [countsTowardBudget, setCountsTowardBudget] = useState(true);
    const [syncTimeToBasecamp, setSyncTimeToBasecamp] = useState(hasEventConversion);
    const [conversionResult, setConversionResult] = useState<EventTaskConversionResult | null>(null);

    // Sync fields when modal opens or template/date changes
    useEffect(() => {
        if (isOpen) {
            setDueDate(defaultDueDate ?? '');
            setAssigneeIds(defaultAssigneeIds ?? []);
            setWatcherIds([]);
            setSubtaskTitles([]);
            setSubtaskInput('');
            setSelectedClientId(defaultClientId ?? '');
            setClientSearch(defaultClientName ?? '');
            setLogEventTime(hasEventConversion);
            setCountsTowardBudget(true);
            setSyncTimeToBasecamp(hasEventConversion);
            setConversionResult(null);
            setError('');
            if (templatePrefill) {
                setTitle(templatePrefill.name);
                setDescription(templatePrefill.description ?? '');
                setPriority(templatePrefill.priority ?? 'medium');
                setCategory(templatePrefill.category ?? '');
                setRecurrence(templatePrefill.recurrence);
            } else {
                setTitle(defaultTitle ?? '');
                setDescription(defaultDescription ?? '');
                setPriority('medium');
                setCategory('');
                setRecurrence(undefined);
            }
        }
    }, [
        isOpen,
        defaultAssigneeIds,
        defaultClientId,
        defaultClientName,
        defaultDescription,
        defaultDueDate,
        defaultTitle,
        hasEventConversion,
        templatePrefill,
    ]);

    const addSubtask = () => {
        const title = subtaskInput.trim();
        if (!title) return;
        setSubtaskTitles(current => [...current, title]);
        setSubtaskInput('');
    };

    // Check if the selected client has Basecamp sync enabled (project required, todolist optional)
    useEffect(() => {
        let cancelled = false;
        if (!selectedClientId) {
            setClientHasBasecamp(false);
            setSyncToBasecamp(false);
            setBcProjectId('');
            setBcDefaultTodolistId('');
            setBcTodolistId('');
            setBcTodolists([]);
            return () => { cancelled = true; };
        }
        const supabase = createClient();
        if (!supabase) return;
        supabase
            .from('clients')
            .select('custom_fields')
            .eq('id', selectedClientId)
            .single()
            .then(({ data }: { data: any }) => {
                if (cancelled) return;
                const cf = (data?.custom_fields as Record<string, unknown>) ?? {};
                const enabled = !!(cf.basecamp_sync_enabled && cf.basecamp_project_id);
                setClientHasBasecamp(enabled);
                if (enabled) {
                    const projectId = String(cf.basecamp_project_id ?? '');
                    const defaultListId = String(cf.basecamp_todolist_id ?? '');
                    setBcProjectId(projectId);
                    setBcDefaultTodolistId(defaultListId);
                    setBcTodolistId(defaultListId);
                    if (hasEventConversion) setSyncToBasecamp(true);
                } else {
                    setSyncToBasecamp(false);
                    setBcProjectId('');
                    setBcDefaultTodolistId('');
                    setBcTodolistId('');
                    setBcTodolists([]);
                }
            })
            .catch(() => {
                if (cancelled) return;
                setClientHasBasecamp(false);
                setSyncToBasecamp(false);
            });
        return () => { cancelled = true; };
    }, [hasEventConversion, selectedClientId]);

    function handleSyncToggle() {
        const next = !syncToBasecamp;
        setSyncToBasecamp(next);
        if (next && bcProjectId && bcTodolists.length === 0 && !bcLoadingLists) {
            setBcLoadingLists(true);
            fetch(`/api/integrations/basecamp/todolists?organizationId=${encodeURIComponent(organizationId)}&projectId=${bcProjectId}`)
                .then(r => r.json())
                .then(d => { if (d.todolists) setBcTodolists(d.todolists); })
                .catch(() => {})
                .finally(() => setBcLoadingLists(false));
        }
    }

    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const selectedClientName = clients.find(client => client.id === selectedClientId)?.clientName
        ?? (selectedClientId === defaultClientId ? defaultClientName : undefined);
    const eventDurationMinutes = eventConversion
        ? Math.max(1, Math.round(
            (new Date(eventConversion.endsAt).getTime() - new Date(eventConversion.startsAt).getTime()) / 60_000,
        ))
        : 0;

    function handleClientSearchChange(value: string) {
        setClientSearch(value);
        const normalized = value.trim().toLocaleLowerCase();
        const match = clients.find(client => client.clientName.toLocaleLowerCase() === normalized);
        setSelectedClientId(match?.id ?? '');
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) { setError('Title is required'); return; }
        if (!organizationId) { setError('Organization not found'); return; }
        if (eventConversion && !selectedClientId) {
            setError('Select a client before creating this task.');
            return;
        }
        setSaving(true);
        setError('');

        const overrides: TaskInsert = {
            organizationId,
            projectId: defaultProjectId,
            clientId: selectedClientId || undefined,
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            status,
            category: category as TaskCategory || undefined,
            dueDate: dueDate || undefined,
            // Carried over when the planner hands a drafted time block to this modal.
            startDate: defaultStartDate || undefined,
            scheduledMinutes: defaultScheduledMinutes,
            createdBy: currentUserId,
            actorName: orgMembers.find(m => m.id === currentUserId)?.name,
            assigneeIds: assigneeIds.length > 0 ? assigneeIds : undefined,
            watcherIds: watcherIds.length > 0 ? watcherIds : undefined,
            subtaskTitles: subtaskTitles.length > 0 ? subtaskTitles : undefined,
            recurrence: recurrence || undefined,
            syncToBasecamp: clientHasBasecamp ? syncToBasecamp : false,
            basecampTodolistId: (clientHasBasecamp && syncToBasecamp && bcTodolistId) ? bcTodolistId : undefined,
        };

        if (eventConversion) {
            let createdTask: Task | undefined;
            const conversion = await convertPlannerEventToTask({
                event: {
                    id: eventConversion.id,
                    organizationId,
                    userId: currentUserId || eventConversion.userId,
                    title: eventConversion.title,
                    startsAt: eventConversion.startsAt,
                    endsAt: eventConversion.endsAt,
                },
                task: overrides,
                clientName: selectedClientName ?? '',
                syncTaskToBasecamp: clientHasBasecamp && syncToBasecamp,
                logEventTime,
                countsTowardBudget,
                syncTimeToBasecamp: clientHasBasecamp && syncTimeToBasecamp,
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            }, {
                createTask: async taskInput => {
                    const result = await createTask(taskInput as TaskInsert);
                    createdTask = result.data;
                    return result;
                },
                linkEvent: async (eventId, patch) => Boolean(await updatePlannerEvent(eventId, patch)),
                findEventTimeLog: getTimeLogForPlannerEvent,
                reconcileEventTimeLog: (timeLogId, patch) => reconcilePlannerEventTimeLog(
                    timeLogId,
                    patch as Parameters<typeof reconcilePlannerEventTimeLog>[1],
                ),
                syncTimeLog: requestTimeLogBasecampSync,
                createTimeLog: (log, options) => createTimeLog(
                    log as Parameters<typeof createTimeLog>[0],
                    options,
                ),
            });

            setSaving(false);
            if (conversion.status === 'failed' || !createdTask) {
                setError(conversion.status === 'failed' ? conversion.error : 'Failed to create task.');
                return;
            }
            onCreated({ ...createdTask, clientName: selectedClientName ?? createdTask.clientName });
            setConversionResult(conversion);
            return;
        }

        const result = templatePrefill
            ? await createTaskFromTemplate(templatePrefill.id, overrides)
            : await createTask(overrides);

        setSaving(false);
        if (result.success && result.data) {
            onCreated({ ...result.data, clientName: selectedClientName ?? result.data.clientName });
            onClose();
        } else {
            setError(result.error ?? 'Failed to create task');
        }
    };

    async function retryConversionSync() {
        if (!conversionResult || conversionResult.status === 'failed') return;
        setSaving(true);
        let taskBasecampSynced = conversionResult.taskBasecampSynced;
        let taskBasecampError = conversionResult.taskBasecampError;
        let eventLinked = conversionResult.eventLinked;
        let timeBasecampSynced = conversionResult.timeBasecampSynced;
        let timeError = conversionResult.timeError;

        if (syncToBasecamp && !taskBasecampSynced) {
            const result = await requestTaskBasecampSync(conversionResult.taskId);
            taskBasecampSynced = result.success;
            taskBasecampError = result.error;
        }
        if (!eventLinked && eventConversion && selectedClientId) {
            eventLinked = Boolean(await updatePlannerEvent(eventConversion.id, {
                clientId: selectedClientId,
                taskId: conversionResult.taskId,
            }));
        }
        if (syncTimeToBasecamp && conversionResult.timeLogId && !timeBasecampSynced) {
            const result = await requestTimeLogBasecampSync(conversionResult.timeLogId);
            timeBasecampSynced = result.success;
            timeError = result.error;
        }

        const partial = !taskBasecampSynced || !eventLinked || Boolean(timeError);
        setConversionResult({
            ...conversionResult,
            status: partial ? 'partial' : 'complete',
            taskBasecampSynced,
            taskBasecampError,
            eventLinked,
            timeBasecampSynced,
            timeError,
        });
        setSaving(false);
    }

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[130] bg-background/80 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed z-[140] inset-0 flex items-center justify-center p-4">
                <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="font-bold text-foreground flex items-center gap-2">
                            <Plus className="h-4 w-4" /> New Task
                        </h3>
                        <div className="flex items-center gap-2">
                            {templatePrefill && (
                                <span className="flex items-center gap-1 text-xs text-primary bg-primary/10 px-2 py-1 rounded-full">
                                    <LayoutTemplate className="h-3 w-3" />
                                    {templatePrefill.name}
                                </span>
                            )}
                            {selectedClientName && (
                                <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">{selectedClientName}</span>
                            )}
                        </div>
                        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {conversionResult && conversionResult.status !== 'failed' ? (
                        <div className="space-y-4 overflow-y-auto p-5">
                            <div className={cn(
                                'rounded-xl border p-4',
                                conversionResult.status === 'complete'
                                    ? 'border-emerald-500/30 bg-emerald-500/5'
                                    : 'border-amber-500/30 bg-amber-500/5',
                            )}>
                                <div className="flex items-start gap-3">
                                    {conversionResult.status === 'complete' ? (
                                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                                    ) : (
                                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                                    )}
                                    <div className="space-y-1">
                                        <h4 className="text-sm font-semibold">
                                            {conversionResult.status === 'complete'
                                                ? `Task created for ${selectedClientName}`
                                                : `Task created for ${selectedClientName}, with follow-up needed`}
                                        </h4>
                                        <p className="text-xs text-muted-foreground">
                                            {conversionResult.taskBasecampSynced
                                                ? 'Task synced to the client’s Basecamp to-do list.'
                                                : conversionResult.taskBasecampError ?? 'Task was not synced to Basecamp.'}
                                        </p>
                                        {logEventTime && (
                                            <p className="text-xs text-muted-foreground">
                                                {conversionResult.timeLogged || conversionResult.timeAlreadyLogged
                                                    ? `${eventDurationMinutes} minutes logged${conversionResult.timeBasecampSynced ? ' and synced to the Basecamp timesheet' : ''}.`
                                                    : conversionResult.timeError ?? 'The event time was not logged.'}
                                            </p>
                                        )}
                                        {!conversionResult.eventLinked && (
                                            <p className="text-xs text-destructive">The event still needs to be linked to the task.</p>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end gap-3">
                                {conversionResult.status === 'partial' && (
                                    <button
                                        type="button"
                                        onClick={() => void retryConversionSync()}
                                        disabled={saving}
                                        className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
                                    >
                                        <RotateCcw className="h-4 w-4" />
                                        {saving ? 'Retrying…' : 'Retry Basecamp sync'}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="min-h-10 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                                >
                                    Done
                                </button>
                            </div>
                        </div>
                    ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-5">
                        {/* Title */}
                        <div>
                            <input
                                autoFocus
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Task title…"
                                className="w-full text-base font-semibold bg-transparent border-none p-0 focus:ring-0 placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Description (optional)…"
                                rows={3}
                                className="w-full text-sm bg-muted/30 border border-border rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {eventConversion && (
                            <EventConversionFields
                                clients={clients}
                                clientSearch={clientSearch}
                                selectedClientId={selectedClientId}
                                durationMinutes={eventDurationMinutes}
                                logEventTime={logEventTime}
                                countsTowardBudget={countsTowardBudget}
                                syncTimeToBasecamp={syncTimeToBasecamp}
                                onClientSearchChange={handleClientSearchChange}
                                onLogEventTimeChange={setLogEventTime}
                                onCountsTowardBudgetChange={setCountsTowardBudget}
                                onSyncTimeToBasecampChange={setSyncTimeToBasecamp}
                            />
                        )}

                        {/* Priority + Category row */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value as TaskPriority)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</label>
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value as TaskCategory)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="">None</option>
                                    {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Assignee */}
                        {orgMembers.length > 0 && (
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <UserCircle2 className="h-3 w-3" /> Assign To
                                </label>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {orgMembers.map(m => {
                                        const selected = assigneeIds.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => setAssigneeIds(prev =>
                                                    selected ? prev.filter(id => id !== m.id) : [...prev, m.id]
                                                )}
                                                className={cn(
                                                    'px-2.5 py-1 rounded-full text-xs border transition-all',
                                                    selected
                                                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                                                        : 'bg-muted/30 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground',
                                                )}
                                            >
                                                {m.name.split(' ')[0]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Completion notifications map to Basecamp's "When done" field. */}
                        {orgMembers.length > 0 && (
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <Bell className="h-3 w-3" /> When Done — Notify
                                </label>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {orgMembers.map(m => {
                                        const selected = watcherIds.includes(m.id);
                                        return (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => setWatcherIds(previous => (
                                                    selected
                                                        ? previous.filter(id => id !== m.id)
                                                        : [...previous, m.id]
                                                ))}
                                                className={cn(
                                                    'px-2.5 py-1 rounded-full text-xs border transition-all',
                                                    selected
                                                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                                                        : 'bg-muted/30 text-muted-foreground border-border hover:border-primary/40 hover:text-foreground',
                                                )}
                                            >
                                                {m.name.split(' ')[0]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Due Date */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full mt-1 bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Recurrence */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Recurrence</label>
                            <RecurrenceSelector value={recurrence} onChange={setRecurrence} />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <ListChecks className="h-3 w-3" /> Subtasks
                            </label>
                            {subtaskTitles.length > 0 && (
                                <div className="mt-1.5 space-y-1">
                                    {subtaskTitles.map((subtask, index) => (
                                        <div key={`${subtask}-${index}`} className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-2 py-1.5 text-xs">
                                            <span className="min-w-0 flex-1 truncate">{subtask}</span>
                                            <button
                                                type="button"
                                                aria-label={`Remove subtask ${subtask}`}
                                                onClick={() => setSubtaskTitles(current => current.filter((_, itemIndex) => itemIndex !== index))}
                                                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div className="mt-1.5 flex gap-2">
                                <input
                                    type="text"
                                    value={subtaskInput}
                                    onChange={event => setSubtaskInput(event.target.value)}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter') {
                                            event.preventDefault();
                                            addSubtask();
                                        }
                                    }}
                                    placeholder="Add a subtask…"
                                    className="min-w-0 flex-1 rounded-lg border border-border bg-muted/30 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button
                                    type="button"
                                    onClick={addSubtask}
                                    disabled={!subtaskInput.trim()}
                                    className="rounded-lg border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
                                >
                                    Add
                                </button>
                            </div>
                        </div>

                        {/* Basecamp sync — only shown when client has Basecamp enabled */}
                        {clientHasBasecamp && (
                            <div className={cn(
                                'border border-border rounded-lg overflow-hidden',
                                syncToBasecamp ? 'border-green-500/30' : '',
                            )}>
                                {/* Toggle row */}
                                <div className="flex items-center justify-between py-2 px-3 bg-muted/30">
                                    <div className="flex items-center gap-2">
                                        <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <circle cx="16" cy="16" r="16" fill="#1D2D35"/>
                                            <path d="M16 8C11.582 8 8 11.582 8 16c0 2.21.895 4.21 2.344 5.656L16 28l5.656-6.344A7.953 7.953 0 0024 16c0-4.418-3.582-8-8-8z" fill="#53C68C"/>
                                        </svg>
                                        <span className="text-sm font-medium text-foreground">Sync to Basecamp</span>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={syncToBasecamp}
                                        onClick={handleSyncToggle}
                                        className={cn(
                                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
                                            syncToBasecamp ? 'bg-green-500' : 'bg-muted',
                                        )}
                                    >
                                        <span className={cn(
                                            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                                            syncToBasecamp ? 'translate-x-4' : 'translate-x-0',
                                        )} />
                                    </button>
                                </div>
                                {/* Existing task flows may choose a list. Event
                                    conversion intentionally uses the client's
                                    protected default so the task cannot drift
                                    into another client's Basecamp scope. */}
                                {syncToBasecamp && eventConversion && (
                                    <div className="border-t border-border/50 bg-muted/10 px-3 py-2.5 text-xs text-muted-foreground">
                                        Uses {selectedClientName ?? 'the client'}’s configured default Basecamp to-do list.
                                    </div>
                                )}
                                {syncToBasecamp && !eventConversion && (
                                    <div className="px-3 py-2.5 border-t border-border/50 bg-muted/10">
                                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Todolist</label>
                                        {bcLoadingLists ? (
                                            <p className="text-xs text-muted-foreground mt-1">Loading todolists…</p>
                                        ) : (
                                            <select
                                                value={bcTodolistId}
                                                onChange={e => setBcTodolistId(e.target.value)}
                                                className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            >
                                                <option value="">Select a todolist…</option>
                                                {bcTodolists.map(t => (
                                                    <option key={t.id} value={String(t.id)}>
                                                        {t.title || t.name}{String(t.id) === bcDefaultTodolistId ? ' (default)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!title.trim() || saving || Boolean(eventConversion && !selectedClientId)}
                                className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                {saving
                                    ? 'Creating and syncing…'
                                    : eventConversion && logEventTime
                                        ? 'Create Task & Log Time'
                                        : 'Create Task'}
                            </button>
                        </div>
                    </form>
                    )}
                </div>
            </div>
        </>
    );
}
