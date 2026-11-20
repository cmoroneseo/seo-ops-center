'use client';

import { useEffect, useState } from 'react';
import type { SyncLog } from '@/lib/sheets-mirror/store';
import { formatPacificTime } from '@/lib/sheets-mirror/time';

interface History {
    runs?: SyncLog[];
    enabled?: boolean;
    canSync?: boolean;
    error?: string;
}

async function loadHistory(url: string, signal?: AbortSignal): Promise<History> {
    try {
        const response = await fetch(url, { signal, cache: 'no-store' });
        return await response.json() as History;
    } catch {
        return { error: 'Could not load recent sheet syncs' };
    }
}

export function ClientSheetSync({ clientId }: { clientId: string }) {
    const url = `/api/clients/${encodeURIComponent(clientId)}/sheet-sync`;
    const [history, setHistory] = useState<History>();
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        void loadHistory(url, controller.signal).then(data => {
            if (!controller.signal.aborted) setHistory(data);
        });
        return () => controller.abort();
    }, [url]);

    async function sync() {
        setRunning(true);
        setResult('');
        try {
            const response = await fetch(url, { method: 'POST' });
            const data = await response.json() as { error?: string };
            setResult(response.ok ? 'Sheet synced.' : data.error ?? 'Sheet sync failed');
        } catch {
            setResult('Could not reach the sheet sync service');
        } finally {
            setHistory(await loadHistory(url));
            setRunning(false);
        }
    }

    return (
        <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
            {history?.enabled === false ? (
                <p>Sheet mirror is off</p>
            ) : history?.canSync && (
                <button
                    type="button"
                    onClick={() => void sync()}
                    disabled={running}
                    className="rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted focus-visible:outline-2 disabled:opacity-50"
                >
                    {running ? 'Syncing…' : 'Sync now'}
                </button>
            )}
            <p role="status">{result}</p>
            <details open>
                <summary className="cursor-pointer font-medium">Recent syncs</summary>
                {history?.error && <p className="mt-1 text-destructive">{history.error}</p>}
                {!history && <p className="mt-1 text-muted-foreground">Loading…</p>}
                {history?.runs?.length === 0 && <p className="mt-1 text-muted-foreground">No syncs yet.</p>}
                {!!history?.runs?.length && (
                    <ul className="mt-1 max-h-44 space-y-1 overflow-y-auto">
                        {history.runs.map((run, index) => (
                            <li key={`${run.started_at}-${index}`} className="border-b border-border py-1 last:border-0">
                                <time dateTime={run.started_at}>{formatPacificTime(run.started_at)}</time>
                                {' · '}{run.trigger === 'manual' ? 'Manual' : 'Scheduled'}{' · '}{run.status}
                                {run.error && <p className="break-words text-destructive">{run.error}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </details>
        </div>
    );
}
