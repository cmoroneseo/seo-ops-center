// ---------------------------------------------------------------------------
// Pure reminder logic — no Supabase, no React. Unit-tested with node:test.
// ---------------------------------------------------------------------------

import { addDays, addWeeks, addMonths, differenceInMinutes, isSameDay, format } from 'date-fns';
import { Reminder, ReminderRecurrence } from './types';

/** Next occurrence after completion; null when the reminder doesn't repeat. */
export function nextDueDate(dueAtIso: string, recurrence: ReminderRecurrence): string | null {
    const due = new Date(dueAtIso);
    if (recurrence === 'daily') return addDays(due, 1).toISOString();
    if (recurrence === 'weekly') return addWeeks(due, 1).toISOString();
    if (recurrence === 'monthly') return addMonths(due, 1).toISOString();
    return null;
}

/** Epoch ms when the bell notification should fire; null = don't notify. */
export function notifyAtMs(dueAtIso: string, notifyOffsetMinutes: number | undefined): number | null {
    if (notifyOffsetMinutes === undefined || notifyOffsetMinutes === null) return null;
    return Date.parse(dueAtIso) - notifyOffsetMinutes * 60_000;
}

export interface ReminderGroups {
    overdue: Reminder[];
    today: Reminder[];
    upcoming: Reminder[];
    done: Reminder[];
}

/** Bucket reminders for the panel. Pending sections sort by due asc; done by completion desc. */
export function groupReminders(reminders: Reminder[], now: Date): ReminderGroups {
    const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], done: [] };
    for (const r of reminders) {
        if (r.status !== 'pending') {
            groups.done.push(r);
        } else if (new Date(r.dueAt) < now) {
            groups.overdue.push(r);
        } else if (isSameDay(new Date(r.dueAt), now)) {
            groups.today.push(r);
        } else {
            groups.upcoming.push(r);
        }
    }
    const byDue = (a: Reminder, b: Reminder) => Date.parse(a.dueAt) - Date.parse(b.dueAt);
    groups.overdue.sort(byDue);
    groups.today.sort(byDue);
    groups.upcoming.sort(byDue);
    groups.done.sort((a, b) =>
        Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt));
    return groups;
}

/** Human due label: "in 20 min", "in 2 hrs", "Tue 8:00 AM", "3 days overdue". */
export function dueLabel(dueAtIso: string, now: Date): string {
    const due = new Date(dueAtIso);
    const mins = differenceInMinutes(due, now);

    if (mins < 0) {
        const ago = -mins;
        if (ago < 60) return `${ago} min overdue`;
        if (ago < 60 * 24) return `${Math.floor(ago / 60)} hr${Math.floor(ago / 60) === 1 ? '' : 's'} overdue`;
        const days = Math.floor(ago / (60 * 24));
        return `${days} day${days === 1 ? '' : 's'} overdue`;
    }
    if (mins < 60) return `in ${mins} min`;
    if (isSameDay(due, now)) return `in ${Math.round(mins / 60)} hrs`;
    if (mins < 60 * 24 * 7) return format(due, 'EEE h:mm a');
    return format(due, 'MMM d, h:mm a');
}
