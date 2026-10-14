'use client';

import { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { formatBingSyncResult, readBingManualView } from '@/lib/bing/manual-view';
import { cn } from '@/lib/utils';

const DID_NOT_RUN = 'Bing sync did not run.';

/**
 * One finished sync. A skipped or failed response does not count: nothing
 * was mapped, so the dashboard must not reload over the current numbers.
 */
export async function finishBingSync(onSynced?: () => void): Promise<string> {
    try {
        const response = await fetch('/api/integrations/bing/sync', { method: 'POST' });
        const body: unknown = await response.json().catch(() => null);
        const view = response.ok ? readBingManualView(body) : null;
        if (view && view.skipped == null) onSynced?.();
        return view ? formatBingSyncResult(view) : DID_NOT_RUN;
    } catch {
        return DID_NOT_RUN;
    }
}

/**
 * Admin trigger for one organization. The parent decides who can see it.
 * The response is reduced to counts and HTTP status codes before display.
 */
export function SyncBingButton({ variant, onSynced }: { variant: 'settings' | 'toolbar'; onSynced?: () => void }) {
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    async function run() {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
            setMessage(await finishBingSync(onSynced));
        } finally {
            setBusy(false);
        }
    }

    const button = (
        <button
            type="button"
            onClick={run}
            disabled={busy}
            aria-label="Sync Bing now"
            className={cn(
                'inline-flex items-center gap-1.5 text-sm font-medium disabled:opacity-50',
                variant === 'toolbar'
                    ? 'h-9 rounded-lg border border-white/10 bg-white/5 px-2.5 text-zinc-200'
                    : 'h-9 rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90',
            )}
        >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync Bing now
        </button>
    );

    if (variant === 'toolbar') {
        return (
            <div className="flex items-center gap-2">
                {button}
                {message && <p role="status" className="max-w-[16rem] text-xs text-zinc-400">{message}</p>}
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h3 className="text-lg font-medium">Bing Webmaster</h3>
                    <p className="text-sm text-muted-foreground">Sync verified sites for this organization.</p>
                </div>
                {button}
            </div>
            {message && <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p>}
        </div>
    );
}
