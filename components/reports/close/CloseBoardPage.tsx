'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CloseBoard } from './CloseBoard';
import type { CloseBoardView } from '@/lib/reports/close-view';

export function CloseBoardPage() {
    const params = useSearchParams();
    const month = params.get('month');
    const [board, setBoard] = useState<CloseBoardView | null>(null);
    const [error, setError] = useState('');
    const [loadError, setLoadError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const query = month ? `?month=${encodeURIComponent(month)}` : '';
        const response = await fetch(`/api/reports/close${query}`, { cache: 'no-store' });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.board) {
            setBoard(null);
            setLoadError(typeof body?.error === 'string' ? body.error : 'Could not load the close board.');
            return;
        }
        setBoard(body.board as CloseBoardView);
        setLoadError('');
    }, [month]);

    useEffect(() => { void load(); }, [load]);

    async function act(reportId: string, action: 'approve' | 'schedule', note: string) {
        setBusy(true);
        setError('');
        const response = await fetch(`/api/reports/${reportId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, note: note.trim() || undefined }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            setBusy(false);
            setError(typeof body?.error === 'string' ? body.error : 'Could not save the review.');
            return;
        }
        await load();
        setBusy(false);
    }

    if (loadError) {
        return (
            <div className="p-6">
                <p className="text-sm text-destructive">{loadError}</p>
                <button type="button" onClick={() => void load()} className="mt-3 text-sm text-primary">Try again</button>
            </div>
        );
    }
    if (!board) return <p className="p-6 text-sm text-muted-foreground">Loading the close board…</p>;

    return (
        <CloseBoard
            key={board.month}
            board={board}
            busy={busy}
            error={error}
            onApprove={(reportId, note) => void act(reportId, 'approve', note)}
            onSchedule={reportId => void act(reportId, 'schedule', '')}
        />
    );
}
