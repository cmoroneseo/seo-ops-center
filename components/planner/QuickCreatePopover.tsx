'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ClientProject, PlannerEventKind, TaskPriority, TaskStatus } from '@/lib/types';
import { createPlannerEvent } from '@/lib/supabase/planner-events';
import { createTask } from '@/lib/supabase/tasks';
import { TeamMember } from './MeetWithFilter';

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
    onClose: () => void;
    onCreated: () => void;
    onBlockChange?: (block: { kind: PlannerEventKind; label: string }) => void;
    onOpenFullTask?: (draft: FullTaskDraft) => void;
}

const fieldCls =
    'w-full rounded-md border border-border bg-transparent px-1.5 py-1 text-[11px] outline-none focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="block min-w-0">
            <span className="mb-0.5 block text-[10px] text-muted-foreground">{label}</span>
            {children}
        </label>
    );
}

export function QuickCreatePopover({
    organizationId, userId, anchor, draft, clients, members,
    onClose, onCreated, onBlockChange, onOpenFullTask,
}: QuickCreatePopoverProps) {
    const [tab, setTab] = useState<Tab>('event');
    const [title, setTitle] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Shared: which client this belongs to. Empty means personal / no client.
    const [clientId, setClientId] = useState('');
    // Task-only fields.
    const [assigneeId, setAssigneeId] = useState(userId);
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [estimate, setEstimate] = useState('');

    useEffect(() => { setAssigneeId(userId); }, [userId]);
    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const selectTab = (next: Tab) => {
        setTab(next);
        onBlockChange?.(TAB_BLOCK[next]);
    };

    const blockMinutes = Math.max(
        15,
        Math.round((new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 60_000),
    );

    const handleSave = async () => {
        const trimmed = title.trim();
        if (!trimmed || isSaving) return;
        setIsSaving(true);

        if (tab === 'task') {
            const parsedEstimate = estimate.trim() ? Number(estimate) : NaN;
            const res = await createTask({
                organizationId,
                title: trimmed,
                clientId: clientId || undefined,
                startDate: draft.startsAt,
                dueDate: draft.startsAt,
                // What the planner blocked out, kept separate from the estimate.
                scheduledMinutes: blockMinutes,
                estimatedHours: Number.isFinite(parsedEstimate) && parsedEstimate > 0
                    ? parsedEstimate
                    : undefined,
                priority,
                status,
                assigneeIds: assigneeId ? [assigneeId] : undefined,
                createdBy: userId,
            });
            if (!res.success) console.error('[planner] create task failed:', res.error);
        } else {
            const created = await createPlannerEvent({
                organizationId,
                userId,
                title: trimmed,
                kind: TAB_KIND[tab],
                startsAt: draft.startsAt,
                endsAt: draft.endsAt,
                clientId: clientId || undefined,
                visibility: tab === 'focus' ? 'private' : 'default',
                busy: tab !== 'ooo',
            });
            if (!created) console.error('[planner] create event failed');
        }

        setIsSaving(false);
        onCreated();
        onClose();
    };

    const isTask = tab === 'task';

    return (
        <div
            ref={ref}
            style={{ left: anchor.x, top: anchor.y }}
            className="fixed z-50 w-[340px] rounded-xl border border-border bg-popover p-3 shadow-xl"
        >
            <div className="mb-3 flex items-center gap-1">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => selectTab(t.id)}
                        className={cn(
                            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            tab === t.id
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <input
                ref={inputRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSave(); }}
                placeholder={isTask ? 'Task name' : 'Add title'}
                className="w-full rounded-lg border-2 border-primary/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-2 text-xs text-muted-foreground">
                {format(new Date(draft.startsAt), 'MMM d, yyyy')}{' · '}
                {format(new Date(draft.startsAt), 'h:mm a')} → {format(new Date(draft.endsAt), 'h:mm a')}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
                {/* Without this a planner task is orphaned: no client tab, no deliverable. */}
                <Field label="Client">
                    <select
                        className={fieldCls}
                        value={clientId}
                        onChange={e => setClientId(e.target.value)}
                    >
                        <option value="">Personal</option>
                        {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.clientName}</option>
                        ))}
                    </select>
                </Field>

                {isTask && (
                    <Field label="Assignee">
                        <select
                            className={fieldCls}
                            value={assigneeId}
                            onChange={e => setAssigneeId(e.target.value)}
                        >
                            <option value="">Unassigned</option>
                            {members.map(m => (
                                <option key={m.userId} value={m.userId}>{m.name}</option>
                            ))}
                        </select>
                    </Field>
                )}

                {isTask && (
                    <>
                        <Field label="Priority">
                            <select
                                className={fieldCls}
                                value={priority}
                                onChange={e => setPriority(e.target.value as TaskPriority)}
                            >
                                {PRIORITIES.map(p => (
                                    <option key={p.value} value={p.value}>{p.label}</option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Status">
                            <select
                                className={fieldCls}
                                value={status}
                                onChange={e => setStatus(e.target.value as TaskStatus)}
                            >
                                {STATUSES.map(s => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </Field>

                        <Field label="Estimate (hrs)">
                            <input
                                type="number"
                                min="0"
                                step="0.25"
                                value={estimate}
                                onChange={e => setEstimate(e.target.value)}
                                placeholder={(blockMinutes / 60).toFixed(2).replace(/\.?0+$/, '')}
                                className={fieldCls}
                            />
                        </Field>
                    </>
                )}
            </div>

            {isTask && (
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Blocking {blockMinutes} min here. The estimate is how long the work takes.
                </p>
            )}

            <div className="mt-3 flex items-center gap-2">
                {isTask && onOpenFullTask && (
                    <button
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
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                        <ExternalLink className="h-3 w-3" /> Open full task
                    </button>
                )}

                <button
                    onClick={onClose}
                    className="ml-auto rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                    Cancel
                </button>
                <button
                    onClick={() => void handleSave()}
                    disabled={!title.trim() || isSaving}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                    {isSaving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
