'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration, percentOf } from '@/lib/timesheets/format';
import type { ClientMonthSnapshot, PostApprovalChange } from '@/lib/timesheets/review';
import type { StoredApproval } from '@/lib/timesheets/approval-route';

interface ApprovalInspectorProps {
    clientName: string;
    month: string;
    snapshot: ClientMonthSnapshot;
    approval: StoredApproval | null;
    changes: PostApprovalChange[];
    memberNames: Record<string, string>;
    isSaving: boolean;
    error: string | null;
    onApprove: (note: string) => void;
    onReopen: (note: string) => void;
}

const CHANGE_LABELS: Record<PostApprovalChange['kind'], string> = {
    minutes_changed: 'Duration changed since approval',
    removed: 'Entry removed since approval',
    added: 'Entry added since approval',
};

/**
 * Client Close: reconcile the month, then approve it.
 *
 * When an approval exists, the approved numbers are shown as the record and the
 * live ledger only appears as *difference* — the panel never quietly redraws an
 * approved total from current data.
 */
export function ApprovalInspector({
    clientName,
    month,
    snapshot,
    approval,
    changes,
    memberNames,
    isSaving,
    error,
    onApprove,
    onReopen,
}: ApprovalInspectorProps) {
    const [note, setNote] = useState('');

    const isApproved = approval?.status === 'approved';
    const blockedByUnmapped = snapshot.unmappedCount > 0;
    const needsNote = snapshot.requiresNote && !note.trim();
    const canApprove = !isApproved && !blockedByUnmapped && !needsNote && !isSaving;

    const shown = isApproved
        ? {
            budgetMinutes: approval.budgetMinutes,
            eligibleMinutes: approval.eligibleMinutes,
            nonBudgetMinutes: approval.nonBudgetMinutes,
        }
        : snapshot;

    return (
        <aside
            aria-label={`${clientName} ${month} close`}
            className="flex h-full w-full flex-col rounded-xl border border-border bg-card"
        >
            <header className="border-b border-border p-5">
                <h2 className="text-lg font-semibold text-foreground">{clientName}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{month} client close</p>

                {isApproved && (
                    <p className="mt-3 flex items-center gap-2 text-sm text-emerald-500">
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Approved {new Date(approval.approvedAt).toLocaleDateString()}
                    </p>
                )}
            </header>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
                <section>
                    <h3 className="text-sm font-medium text-foreground">Reconciliation</h3>
                    <dl className="mt-3 space-y-2 rounded-lg border border-border bg-background p-4 text-sm">
                        <div className="flex justify-between">
                            <dt className="text-muted-foreground">Contracted budget</dt>
                            <dd className="tabular-nums text-foreground">
                                {formatDuration(shown.budgetMinutes, { zero: '0m' })}
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-muted-foreground">SEO budget used</dt>
                            <dd className="tabular-nums text-primary">
                                {formatDuration(shown.eligibleMinutes, { zero: '0m' })}
                                <span className="ml-2 text-xs text-muted-foreground">
                                    {percentOf(shown.eligibleMinutes, shown.budgetMinutes)}%
                                </span>
                            </dd>
                        </div>
                        <div className="flex justify-between">
                            <dt className="text-muted-foreground">Non-budget time</dt>
                            <dd className="tabular-nums text-muted-foreground">
                                {formatDuration(shown.nonBudgetMinutes, { zero: '0m' })}
                            </dd>
                        </div>
                        <div className="flex justify-between border-t border-border pt-2">
                            <dt className="text-muted-foreground">
                                {snapshot.overBudget ? 'Over budget by' : 'Remaining'}
                            </dt>
                            <dd className={cn(
                                'tabular-nums',
                                snapshot.overBudget ? 'text-amber-500' : 'text-foreground',
                            )}>
                                {formatDuration(Math.abs(snapshot.remainingMinutes), { zero: '0m' })}
                            </dd>
                        </div>
                    </dl>
                </section>

                <section>
                    <h3 className="text-sm font-medium text-foreground">Teammate breakdown</h3>
                    {snapshot.members.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">No time logged this month.</p>
                    ) : (
                        <ul className="mt-3 space-y-2">
                            {snapshot.members.map(member => (
                                <li
                                    key={member.userId}
                                    className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3 text-sm"
                                >
                                    <span className="text-foreground">
                                        {memberNames[member.userId] ?? 'Unassigned'}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground">
                                        {formatDuration(member.eligibleMinutes, { zero: '0m' })} budget
                                        <span aria-hidden className="mx-1.5">·</span>
                                        {formatDuration(member.totalMinutes, { zero: '0m' })} total
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {blockedByUnmapped && (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-500">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        {snapshot.unmappedCount} unmapped{' '}
                        {snapshot.unmappedCount === 1 ? 'entry' : 'entries'} must be resolved on the
                        Team tab before this month can be approved.
                    </p>
                )}

                {changes.length > 0 && (
                    <section>
                        <h3 className="flex items-center gap-2 text-sm font-medium text-amber-500">
                            <History className="h-4 w-4" aria-hidden />
                            Changed after approval
                        </h3>
                        <ul className="mt-3 space-y-2">
                            {changes.map(change => (
                                <li
                                    key={`${change.kind}-${change.timeLogId}`}
                                    className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm"
                                >
                                    <p className="text-foreground">{CHANGE_LABELS[change.kind]}</p>
                                    <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                                        Approved {formatDuration(change.approvedMinutes, { zero: '0m' })}
                                        {' → now '}
                                        {formatDuration(change.currentMinutes, { zero: '0m' })}
                                    </p>
                                </li>
                            ))}
                        </ul>
                        <p className="mt-2 text-xs text-muted-foreground">
                            The approved snapshot is unchanged. Reopen the month to approve a new one.
                        </p>
                    </section>
                )}

                <div>
                    <label htmlFor="approval-note" className="block text-sm font-medium text-foreground">
                        Note{snapshot.requiresNote && !isApproved ? ' (required — over budget)' : ' (optional)'}
                    </label>
                    <textarea
                        id="approval-note"
                        rows={3}
                        value={note}
                        onChange={event => setNote(event.target.value)}
                        placeholder={snapshot.overBudget
                            ? 'Explain the over-budget month…'
                            : 'Anything the client should know…'}
                        className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                </div>

                {approval?.note && (
                    <p className="rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
                        Approval note: {approval.note}
                    </p>
                )}

                {error && (
                    <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {error}
                    </p>
                )}
            </div>

            <footer className="border-t border-border p-5">
                {isApproved ? (
                    <button
                        type="button"
                        onClick={() => onReopen(note)}
                        disabled={isSaving}
                        className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        {isSaving ? 'Reopening…' : 'Reopen month'}
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={() => onApprove(note)}
                        disabled={!canApprove}
                        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        {isSaving
                            ? 'Approving…'
                            : `Approve ${formatDuration(snapshot.eligibleMinutes, { zero: '0m' })} for ${month}`}
                    </button>
                )}
            </footer>
        </aside>
    );
}
