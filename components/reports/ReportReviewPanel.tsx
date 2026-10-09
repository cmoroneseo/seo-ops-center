'use client';

import { useCallback, useEffect, useState } from 'react';

interface Check {
    id: string;
    severity: 'blocking' | 'warn';
    ok: boolean;
    message: string;
}

interface VersionRow {
    id: string;
    versionNo: number;
    reason: 'approval' | 'correction';
    correctionNote: string | null;
    amNote: string | null;
    createdAt: string;
}

interface ReviewPayload {
    review: {
        state: string;
        ownerApprovalPending: boolean;
        schedulingWaitsForRecipient: boolean;
        scheduledFor: string | null;
    } | null;
    checks: Check[];
    banners: { id: string; message: string }[];
    canApprove: boolean;
    canSchedule: boolean;
    versions: VersionRow[];
    error?: string;
}

const STATE_LABEL: Record<string, string> = {
    draft: 'Draft',
    ready_for_review: 'Ready for review',
    approved: 'Approved',
    scheduled: 'Approved and scheduled',
    sent: 'Sent',
};

export function ReportReviewPanel({ reportId }: { reportId: string }) {
    const [payload, setPayload] = useState<ReviewPayload | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        const response = await fetch(`/api/reports/${reportId}/versions`);
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            setError(body?.error || 'Could not load the review.');
            return;
        }
        setPayload(body);
        setError('');
    }, [reportId]);

    useEffect(() => { void load(); }, [load]);

    const act = async (action: 'approve' | 'correct' | 'schedule' | 'unschedule') => {
        setBusy(true);
        setError('');
        const response = await fetch(`/api/reports/${reportId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, note: note.trim() || undefined }),
        });
        const body = await response.json().catch(() => null);
        setBusy(false);
        if (!response.ok) {
            setError(body?.error || 'Could not save the review.');
            if (body?.checks) setPayload(current => current ? { ...current, checks: body.checks, banners: body.banners ?? current.banners, canApprove: false } : current);
            return;
        }
        setPayload(body);
        setNote('');
    };

    const state = payload?.review?.state ?? 'draft';
    const noteChecks = new Set(['no_work', 'gsc_real_zero']);
    const needsNote = payload?.checks.some(check => noteChecks.has(check.id) && !check.ok) ?? false;
    const otherBlocking = payload?.checks.some(check => check.severity === 'blocking' && !check.ok && !noteChecks.has(check.id)) ?? false;
    const signingFreeze = payload?.review?.ownerApprovalPending === true;
    const noteReady = note.trim().length > 0;
    const canPressApprove = Boolean(payload) && (signingFreeze ? payload?.canApprove === true : payload?.canApprove === true || (noteReady && needsNote && !otherBlocking));
    const frozen = state === 'approved' || state === 'scheduled' || state === 'sent';
    const approveLabel = payload?.review?.ownerApprovalPending ? 'Owner approval' : 'Approve';

    return (
        <section className="print-hidden border-b border-border px-4 py-3 space-y-2 max-h-[42%] overflow-y-auto" aria-label="Report review">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold">Review</h2>
                <span className="text-[10px] text-muted-foreground">{STATE_LABEL[state] ?? state}</span>
            </div>
            {payload?.banners.map(banner => (
                <p key={banner.id} className="text-[11px] text-muted-foreground">{banner.message}</p>
            ))}
            {payload?.review?.ownerApprovalPending && (
                <p className="text-[11px] text-muted-foreground">The organization owner still has to approve the frozen snapshot.</p>
            )}
            <ul className="space-y-1">
                {(payload?.checks ?? []).filter(check => !check.ok).map(check => (
                    <li key={`${check.id}-${check.message}`} className="text-[11px] text-foreground">
                        <span className="text-muted-foreground">{check.severity === 'blocking' ? 'Blocking' : 'Warning'} · </span>
                        {check.message}
                    </li>
                ))}
            </ul>
            {payload?.versions.map(version => (
                <p key={version.id} className="text-[11px] text-muted-foreground">
                    v{version.versionNo} {version.reason === 'correction' ? 'correction' : 'approval'}
                    {version.correctionNote ? ` · ${version.correctionNote}` : ''}
                    {version.amNote ? ` · ${version.amNote}` : ''}
                </p>
            ))}
            {(needsNote || frozen) && (
                <label className="block text-[11px] text-muted-foreground">
                    {frozen ? 'Correction note' : 'Note for What we did'}
                    <textarea
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    />
                </label>
            )}
            {error && <p className="text-[11px] text-destructive">{error}</p>}
            <div className="flex flex-wrap gap-2">
                {!frozen && (
                    <button
                        type="button"
                        disabled={busy || !canPressApprove || (!signingFreeze && needsNote && !noteReady)}
                        onClick={() => act('approve')}
                        className="text-xs bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                        {busy ? 'Saving…' : approveLabel}
                    </button>
                )}
                {frozen && state !== 'sent' && (
                    <button
                        type="button"
                        disabled={busy || note.trim().length === 0}
                        onClick={() => act('correct')}
                        className="text-xs border border-border rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                        Save correction
                    </button>
                )}
                {state === 'approved' && (
                    <button
                        type="button"
                        disabled={busy || !payload?.canSchedule}
                        onClick={() => act('schedule')}
                        className="text-xs border border-border rounded-lg px-3 py-1.5 disabled:opacity-50"
                    >
                        Schedule
                    </button>
                )}
                {state === 'scheduled' && (
                    <button type="button" disabled={busy} onClick={() => act('unschedule')} className="text-xs border border-border rounded-lg px-3 py-1.5 disabled:opacity-50">
                        Unschedule
                    </button>
                )}
            </div>
            {payload?.review?.scheduledFor && (
                <p className="text-[11px] text-muted-foreground">Scheduled {new Date(payload.review.scheduledFor).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PT. Nothing is emailed from this screen.</p>
            )}
        </section>
    );
}
