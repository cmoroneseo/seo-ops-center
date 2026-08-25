'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getClients } from '@/lib/supabase/clients';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { formatDuration } from '@/lib/timesheets/format';
import type { ClientMonthSnapshot, PostApprovalChange } from '@/lib/timesheets/review';
import type { StoredApproval } from '@/lib/timesheets/approval-route';
import type { ClientProject } from '@/lib/types';
import { ApprovalInspector } from './ApprovalInspector';

interface ClientReviewViewProps {
    organizationId: string;
}

interface ReviewPayload {
    clientId: string;
    clientName: string;
    month: string;
    snapshot: ClientMonthSnapshot;
    approval: StoredApproval | null;
    changes: PostApprovalChange[];
}

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** The last twelve months, newest first. */
function recentMonths(count = 12): string[] {
    const months: string[] = [];
    const cursor = new Date();
    for (let index = 0; index < count; index += 1) {
        months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
        cursor.setMonth(cursor.getMonth() - 1);
    }
    return months;
}

/**
 * Monthly client budget review.
 *
 * Month-first, not a 31-column grid: the question here is "did this client's
 * month reconcile, and can I sign it off", which is a handful of numbers and
 * one decision — not a wall of daily cells.
 */
export function ClientReviewView({ organizationId }: ClientReviewViewProps) {
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [memberNames, setMemberNames] = useState<Record<string, string>>({});
    const [clientId, setClientId] = useState('');
    const [month, setMonth] = useState(currentMonth);
    const [payload, setPayload] = useState<ReviewPayload | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const months = useMemo(() => recentMonths(), []);

    useEffect(() => {
        let active = true;
        void Promise.all([
            getClients(organizationId),
            getOrganizationMembers(organizationId),
        ]).then(([clientRows, memberRows]) => {
            if (!active) return;
            setClients(clientRows);
            if (clientRows.length > 0) setClientId(current => current || clientRows[0].id);
            setMemberNames(Object.fromEntries(memberRows.map(row => [
                row.userId,
                row.user.fullName || row.user.email.split('@')[0],
            ])));
        });
        return () => { active = false; };
    }, [organizationId]);

    const load = useCallback(async () => {
        if (!organizationId || !clientId) return;
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ organizationId, clientId, month });
            const response = await fetch(`/api/timesheets/client-review?${params}`);
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Unable to load client review');
            setPayload(body as ReviewPayload);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load client review');
            setPayload(null);
        } finally {
            setIsLoading(false);
        }
    }, [organizationId, clientId, month]);

    useEffect(() => { void load(); }, [load]);

    const act = async (action: 'approve' | 'reopen', note: string) => {
        setIsSaving(true);
        setActionError(null);
        try {
            const response = await fetch('/api/timesheets/approvals', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, organizationId, clientId, month, note }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Unable to save approval');
            await load();
        } catch (saveError) {
            setActionError(saveError instanceof Error ? saveError.message : 'Unable to save approval');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-3 px-6 py-4">
                <label htmlFor="review-client" className="text-sm text-muted-foreground">Client</label>
                <select
                    id="review-client"
                    value={clientId}
                    onChange={event => setClientId(event.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {clients.map(client => (
                        <option key={client.id} value={client.id}>{client.clientName}</option>
                    ))}
                </select>

                <label htmlFor="review-month" className="ml-2 text-sm text-muted-foreground">Month</label>
                <select
                    id="review-month"
                    value={month}
                    onChange={event => setMonth(event.target.value)}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    {months.map(option => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </select>
            </div>

            {error && (
                <p role="alert" className="mx-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            )}

            <div className="flex min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-6">
                <div className="min-w-0 flex-1">
                    {isLoading && !payload && (
                        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
                    )}

                    {payload && (
                        <div className="space-y-3">
                            <StatusBanner payload={payload} />

                            <div className="rounded-xl border border-border bg-card p-5">
                                <h2 className="text-sm font-medium text-foreground">
                                    Included entries ({payload.snapshot.entries.length})
                                </h2>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Every mapped, finalized entry for {payload.clientName} in{' '}
                                    {payload.month}, across all team members.
                                </p>
                                <p className="mt-4 text-3xl font-semibold tabular-nums text-primary">
                                    {formatDuration(payload.snapshot.eligibleMinutes, { zero: '0m' })}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    of {formatDuration(payload.snapshot.budgetMinutes, { zero: '0m' })} contracted
                                    <span aria-hidden className="mx-2">·</span>
                                    {formatDuration(payload.snapshot.nonBudgetMinutes, { zero: '0m' })} non-budget
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {payload && (
                    <div className="w-[400px] shrink-0">
                        <ApprovalInspector
                            clientName={payload.clientName}
                            month={payload.month}
                            snapshot={payload.snapshot}
                            approval={payload.approval}
                            changes={payload.changes}
                            memberNames={memberNames}
                            isSaving={isSaving}
                            error={actionError}
                            onApprove={note => { void act('approve', note); }}
                            onReopen={note => { void act('reopen', note); }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

function StatusBanner({ payload }: { payload: ReviewPayload }) {
    const isApproved = payload.approval?.status === 'approved';
    const hasDrift = payload.changes.length > 0;

    if (!isApproved && payload.snapshot.unmappedCount === 0) return null;

    return (
        <div
            className={cn(
                'flex items-start gap-3 rounded-xl border p-4 text-sm',
                hasDrift || payload.snapshot.unmappedCount > 0
                    ? 'border-amber-500/40 bg-amber-500/5'
                    : 'border-emerald-500/40 bg-emerald-500/5',
            )}
        >
            {hasDrift || payload.snapshot.unmappedCount > 0 ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
            )}
            <p className="text-foreground">
                {payload.snapshot.unmappedCount > 0
                    ? `${payload.snapshot.unmappedCount} unmapped entries are blocking approval.`
                    : hasDrift
                        ? `${payload.changes.length} entries changed after this month was approved. The approved total is unchanged.`
                        : 'This client month is approved and reconciled.'}
            </p>
        </div>
    );
}
