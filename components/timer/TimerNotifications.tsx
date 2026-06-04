'use client';

import { useEffect, useState, useCallback } from 'react';
import { X, Clock, AlertTriangle } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { getTimeLogs, getLoggedHoursByClient } from '@/lib/supabase/time-logs';
import { getClients } from '@/lib/supabase/clients';
import { cn } from '@/lib/utils';

interface Notification {
    id: string;
    type: 'end_of_day' | 'retainer_warning';
    message: string;
    sub?: string;
}

const EOD_DISMISSED_KEY = 'timer:eod_dismissed_date';
const RETAINER_DISMISSED_KEY = 'timer:retainer_dismissed';

export function TimerNotifications() {
    const { organization } = useOrganization();
    const [notes, setNotes] = useState<Notification[]>([]);

    const dismiss = useCallback((id: string) => {
        setNotes(prev => prev.filter(n => n.id !== id));
    }, []);

    useEffect(() => {
        if (!organization) return;

        const check = async () => {
            const today = new Date().toISOString().split('T')[0];
            const month = today.slice(0, 7);
            const hour = new Date().getHours();
            const newNotes: Notification[] = [];

            // ── End-of-day reminder (after 4pm, once per day) ─────────────────
            const dismissedDate = localStorage.getItem(EOD_DISMISSED_KEY);
            if (hour >= 16 && dismissedDate !== today) {
                const todayLogs = await getTimeLogs(organization.id, { month });
                const hasLoggedToday = todayLogs.some(l => l.date === today);
                if (!hasLoggedToday) {
                    newNotes.push({
                        id: 'eod',
                        type: 'end_of_day',
                        message: "Don't forget to log your time today.",
                        sub: "You haven't logged any hours yet.",
                    });
                }
            }

            // ── Retainer burn warnings ─────────────────────────────────────────
            const dismissedJson = localStorage.getItem(RETAINER_DISMISSED_KEY);
            const dismissed: string[] = dismissedJson ? JSON.parse(dismissedJson) : [];

            const [clients, loggedMap] = await Promise.all([
                getClients(organization.id),
                getLoggedHoursByClient(organization.id, month),
            ]);

            const THRESHOLD = 0.8;
            for (const client of clients) {
                if (!client.seoHours || client.status !== 'Active') continue;
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

            setNotes(newNotes);
        };

        check();
        // Re-check every 10 minutes
        const interval = setInterval(check, 10 * 60 * 1000);
        return () => clearInterval(interval);
    }, [organization?.id]);

    const handleDismiss = (note: Notification) => {
        if (note.type === 'end_of_day') {
            localStorage.setItem(EOD_DISMISSED_KEY, new Date().toISOString().split('T')[0]);
        } else if (note.type === 'retainer_warning') {
            const existing = localStorage.getItem(RETAINER_DISMISSED_KEY);
            const list: string[] = existing ? JSON.parse(existing) : [];
            localStorage.setItem(RETAINER_DISMISSED_KEY, JSON.stringify([...list, note.id]));
        }
        dismiss(note.id);
    };

    if (notes.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full">
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
    );
}
