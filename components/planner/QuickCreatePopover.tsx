'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { format } from 'date-fns';
import { X, ExternalLink, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClientProject, PlannerEventKind, Task, TaskPriority, TaskStatus } from '@/lib/types';
import { createPlannerEvent } from '@/lib/supabase/planner-events';
import { createTask, updateTask } from '@/lib/supabase/tasks';
import { TeamMember } from './MeetWithFilter';
import { TaskMentionPicker, matchTasks } from './TaskMentionPicker';
import { localDateForInstant } from '@/lib/planner/local-date';
import { resolveQuickCreateSave } from '@/lib/planner/quick-create-save';
import { usePlannerDialogFocus } from './usePlannerDialogFocus';
import { usePlannerSurfaceBehavior } from './usePlannerSurfaceBehavior';
import { quickCreateTypeButtonProps } from '@/lib/planner/responsive';

type Tab = 'event' | 'task' | 'focus' | 'ooo';

const TABS: { id: Tab; label: string }[] = [
    { id: 'event', label: 'Event' },
    { id: 'task', label: 'Task' },
    { id: 'focus', label: 'Focus time' },
    { id: 'ooo', label: 'OOO' },
];

const TAB_KIND: Record<Exclude<Tab, 'task'>, PlannerEventKind> = {
    event: 'event',
    focus: 'focus',
    ooo: 'ooo',
};

/** How the block on the grid should look for each tab. */
const TAB_BLOCK: Record<Tab, { kind: PlannerEventKind; label: string }> = {
    event: { kind: 'event', label: 'New event' },
    task: { kind: 'focus', label: 'New task' },
    focus: { kind: 'focus', label: 'Focus time' },
    ooo: { kind: 'ooo', label: 'Out of office' },
};

const PRIORITIES: { value: TaskPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const STATUSES: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To do' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'review', label: 'Review' },
    { value: 'blocked', label: 'Blocked' },
];

/**
 * "@@" opens the task picker. Two characters so a lone "@" (a person, later)
 * stays free, matching the convention the team already types in ClickUp.
 */
const MENTION = '@@';

/** The draft handed to the full task modal when the popover isn't enough. */
export interface FullTaskDraft {
    title: string;
    clientId?: string;
    clientName?: string;
    startsAt: string;
    endsAt: string;
}

interface QuickCreatePopoverProps {
    organizationId: string;
    userId: string;
    anchor: { x: number; y: number };
    draft: { startsAt: string; endsAt: string };
    clients: ClientProject[];
    members: TeamMember[];
    /** Every open task in the org — the picker's corpus. Already loaded by the page. */
    tasks: Task[];
    onClose: () => void;
    onCreated: () => void;
    onBlockChange?: (block: { kind: PlannerEventKind; label: string }) => void;
    onOpenFullTask?: (draft: FullTaskDraft) => void;
    restoreFocusRef?: RefObject<HTMLElement | null>;
}

const fieldCls =
    'min-h-10 w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-0.5 block text-[10px] text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

export function QuickCreatePopover({
    organizationId, userId, anchor, draft, clients, members, tasks,
    onClose, onCreated, onBlockChange, onOpenFullTask, restoreFocusRef,
}: QuickCreatePopoverProps) {
    const [tab, setTab] = useState<Tab>('event');
    const [title, setTitle] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const surface = usePlannerSurfaceBehavior('quick-create');
    const requestClose = usePlannerDialogFocus(ref, true, onClose, {
        trapFocus: surface.trapFocus,
        restoreFocusRef,
    });

    const [clientId, setClientId] = useState('');
    const [assigneeId, setAssigneeId] = useState(userId);
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [estimate, setEstimate] = useState('');

    /**
     * Task tab: the block *is* this task. Picking one switches the popover from
     * creating work to scheduling work, which the UI makes unmissable.
     */
    const [scheduledTask, setScheduledTask] = useState<Task | null>(null);
    /** Event tab: the meeting is *about* this task. Does not schedule it. */
    const [referencedTask, setReferencedTask] = useState<Task | null>(null);
    const [highlight, setHighlight] = useState(0);

    useEffect(() => { setAssigneeId(userId); }, [userId]);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                requestClose(surface.modal ? 'dismiss' : 'outside');
            }
        };
        document.addEventListener('mousedown', onDown);
        return () => {
            document.removeEventListener('mousedown', onDown);
        };
    }, [requestClose, surface.modal]);

    const isTask = tab === 'task';
    // Focus time protects an hour; it is not "work on X", so it has no mention.
    const mentionsAllowed = isTask || tab === 'event';
    const isMentioning = mentionsAllowed && !scheduledTask && title.startsWith(MENTION);
    const mentionQuery = isMentioning ? title.slice(MENTION.length) : '';
    const mentionMatches = isMentioning
        ? matchTasks(tasks, mentionQuery, clientId || undefined)
        : [];

    useEffect(() => { setHighlight(0); }, [mentionQuery, clientId]);

    const selectTab = (next: Tab) => {
        setTab(next);
        setScheduledTask(null);
        setReferencedTask(null);
        setTitle('');
        setSaveError(null);
        onBlockChange?.(TAB_BLOCK[next]);
    };

    const blockMinutes = Math.max(
        15,
        Math.round((new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 60_000),
    );

    /** Task tab: put the chosen task on this block. */
    const pickForSchedule = (task: Task) => {
        setScheduledTask(task);
        setTitle(task.title);
        if (task.clientId) setClientId(task.clientId);
    };

    /** Event tab: attach the task as context, leaving its schedule alone. */
    const pickForReference = (task: Task) => {
        setReferencedTask(task);
        setTitle('');
        if (task.clientId) setClientId(task.clientId);
        inputRef.current?.focus();
    };

    const revertToCreate = () => {
        setScheduledTask(null);
        setTitle('');
        inputRef.current?.focus();
    };

    const handleSave = async () => {
        if (isSaving) return;
        setSaveError(null);

        // Scheduling an existing task — no new record.
        if (isTask && scheduledTask) {
            setIsSaving(true);
            const res = await updateTask(scheduledTask.id, {
                startDate: draft.startsAt,
                scheduledMinutes: blockMinutes,
            });
            setIsSaving(false);
            const outcome = resolveQuickCreateSave({ title, clientId }, res.success);
            if (!outcome.shouldComplete) {
                console.error('[planner] schedule existing task failed:', res.error);
                setSaveError(outcome.error);
                return;
            }
            onCreated();
            onClose();
            return;
        }

        const trimmed = title.trim();
        if (!trimmed || title.startsWith(MENTION)) return;
        setIsSaving(true);

        let saved = false;
        if (isTask) {
            const parsedEstimate = estimate.trim() ? Number(estimate) : NaN;
            const res = await createTask({
                organizationId,
                title: trimmed,
                clientId: clientId || undefined,
                startDate: draft.startsAt,
                dueDate: localDateForInstant(draft.startsAt),
                scheduledMinutes: blockMinutes,
                estimatedHours: Number.isFinite(parsedEstimate) && parsedEstimate > 0
                    ? parsedEstimate
                    : undefined,
                priority,
                status,
                assigneeIds: assigneeId ? [assigneeId] : undefined,
                createdBy: userId,
            });
            saved = res.success;
            if (!saved) console.error('[planner] create task failed:', res.error);
        } else {
            const created = await createPlannerEvent({
                organizationId,
                userId,
                title: trimmed,
                kind: TAB_KIND[tab],
                startsAt: draft.startsAt,
                endsAt: draft.endsAt,
                clientId: clientId || undefined,
                // The one honest use of task_id: this meeting is about that task.
                taskId: referencedTask?.id,
                visibility: tab === 'focus' ? 'private' : 'default',
                busy: tab !== 'ooo',
            });
            saved = Boolean(created);
            if (!saved) console.error('[planner] create event failed');
        }

        setIsSaving(false);
        const outcome = resolveQuickCreateSave({ title, clientId }, saved);
        if (!outcome.shouldComplete) {
            setSaveError(outcome.error);
            return;
        }
        onCreated();
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (isMentioning && mentionMatches.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight(h => (h + 1) % mentionMatches.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight(h => (h - 1 + mentionMatches.length) % mentionMatches.length);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                const picked = mentionMatches[highlight];
                if (isTask) pickForSchedule(picked);
                else pickForReference(picked);
                return;
            }
        }
        // Escape backs out of the mention before it closes the whole popover.
        if (e.key === 'Escape' && isMentioning) {
            e.stopPropagation();
            setTitle('');
            return;
        }
        if (e.key === 'Enter') void handleSave();
    };

    const scheduledClientName = scheduledTask
        ? clients.find(c => c.id === scheduledTask.clientId)?.clientName ?? scheduledTask.clientName
        : undefined;

    return (
        <>
        {surface.backdrop && (
            <div
                className="fixed inset-0 z-[60] bg-black/35"
                onClick={() => requestClose('dismiss')}
                aria-hidden="true"
            />
        )}
        <div
            ref={ref}
            style={{ left: anchor.x, top: anchor.y }}
            role={surface.role}
            aria-modal={surface.modal || undefined}
            aria-labelledby="quick-create-heading"
            tabIndex={-1}
            className="fixed z-[70] w-[340px] rounded-xl border border-border bg-popover p-3 shadow-xl max-lg:!inset-x-3 max-lg:!bottom-3 max-lg:!top-auto max-lg:!max-h-[calc(100dvh-1.5rem)] max-lg:!w-auto max-lg:overflow-y-auto"
        >
            <h2 id="quick-create-heading" className="sr-only">Create planner item</h2>
            <div className="mb-3 flex items-center gap-1" role="group" aria-label="Item type">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        {...quickCreateTypeButtonProps(t.id, tab)}
                        onClick={() => selectTab(t.id)}
                        className={cn(
                            'min-h-11 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-2.5',
                            tab === t.id
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
                <button
                    type="button"
                    onClick={() => requestClose('dismiss')}
                    aria-label="Close quick create"
                    className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            {scheduledTask ? (
                // Scheduling mode. The chip replaces the input so there is no
                // ambiguity about whether a new task is about to be created.
                <div className="rounded-lg border-2 border-primary/60 px-3 py-2">
                    <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{scheduledTask.title}</div>
                            <div className="truncate text-[10px] text-muted-foreground">
                                {[
                                    scheduledClientName,
                                    scheduledTask.status.replace('_', ' '),
                                    scheduledTask.estimatedHours ? `est ${scheduledTask.estimatedHours}h` : null,
                                ].filter(Boolean).join(' · ')}
                            </div>
                        </div>
                        <button
                            onClick={revertToCreate}
                            aria-label="Choose a different task"
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="relative">
                    <input
                        ref={inputRef}
                        data-dialog-autofocus
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={
                            isTask
                                ? 'Task name — or @@ to find existing work'
                                : tab === 'event'
                                    ? 'Add title — or @@ to link a task'
                                    : 'Add title'
                        }
                        className="w-full rounded-lg border-2 border-primary/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                    />

                    {isMentioning && (
                        <TaskMentionPicker
                            tasks={tasks}
                            query={mentionQuery}
                            clientId={clientId || undefined}
                            highlight={highlight}
                            onHighlightChange={setHighlight}
                            onPick={isTask ? pickForSchedule : pickForReference}
                            onCreateInstead={isTask ? (t => setTitle(t)) : undefined}
                            heading={
                                clientId
                                    ? `${clients.find(c => c.id === clientId)?.clientName} — open work`
                                    : 'Open work'
                            }
                            hint={
                                isTask
                                    ? '↑↓ to choose · Enter to put it on this block'
                                    : '↑↓ to choose · Enter to link it to this event'
                            }
                        />
                    )}
                </div>
            )}

            {referencedTask && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1">
                    <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[11px]">{referencedTask.title}</span>
                    <button
                        type="button"
                        onClick={() => setReferencedTask(null)}
                        aria-label="Remove linked task"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <X className="h-3 w-3" />
                    </button>
                </div>
            )}

            <div className="mt-2 text-xs text-muted-foreground">
                {format(new Date(draft.startsAt), 'MMM d, yyyy')}{' · '}
                {format(new Date(draft.startsAt), 'h:mm a')} → {format(new Date(draft.endsAt), 'h:mm a')}
            </div>

            {/*
              In scheduling mode these belong to the task, not to this form, so
              they collapse away rather than sitting there greyed out.
            */}
            {!scheduledTask && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <Field label="Client">
                        <select className={fieldCls} value={clientId} onChange={e => setClientId(e.target.value)}>
                            <option value="">Personal</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.clientName}</option>
                            ))}
                        </select>
                    </Field>

                    {isTask && (
                        <>
                            <Field label="Assignee">
                                <select className={fieldCls} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
                                    <option value="">Unassigned</option>
                                    {members.map(m => (
                                        <option key={m.userId} value={m.userId}>{m.name}</option>
                                    ))}
                                </select>
                            </Field>

                            <Field label="Priority">
                                <select className={fieldCls} value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>
                                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                                </select>
                            </Field>

                            <Field label="Status">
                                <select className={fieldCls} value={status} onChange={e => setStatus(e.target.value as TaskStatus)}>
                                    {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                </select>
                            </Field>

                            <Field label="Estimate (hrs)">
                                <input
                                    type="number" min="0" step="0.25"
                                    value={estimate}
                                    onChange={e => setEstimate(e.target.value)}
                                    placeholder={(blockMinutes / 60).toFixed(2).replace(/\.?0+$/, '')}
                                    className={fieldCls}
                                />
                            </Field>
                        </>
                    )}
                </div>
            )}

            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                {scheduledTask
                    ? `Blocking ${blockMinutes} min for this task. Its details stay as they are.`
                    : isTask
                        ? `Blocking ${blockMinutes} min here. The estimate is how long the work takes.`
                        : referencedTask
                            ? 'Linked for context — this does not schedule the task.'
                            : ''}
            </p>

            {saveError && (
                <div
                    role="alert"
                    className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
                >
                    {saveError}
                </div>
            )}

            <div className="mt-3 flex items-center gap-2">
                {isTask && !scheduledTask && onOpenFullTask && (
                        <button
                            type="button"
                            onClick={() => {
                            onOpenFullTask({
                                title: title.trim(),
                                clientId: clientId || undefined,
                                clientName: clients.find(c => c.id === clientId)?.clientName,
                                startsAt: draft.startsAt,
                                endsAt: draft.endsAt,
                            });
                            onClose();
                        }}
                            className="flex min-h-11 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <ExternalLink className="h-3 w-3" /> Open full task
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => requestClose('dismiss')}
                    className="ml-auto min-h-11 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={isSaving || (!scheduledTask && (!title.trim() || title.startsWith(MENTION)))}
                    className="min-h-11 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                >
                    {isSaving ? 'Saving…' : scheduledTask ? 'Schedule' : 'Save'}
                </button>
            </div>
        </div>
        </>
    );
}
