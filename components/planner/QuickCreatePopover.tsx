'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEventKind } from '@/lib/types';
import { createPlannerEvent } from '@/lib/supabase/planner-events';
import { createTask } from '@/lib/supabase/tasks';

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

interface QuickCreatePopoverProps {
    organizationId: string;
    userId: string;
    anchor: { x: number; y: number };
    draft: { startsAt: string; endsAt: string };
    onClose: () => void;
    onCreated: () => void;
    /** Keeps the block drawn on the grid in sync with the selected tab. */
    onBlockChange?: (block: { kind: PlannerEventKind; label: string }) => void;
}

export function QuickCreatePopover({
    organizationId, userId, anchor, draft, onClose, onCreated, onBlockChange,
}: QuickCreatePopoverProps) {
    const [tab, setTab] = useState<Tab>('event');

    const selectTab = (next: Tab) => {
        setTab(next);
        onBlockChange?.(TAB_BLOCK[next]);
    };
    const [title, setTitle] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

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

    const handleSave = async () => {
        const trimmed = title.trim();
        if (!trimmed || isSaving) return;
        setIsSaving(true);

        if (tab === 'task') {
            // Size the task to the drafted block so it renders where it was drawn,
            // rather than falling back to TASK_DEFAULT_MINUTES.
            const hours =
                (new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 3_600_000;
            const res = await createTask({
                organizationId,
                title: trimmed,
                startDate: draft.startsAt,
                dueDate: draft.startsAt,
                estimatedHours: hours,
                priority: 'medium',
                status: 'todo',
                assigneeIds: [userId],
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
                visibility: tab === 'focus' ? 'private' : 'default',
                busy: tab !== 'ooo',
            });
            if (!created) console.error('[planner] create event failed');
        }

        setIsSaving(false);
        onCreated();
        onClose();
    };

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
                placeholder={tab === 'task' ? 'Task name' : 'Add title'}
                className="w-full rounded-lg border-2 border-primary/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-2 text-xs text-muted-foreground">
                {format(new Date(draft.startsAt), 'MMM d, yyyy')}{' · '}
                {format(new Date(draft.startsAt), 'h:mm a')} → {format(new Date(draft.endsAt), 'h:mm a')}
            </div>

            <div className="mt-3 flex justify-end gap-2">
                <button
                    onClick={onClose}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
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
