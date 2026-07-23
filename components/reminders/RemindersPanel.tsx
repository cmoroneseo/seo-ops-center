'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Bell, BellOff, Building2, CalendarClock, ChevronDown, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Reminder } from '@/lib/types';
import {
    listReminders, createReminder, completeReminder, snoozeReminder, deleteReminder, updateReminder,
} from '@/lib/supabase/personal-reminders';
import { groupReminders } from '@/lib/reminders-logic';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { useClients } from '@/lib/hooks/use-clients';
import { ReminderDatePicker, ReminderDateValue } from './ReminderDatePicker';
import { ReminderRow } from './ReminderRow';

const NOTIFY_OPTIONS: { value: number | null; label: string }[] = [
    { value: 0, label: 'On due date' },
    { value: 10, label: '10 minutes before' },
    { value: 60, label: '1 hour before' },
    { value: null, label: "Don't notify" },
];

function defaultDue(): Date {
    // Next round hour, at least 20 minutes out
    const d = new Date(Date.now() + 20 * 60_000);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
}

export function RemindersPanel() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const { clients } = useClients({ statuses: ['Active'] });
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [showDone, setShowDone] = useState(false);

    // Capture state
    const [title, setTitle] = useState('');
    const [dateValue, setDateValue] = useState<ReminderDateValue>({ dueAt: defaultDue(), recurrence: 'none' });
    const [notifyOffset, setNotifyOffset] = useState<number | null>(0);
    const [clientId, setClientId] = useState<string | null>(null);
    const [openPopover, setOpenPopover] = useState<'date' | 'notify' | 'client' | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const clientNameById = useMemo(
        () => new Map(clients.map((c) => [c.id, c.clientName])),
        [clients],
    );

    const refresh = useCallback(async () => {
        if (!organization || !userId) return;
        setIsLoading(true);
        const data = await listReminders({ organizationId: organization.id, userId });
        setReminders(data);
        setIsLoading(false);
    }, [organization, userId]);

    useEffect(() => {
        function handleOpen() { setIsOpen(true); }
        window.addEventListener('reminders:open', handleOpen);
        return () => window.removeEventListener('reminders:open', handleOpen);
    }, []);

    useEffect(() => {
        if (isOpen) {
            refresh();
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, refresh]);

    // Close popovers on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setOpenPopover(null);
            }
        }
        if (openPopover) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openPopover]);

    function notifyChanged() {
        window.dispatchEvent(new CustomEvent('reminders:changed'));
    }

    async function handleCreate() {
        if (!organization || !userId || !title.trim()) return;
        const created = await createReminder({
            organizationId: organization.id,
            userId,
            title: title.trim(),
            dueAt: dateValue.dueAt.toISOString(),
            recurrence: dateValue.recurrence,
            notifyOffsetMinutes: notifyOffset,
            clientId,
        });
        if (created) {
            setReminders((prev) => [created, ...prev]);
            setTitle('');
            setDateValue({ dueAt: defaultDue(), recurrence: 'none' });
            setClientId(null);
            setNotifyOffset(0);
            notifyChanged();
            inputRef.current?.focus();
        }
    }

    async function handleComplete(r: Reminder) {
        const updated = await completeReminder(r);
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            notifyChanged();
        }
    }

    async function handleSnooze(r: Reminder, newDueAtIso: string) {
        const updated = await snoozeReminder(r.id, newDueAtIso);
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            notifyChanged();
        }
    }

    async function handleDelete(r: Reminder) {
        if (await deleteReminder(r.id)) {
            setReminders((prev) => prev.filter((x) => x.id !== r.id));
            notifyChanged();
        }
    }

    async function handleRename(r: Reminder, newTitle: string) {
        const updated = await updateReminder(r.id, { title: newTitle });
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }
    }

    const groups = useMemo(() => groupReminders(reminders, new Date()), [reminders]);
    const chipClass =
        'flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors';

    if (!isOpen) return null;

    const notifyLabel =
        NOTIFY_OPTIONS.find((o) => o.value === notifyOffset)?.label ?? `${notifyOffset} min before`;

    return (
        <div className="fixed right-4 top-16 z-[150] hidden h-[560px] w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 md:flex">
            {/* Header */}
            <div className="relative flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-2.5">
                <AlarmClock className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Reminders</p>
                <button
                    onClick={() => setIsOpen(false)}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent/20"
                    title="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Capture bar */}
            <div className="border-b border-border p-3" ref={popoverRef}>
                <input
                    ref={inputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                    placeholder="Remind me to…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <div className="relative mt-2 flex items-center gap-1.5">
                    {/* Date chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'date' ? null : 'date')} className={cn(chipClass, 'text-foreground')}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        {format(dateValue.dueAt, 'EEE h:mm a')}
                        {dateValue.recurrence !== 'none' && <span className="text-primary">· {dateValue.recurrence}</span>}
                    </button>
                    {/* Client chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'client' ? null : 'client')} className={chipClass}>
                        <Building2 className="h-3.5 w-3.5" />
                        {clientId ? clientNameById.get(clientId) ?? 'Client' : 'Client'}
                    </button>
                    {/* Notify chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'notify' ? null : 'notify')} className={chipClass}>
                        {notifyOffset === null ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                        {notifyLabel}
                    </button>

                    {/* Popovers */}
                    {openPopover === 'date' && (
                        <div className="absolute left-0 top-full z-10 mt-1">
                            <ReminderDatePicker
                                value={dateValue}
                                onChange={setDateValue}
                                onClose={() => setOpenPopover(null)}
                            />
                        </div>
                    )}
                    {openPopover === 'client' && (
                        <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/10">
                            <button
                                onClick={() => { setClientId(null); setOpenPopover(null); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/20"
                            >
                                No client
                            </button>
                            {clients.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => { setClientId(c.id); setOpenPopover(null); }}
                                    className={cn(
                                        'w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent/20',
                                        clientId === c.id ? 'font-semibold text-primary' : 'text-foreground',
                                    )}
                                >
                                    {c.clientName}
                                </button>
                            ))}
                        </div>
                    )}
                    {openPopover === 'notify' && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/10">
                            {NOTIFY_OPTIONS.map((opt) => (
                                <button
                                    key={String(opt.value)}
                                    onClick={() => { setNotifyOffset(opt.value); setOpenPopover(null); }}
                                    className={cn(
                                        'w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent/20',
                                        notifyOffset === opt.value ? 'font-semibold text-primary' : 'text-foreground',
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {/* Custom minutes */}
                            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                                <span className="text-sm text-foreground">Custom:</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={10080}
                                    placeholder="min"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const v = Number((e.target as HTMLInputElement).value);
                                            if (v > 0) { setNotifyOffset(v); setOpenPopover(null); }
                                        }
                                    }}
                                    className="w-16 rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
                                />
                                <span className="text-xs text-muted-foreground">before</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {isLoading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                ) : reminders.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                        <AlarmClock className="h-8 w-8 opacity-30" />
                        <p className="text-sm">No reminders yet</p>
                    </div>
                ) : (
                    <>
                        {([
                            ['Overdue', groups.overdue, true],
                            ['Today', groups.today, false],
                            ['Upcoming', groups.upcoming, false],
                        ] as const).map(([label, items, isOverdue]) =>
                            items.length === 0 ? null : (
                                <div key={label}>
                                    <p className={cn(
                                        'px-4 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider',
                                        isOverdue ? 'text-red-400' : 'text-muted-foreground/60',
                                    )}>
                                        {label}
                                    </p>
                                    {items.map((r) => (
                                        <ReminderRow
                                            key={r.id}
                                            reminder={r}
                                            clientName={r.clientId ? clientNameById.get(r.clientId) : undefined}
                                            overdue={isOverdue}
                                            onComplete={handleComplete}
                                            onSnooze={handleSnooze}
                                            onDelete={handleDelete}
                                            onRename={handleRename}
                                        />
                                    ))}
                                </div>
                            ),
                        )}
                        {groups.done.length > 0 && (
                            <div>
                                <button
                                    onClick={() => setShowDone((v) => !v)}
                                    className="flex w-full items-center gap-1 px-4 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                                >
                                    Done ({groups.done.length})
                                    <ChevronDown className={cn('h-3 w-3 transition-transform', showDone && 'rotate-180')} />
                                </button>
                                {showDone && groups.done.map((r) => (
                                    <ReminderRow
                                        key={r.id}
                                        reminder={r}
                                        clientName={r.clientId ? clientNameById.get(r.clientId) : undefined}
                                        overdue={false}
                                        onComplete={handleComplete}
                                        onSnooze={handleSnooze}
                                        onDelete={handleDelete}
                                        onRename={handleRename}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
