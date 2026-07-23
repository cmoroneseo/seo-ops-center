'use client';

import { useMemo, useState } from 'react';
import * as chrono from 'chrono-node';
import {
    addDays, addHours, addMinutes, addMonths, format,
    isSameDay, isSameMonth, nextMonday, setHours, setMinutes, startOfDay, startOfMonth,
} from 'date-fns';
import { ChevronDown, ChevronUp, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReminderRecurrence } from '@/lib/types';

export interface ReminderDateValue {
    dueAt: Date;
    recurrence: ReminderRecurrence;
}

const RECURRENCE_OPTIONS: { value: ReminderRecurrence; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];

function presets(now: Date): { label: string; date: Date }[] {
    const tomorrow8 = setMinutes(setHours(addDays(startOfDay(now), 1), 8), 0);
    return [
        { label: 'In 20 minutes', date: addMinutes(now, 20) },
        { label: 'In 2 hours', date: addHours(now, 2) },
        { label: 'Tomorrow', date: tomorrow8 },
        { label: 'In 2 days', date: setMinutes(setHours(addDays(startOfDay(now), 2), 8), 0) },
        { label: 'Next week', date: setMinutes(setHours(nextMonday(startOfDay(now)), 8), 0) },
    ];
}

export function ReminderDatePicker({
    value,
    onChange,
    onClose,
}: {
    value: ReminderDateValue;
    onChange: (v: ReminderDateValue) => void;
    onClose: () => void;
}) {
    const now = useMemo(() => new Date(), []);
    const [text, setText] = useState('');
    const [viewMonth, setViewMonth] = useState(startOfMonth(value.dueAt));

    const parsed = useMemo(() => {
        if (!text.trim()) return null;
        return chrono.parseDate(text, now, { forwardDate: true });
    }, [text, now]);

    function pick(date: Date, close: boolean) {
        onChange({ ...value, dueAt: date });
        if (close) onClose();
    }

    function pickCalendarDay(day: Date) {
        // Keep the currently selected time of day
        const withTime = setMinutes(setHours(day, value.dueAt.getHours()), value.dueAt.getMinutes());
        pick(withTime, false);
    }

    // Build a Sunday-first 6-row calendar grid for viewMonth
    const grid: Date[] = useMemo(() => {
        const first = startOfMonth(viewMonth);
        const offset = first.getDay(); // 0 = Sunday
        const start = addDays(first, -offset);
        return Array.from({ length: 42 }, (_, i) => addDays(start, i));
    }, [viewMonth]);

    return (
        <div className="w-72 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/10">
            {/* Natural-language input */}
            <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && parsed) pick(parsed, true);
                    if (e.key === 'Escape') onClose();
                }}
                placeholder='Try "Tomorrow at 2 PM"…'
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {parsed && (
                <button
                    onClick={() => pick(parsed, true)}
                    className="mt-1 w-full rounded-lg bg-primary/10 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/20"
                >
                    {format(parsed, "EEE, MMM d 'at' h:mm a")} — press Enter
                </button>
            )}

            {/* Presets */}
            <div className="mt-2 space-y-0.5">
                {presets(now).map((p) => (
                    <button
                        key={p.label}
                        onClick={() => pick(p.date, true)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-accent/20"
                    >
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground">{format(p.date, 'EEE h:mm a')}</span>
                    </button>
                ))}
            </div>

            {/* Recurrence */}
            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                <Repeat className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                {RECURRENCE_OPTIONS.map((opt) => (
                    <button
                        key={opt.value}
                        onClick={() => onChange({ ...value, recurrence: opt.value })}
                        className={cn(
                            'rounded-md px-2 py-1 text-xs transition-colors',
                            value.recurrence === opt.value
                                ? 'bg-primary/10 font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-accent/20',
                        )}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Mini calendar */}
            <div className="mt-2 border-t border-border pt-2">
                <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-sm font-semibold">{format(viewMonth, 'MMM yyyy')}</span>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setViewMonth(startOfMonth(now))} className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/20">Today</button>
                        <button onClick={() => setViewMonth((m) => addMonths(m, -1))} className="rounded p-1 text-muted-foreground hover:bg-accent/20"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setViewMonth((m) => addMonths(m, 1))} className="rounded p-1 text-muted-foreground hover:bg-accent/20"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-y-0.5 text-center">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                        <span key={d} className="text-[10px] font-semibold text-muted-foreground/60">{d}</span>
                    ))}
                    {grid.map((day) => (
                        <button
                            key={day.toISOString()}
                            onClick={() => pickCalendarDay(day)}
                            className={cn(
                                'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors',
                                isSameDay(day, value.dueAt) && 'bg-primary text-primary-foreground font-bold',
                                !isSameDay(day, value.dueAt) && isSameDay(day, now) && 'bg-red-500/80 text-white',
                                !isSameMonth(day, viewMonth) && 'text-muted-foreground/40',
                                'hover:bg-accent/30',
                            )}
                        >
                            {day.getDate()}
                        </button>
                    ))}
                </div>
                {/* Time input for the selected day */}
                <div className="mt-1 flex items-center justify-between px-2 pb-1">
                    <span className="text-xs text-muted-foreground">Time</span>
                    <input
                        type="time"
                        value={format(value.dueAt, 'HH:mm')}
                        onChange={(e) => {
                            const [h, m] = e.target.value.split(':').map(Number);
                            if (Number.isNaN(h)) return;
                            pick(setMinutes(setHours(value.dueAt, h), m), false);
                        }}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                </div>
            </div>
        </div>
    );
}
