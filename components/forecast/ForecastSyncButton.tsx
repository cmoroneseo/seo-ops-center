'use client';

import { useRef, useState } from 'react';
import { formatLocalDate } from '@/lib/planner/local-date';
import type { ForecastPreviewView } from '@/lib/forecast/present';
import { cn } from '@/lib/utils';
import { ForecastSyncDialog, type ForecastWeekChoice } from './ForecastSyncDialog';

interface PreviewResponse {
    selectableWeeks: ForecastWeekChoice[];
    preview: ForecastPreviewView;
}

interface SyncResponse {
    ok: true;
    runId: string;
    idempotent: boolean;
    weekCount: number;
}

interface ToastState {
    message: string;
    runId: string | null;
}

interface ForecastSyncButtonProps {
    organizationId: string;
    variant: 'primary' | 'outline';
    onSynced?: () => void;
}

export function ForecastSyncButton({ organizationId, variant, onSynced }: ForecastSyncButtonProps) {
    const [open, setOpen] = useState(false);
    const [weeks, setWeeks] = useState<ForecastWeekChoice[]>([]);
    const [preview, setPreview] = useState<ForecastPreviewView | null>(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<ToastState | null>(null);
    const [undoing, setUndoing] = useState(false);
    const selectedRef = useRef<string[]>([]);
    const loadSeq = useRef(0);

    async function load(selected: string[]) {
        const seq = ++loadSeq.current;
        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({
                organizationId,
                today: formatLocalDate(new Date()),
                timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
            if (selected.length > 0) params.set('weeks', selected.join(','));
            const response = await fetch(`/api/forecast/preview?${params}`);
            const payload = await response.json() as PreviewResponse & { error?: string };
            if (seq !== loadSeq.current) return;
            if (!response.ok) throw new Error(payload.error ?? 'Unable to preview the forecast');
            selectedRef.current = payload.selectableWeeks.filter(week => week.selected).map(week => week.weekStart);
            setWeeks(payload.selectableWeeks);
            setPreview(payload.preview);
        } catch (loadError) {
            if (seq !== loadSeq.current) return;
            setPreview(null);
            setError(loadError instanceof Error ? loadError.message : 'Unable to preview the forecast');
        } finally {
            if (seq === loadSeq.current) setLoading(false);
        }
    }

    function openModal() {
        setOpen(true);
        setToast(null);
        selectedRef.current = [];
        setWeeks([]);
        void load([]);
    }

    function toggleWeek(weekStart: string) {
        const current = selectedRef.current;
        const next = current.includes(weekStart)
            ? current.filter(week => week !== weekStart)
            : [...current, weekStart];
        if (next.length === 0) return;
        selectedRef.current = next;
        setWeeks(existing => existing.map(week => ({ ...week, selected: next.includes(week.weekStart) })));
        void load(next);
    }

    async function sync() {
        const selected = selectedRef.current;
        setSyncing(true);
        setError(null);
        try {
            const response = await fetch('/api/forecast/sync', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    organizationId,
                    weekStarts: selected,
                    today: formatLocalDate(new Date()),
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });
            const payload = await response.json() as Partial<SyncResponse> & { error?: string };
            if (!response.ok || !payload.ok || !payload.runId) {
                throw new Error(payload.error ?? 'Unable to sync to Campaign Desk');
            }
            const count = payload.weekCount ?? selected.length;
            setOpen(false);
            setToast({
                message: payload.idempotent
                    ? 'Already synced to Campaign Desk.'
                    : `Synced ${count} ${count === 1 ? 'week' : 'weeks'} to Campaign Desk.`,
                runId: payload.runId,
            });
            onSynced?.();
        } catch (syncError) {
            setError(syncError instanceof Error ? syncError.message : 'Unable to sync to Campaign Desk');
        } finally {
            setSyncing(false);
        }
    }

    async function undo() {
        if (!toast?.runId) return;
        setUndoing(true);
        try {
            const response = await fetch('/api/forecast/undo', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ organizationId, runId: toast.runId }),
            });
            const payload = await response.json() as { error?: string };
            if (!response.ok) throw new Error(payload.error ?? 'Unable to undo the sync');
            setToast({ message: 'Sync undone.', runId: null });
            onSynced?.();
        } catch (undoError) {
            setToast({
                message: undoError instanceof Error ? undoError.message : 'Unable to undo the sync',
                runId: toast.runId,
            });
        } finally {
            setUndoing(false);
        }
    }

    return (
        <>
            <button
                type="button"
                onClick={openModal}
                className={cn(
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    variant === 'primary'
                        ? 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90'
                        : 'h-11 shrink-0 rounded-md border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                )}
            >
                Sync to forecast
            </button>

            <ForecastSyncDialog
                open={open}
                onClose={() => { if (!syncing) setOpen(false); }}
                loading={loading}
                error={error}
                weeks={weeks}
                preview={preview}
                syncing={syncing}
                onToggleWeek={toggleWeek}
                onSync={() => { void sync(); }}
            />

            {toast && (
                <div
                    role="status"
                    className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg"
                >
                    <span>{toast.message}</span>
                    {toast.runId && (
                        <button
                            type="button"
                            onClick={() => { void undo(); }}
                            disabled={undoing}
                            className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
                        >
                            {undoing ? 'Undoing…' : 'Undo'}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setToast(null)}
                        aria-label="Dismiss"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        ×
                    </button>
                </div>
            )}
        </>
    );
}
