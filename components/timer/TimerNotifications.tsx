'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Clock, AlertTriangle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getTimeLogs, getLoggedHoursByClient } from '@/lib/supabase/time-logs';
import { getClients } from '@/lib/supabase/clients';
import { calendarDateInTimeZone, decideEndOfDayReminder, endOfDayLogLookup, type EndOfDayLog } from '@/lib/timer/log-reminder';
import { ToastGate } from '@/components/providers/toast-gate';
import {
    partitionRetainerWarnings,
    readRetainerShownIds,
    rememberRetainerShown,
    retainVisibleRetainerToast,
    retainerContextClientId,
    retainerWarnings,
    type RetainerWarning,
} from '@/lib/toasts/retainer-alerts';
import { syncRetainerTray } from '@/lib/toasts/retainer-tray';
import { cn } from '@/lib/utils';

interface Notification {
    id: string;
    type: 'end_of_day';
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

function readDismissedRetainers(): Set<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
        const raw = localStorage.getItem(RETAINER_DISMISSED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0));
    } catch {
        return new Set();
    }
}

function writeDismissedRetainer(id: string) {
    const list = readDismissedRetainers();
    list.add(id);
    try { localStorage.setItem(RETAINER_DISMISSED_KEY, JSON.stringify([...list])); } catch { /* session tray still drops it */ }
}

/** Survives a remount in this page session when storage is blocked. */
let presentedLocalDate: string | null = null;

export function TimerNotifications() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const { runningTimer } = useTimer();
    const pathname = usePathname();
    const [notes, setNotes] = useState<Notification[]>([]);
    const [warnings, setWarnings] = useState<RetainerWarning[]>([]);
    const [visibleToast, setVisibleToast] = useState<RetainerWarning | null>(null);
    const visibleToastRef = useRef<RetainerWarning | null>(null);
    visibleToastRef.current = visibleToast;
    const [dismissTick, setDismissTick] = useState(0);
    const keptVisible = useRef(false);
    const visibleDate = useRef<string | null>(null);
    const contextClientId = retainerContextClientId(pathname, runningTimer?.clientId ?? null);

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

            if (month) {
                try {
                    const [clients, loggedMap] = await Promise.all([
                        getClients(organization.id),
                        getLoggedHoursByClient(organization.id, month),
                    ]);
                    setWarnings(retainerWarnings(clients.map(client => ({
                        id: client.id,
                        name: client.clientName,
                        seoHours: client.seoHours,
                        status: client.status,
                        customScope: client.setupScope?.mode === 'custom',
                    })), loggedMap, month));
                } catch {
                    setWarnings([]);
                }
            } else {
                setWarnings([]);
            }

            setNotes(newNotes);
        };

        check();
        // Re-check every 10 minutes
        const interval = setInterval(check, 10 * 60 * 1000);
        return () => clearInterval(interval);
    }, [organization?.id, userId]);

    useEffect(() => {
        const dismissedIds = readDismissedRetainers();
        const shownIds = readRetainerShownIds();
        const { toast, tray } = partitionRetainerWarnings({
            warnings,
            contextClientId,
            dismissedIds,
            shownIds,
        });
        const kept = retainVisibleRetainerToast(toast, visibleToastRef.current, contextClientId, dismissedIds);
        syncRetainerTray(tray.filter(warning => warning.id !== kept?.id).map(warning => ({
            id: warning.id,
            clientId: warning.clientId,
            title: warning.message,
            body: warning.sub,
        })));
        if (toast) rememberRetainerShown(toast.id);
        setVisibleToast(kept);
    }, [warnings, contextClientId, dismissTick]);

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
        }
        dismiss(note.id);
    };

    const dismissToast = (warning: RetainerWarning) => {
        writeDismissedRetainer(warning.id);
        rememberRetainerShown(warning.id);
        setVisibleToast(current => current?.id === warning.id ? null : current);
        setDismissTick(tick => tick + 1);
    };

    if (notes.length === 0 && !visibleToast) return null;

    return (
        <ToastGate>
        <div
            data-toast-stack
            className="fixed right-6 z-40 flex w-full max-w-sm flex-col gap-2"
            style={{ bottom: 'var(--toast-clearance, 7.5rem)' }}
        >
            {notes.map(note => (
                <div
                    key={note.id}
                    className="flex items-start gap-3 rounded-xl border border-primary/30 bg-card p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                    <div className="mt-0.5 shrink-0 rounded-lg bg-primary/10 p-1.5 text-primary">
                        <Clock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{note.message}</p>
                        {note.sub && <p className="mt-0.5 text-xs text-muted-foreground">{note.sub}</p>}
                    </div>
                    <button
                        type="button"
                        aria-label="Dismiss"
                        onClick={() => handleDismiss(note)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            ))}
            {visibleToast && (
                <div
                    data-toast="retainer"
                    className={cn(
                        'flex items-start gap-3 rounded-xl border border-amber-500/40 bg-card p-4 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-4 fade-in duration-300',
                    )}
                >
                    <div className="mt-0.5 shrink-0 rounded-lg bg-amber-500/10 p-1.5 text-amber-500">
                        <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{visibleToast.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{visibleToast.sub}</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Dismiss retainer alert"
                        onClick={() => dismissToast(visibleToast)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
        </div>
        </ToastGate>
    );
}
