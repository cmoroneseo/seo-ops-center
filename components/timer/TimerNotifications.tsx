'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Clock, AlertTriangle } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getTimeLogs, getLoggedHoursByClient } from '@/lib/supabase/time-logs';
import { getClients } from '@/lib/supabase/clients';
import { calendarDateInTimeZone, decideEndOfDayReminder, endOfDayLogLookup, type EndOfDayLog } from '@/lib/timer/log-reminder';
import { ToastGate } from '@/components/providers/toast-gate';
import { cn } from '@/lib/utils';

interface Notification {
    id: string;
    type: 'end_of_day' | 'retainer_warning';
    message: string;
    sub?: string;
}

const EOD_DISMISSED_KEY = 'timer:eod_dismissed_date';
const EOD_SHOWN_KEY = 'timer:eod_shown_date';
const RETAINER_DISMISSED_KEY = 'timer:retainer_dismissed';
const EOD_NOTE: Notification = {
    id: 'eod',
    type: 'end_of_day',
    message: "Don't forget to log your time today.",
    sub: "You haven't logged any hours yet.",
};

function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

function readStoredDate(key: string): string | null {
    try {
        return sessionStorage.getItem(key) || localStorage.getItem(key);
    } catch {
        try { return localStorage.getItem(key); } catch { return null; }
    }
}

function writeStoredDate(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode still has the in-memory guard */ }
    try { sessionStorage.setItem(key, value); } catch { /* same */ }
}

/** Survives a remount in this page session when storage is blocked. */
let presentedLocalDate: string | null = null;

export function TimerNotifications() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const [notes, setNotes] = useState<Notification[]>([]);
    const keptVisible = useRef(false);
    const visibleDate = useRef<string | null>(null);

    const dismiss = useCallback((id: string) => {
        setNotes(prev => prev.filter(n => n.id !== id));
    }, []);

    useEffect(() => {
        if (!organization) return;

        const check = async () => {
            const now = new Date();
            const timeZone = browserTimeZone();
            // time_logs.date is the member's local work date. UTC toISOString()
            // is already the next day after 17:00 in America/Los_Angeles, so an
            // evening check was comparing today's logs to tomorrow. A failed
            // getTimeLogs used to return [] and that miss was treated as zero.
            const shownForDate = keptVisible.current ? null : (readStoredDate(EOD_SHOWN_KEY) || presentedLocalDate);
            const dismissedForDate = readStoredDate(EOD_DISMISSED_KEY);
            let localDate = '';
            try { localDate = calendarDateInTimeZone(now, timeZone); } catch { localDate = ''; }
            const month = localDate.slice(0, 7);
            const newNotes: Notification[] = [];

            const gate = decideEndOfDayReminder({
                now, timeZone, userId, logs: undefined, shownForDate, dismissedForDate,
            });
            if (gate.reason === 'needs_logs') {
                let logs: EndOfDayLog[] | null = null;
                try {
                    const rows = await getTimeLogs(organization.id, endOfDayLogLookup(gate.localDate, userId));
                    logs = rows.map(row => ({ userId: row.userId, date: row.date, hours: row.hours, status: row.status }));
                } catch {
                    logs = null;
                }
                const decision = decideEndOfDayReminder({
                    now, timeZone, userId, logs, shownForDate: null, dismissedForDate: null,
                });
                if (decision.show) {
                    presentedLocalDate = decision.localDate;
                    visibleDate.current = decision.localDate;
                    writeStoredDate(EOD_SHOWN_KEY, decision.localDate);
                    keptVisible.current = true;
                    newNotes.push(EOD_NOTE);
                } else if (decision.reason === 'query_failed' && keptVisible.current) {
                    newNotes.push(EOD_NOTE);
                } else if (decision.reason === 'logged_today') {
                    keptVisible.current = false;
                }
            } else if (gate.reason === 'dismissed') {
                keptVisible.current = false;
            }

            // ── Retainer burn warnings ─────────────────────────────────────────
            if (month) {
                const dismissedJson = localStorage.getItem(RETAINER_DISMISSED_KEY);
                const dismissed: string[] = dismissedJson ? JSON.parse(dismissedJson) : [];

                const [clients, loggedMap] = await Promise.all([
                    getClients(organization.id),
                    getLoggedHoursByClient(organization.id, month),
                ]);

                const THRESHOLD = 0.8;
                for (const client of clients) {
                    if (client.setupScope?.mode === 'custom' || !client.seoHours || client.status !== 'Active') continue;
                    const logged = loggedMap[client.id] ?? 0;
                    const pct = logged / client.seoHours;
                    const noteId = `retainer:${client.id}:${month}`;
                    if (pct >= THRESHOLD && pct < 1 && !dismissed.includes(noteId)) {
                        newNotes.push({
                            id: noteId,
                            type: 'retainer_warning',
                            message: `${client.clientName} is at ${Math.round(pct * 100)}% of their monthly retainer.`,
                            sub: `${logged}h logged of ${client.seoHours}h — ${(client.seoHours - logged).toFixed(1)}h remaining.`,
                        });
                    }
                }
            }

            setNotes(newNotes);
        };

        check();
        // Re-check every 10 minutes
        const interval = setInterval(check, 10 * 60 * 1000);
        return () => clearInterval(interval);
    }, [organization?.id, userId]);

    const handleDismiss = (note: Notification) => {
        if (note.type === 'end_of_day') {
            const date = visibleDate.current || decideEndOfDayReminder({
                now: new Date(),
                timeZone: browserTimeZone(),
                userId,
                logs: undefined,
                shownForDate: null,
                dismissedForDate: null,
            }).localDate;
            if (date) writeStoredDate(EOD_DISMISSED_KEY, date);
            keptVisible.current = false;
        } else if (note.type === 'retainer_warning') {
            const existing = localStorage.getItem(RETAINER_DISMISSED_KEY);
            const list: string[] = existing ? JSON.parse(existing) : [];
            localStorage.setItem(RETAINER_DISMISSED_KEY, JSON.stringify([...list, note.id]));
        }
        dismiss(note.id);
    };

    if (notes.length === 0) return null;

    return (
        <ToastGate>
        <div className="fixed bottom-40 lg:bottom-24 right-6 z-50 flex flex-col gap-2 max-w-sm w-full">
            {notes.map(note => (
                <div
                    key={note.id}
                    className={cn(
                        'flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-4 fade-in duration-300',
                        note.type === 'end_of_day'
                            ? 'bg-card border-primary/30'
                            : 'bg-card border-amber-500/40'
                    )}
                >
                    <div className={cn(
                        'mt-0.5 shrink-0 rounded-lg p-1.5',
                        note.type === 'end_of_day' ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-500'
                    )}>
                        {note.type === 'end_of_day'
                            ? <Clock className="h-4 w-4" />
                            : <AlertTriangle className="h-4 w-4" />
                        }
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{note.message}</p>
                        {note.sub && <p className="text-xs text-muted-foreground mt-0.5">{note.sub}</p>}
                    </div>
                    <button
                        onClick={() => handleDismiss(note)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                </div>
            ))}
        </div>
        </ToastGate>
    );
}
