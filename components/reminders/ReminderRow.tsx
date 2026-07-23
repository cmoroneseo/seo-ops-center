'use client';

import { useState } from 'react';
import { AlarmClockPlus, Building2, Check, Repeat, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addHours, setHours, setMinutes, startOfDay, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Reminder } from '@/lib/types';
import { dueLabel } from '@/lib/reminders-logic';

export function ReminderRow({
    reminder,
    clientName,
    overdue,
    onComplete,
    onSnooze,
    onDelete,
    onRename,
}: {
    reminder: Reminder;
    clientName?: string;
    overdue: boolean;
    onComplete: (r: Reminder) => void;
    onSnooze: (r: Reminder, newDueAtIso: string) => void;
    onDelete: (r: Reminder) => void;
    onRename: (r: Reminder, title: string) => void;
}) {
    const router = useRouter();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [editTitle, setEditTitle] = useState<string | null>(null);
    const isDone = reminder.status !== 'pending';

    function commitRename() {
        const next = (editTitle ?? '').trim();
        if (next && next !== reminder.title) onRename(reminder, next);
        setEditTitle(null);
    }

    const snoozeHour = () => onSnooze(reminder, addHours(new Date(), 1).toISOString());
    const snoozeTomorrow = () =>
        onSnooze(reminder, setMinutes(setHours(addDays(startOfDay(new Date()), 1), 8), 0).toISOString());

    return (
        <div className="group flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-accent/10">
            <button
                onClick={() => onComplete(reminder)}
                disabled={isDone}
                className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors',
                    isDone
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 hover:border-primary',
                )}
                title={reminder.recurrence !== 'none' ? 'Complete (advances to next occurrence)' : 'Complete'}
            >
                {isDone && <Check className="h-3 w-3" />}
            </button>

            <div className="min-w-0 flex-1">
                {editTitle !== null ? (
                    <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditTitle(null);
                        }}
                        className="w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus:border-primary"
                    />
                ) : (
                    <p
                        onClick={() => { if (!isDone) setEditTitle(reminder.title); }}
                        className={cn(
                            'text-sm leading-tight',
                            isDone ? 'text-muted-foreground line-through' : 'cursor-text',
                        )}
                        title={isDone ? undefined : 'Click to rename'}
                    >
                        {reminder.title}
                    </p>
                )}
                {reminder.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{reminder.notes}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2">
                    <span className={cn('text-[11px]', overdue ? 'font-medium text-red-400' : 'text-muted-foreground')}>
                        {dueLabel(reminder.dueAt, new Date())}
                    </span>
                    {reminder.recurrence !== 'none' && (
                        <Repeat className="h-3 w-3 text-muted-foreground/60" />
                    )}
                    {reminder.clientId && clientName && (
                        <button
                            onClick={() => router.push(`/workspace/${reminder.clientId}`)}
                            className="flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                            <Building2 className="h-2.5 w-2.5" />
                            {clientName}
                        </button>
                    )}
                </div>
            </div>

            {!isDone && (
                <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={snoozeHour} title="Snooze 1 hour" className="rounded-md p-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground">
                        <AlarmClockPlus className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={snoozeTomorrow} title="Snooze until tomorrow 8 AM" className="rounded-md p-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/20 hover:text-foreground">
                        Tmrw
                    </button>
                    {confirmDelete ? (
                        <button onClick={() => onDelete(reminder)} className="rounded-md p-1 text-xs font-semibold text-destructive">
                            Sure?
                        </button>
                    ) : (
                        <button onClick={() => setConfirmDelete(true)} title="Delete" className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
