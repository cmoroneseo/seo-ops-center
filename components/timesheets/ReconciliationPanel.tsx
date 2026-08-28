'use client';

import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BackfillMember } from './BackfillControl';
import type { Reconciliation } from '@/lib/timesheets/reconciliation';

/**
 * Proof that an import is COMPLETE, not merely plausible.
 *
 * The import fingerprints every row, so both sides have always been
 * comparable — nothing ever compared them. Approving hours onto a client's
 * budget meant trusting that whatever arrived was everything, and when two of
 * Abel's entries appeared to be missing there was no way to check short of
 * reading the Basecamp API by hand, which is exactly how they got wrongly
 * declared deleted.
 */

interface ReconciliationPanelProps {
    organizationId: string;
    members: BackfillMember[];
}

type Result = Reconciliation & { from: string; to: string };

function firstOfMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

function today(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function ReconciliationPanel({ organizationId, members }: ReconciliationPanelProps) {
    const available = members.filter(member => member.hasBasecampPerson);
    const [userId, setUserId] = useState(available[0]?.userId ?? '');
    const [from, setFrom] = useState(firstOfMonth);
    const [to, setTo] = useState(today);
    const [result, setResult] = useState<Result | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isChecking, setIsChecking] = useState(false);

    if (available.length === 0) return null;

    const check = async () => {
        setIsChecking(true);
        setError(null);
        setResult(null);
        try {
            const params = new URLSearchParams({ organizationId, userId, from, to });
            const res = await fetch(`/api/timesheets/reconcile?${params}`);
            const body = await res.json().catch(() => null);
            if (!res.ok) {
                setError(body?.error ?? 'Could not compare with Basecamp.');
                return;
            }
            setResult(body as Result);
        } catch {
            setError('Could not reach Basecamp.');
        } finally {
            setIsChecking(false);
        }
    };

    const fieldCls = 'min-h-9 rounded-lg bg-background/60 px-2.5 py-1.5 text-xs outline-none ring-1 ring-inset ring-border focus:ring-primary';

    return (
        <div className="mx-6 mt-4 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">Compare with Basecamp</span>
                    <select value={userId} onChange={e => setUserId(e.target.value)} className={cn(fieldCls, 'min-w-40')}>
                        {available.map(member => (
                            <option key={member.userId} value={member.userId}>{member.label}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">From</span>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={fieldCls} />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground">To</span>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)} className={fieldCls} />
                </label>
                <button
                    type="button"
                    onClick={() => void check()}
                    disabled={isChecking || !userId}
                    className="flex min-h-9 items-center gap-2 rounded-lg bg-primary/25 px-3 text-xs font-medium text-primary transition-colors hover:bg-primary/35 disabled:opacity-50"
                >
                    <RefreshCw className={cn('h-3.5 w-3.5', isChecking && 'animate-spin')} />
                    {isChecking ? 'Checking' : 'Check'}
                </button>
            </div>

            {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}

            {result && (
                <div className="mt-3 space-y-2">
                    <div className={cn(
                        'flex items-center gap-2 text-xs font-medium',
                        result.balanced ? 'text-primary' : 'text-amber-500',
                    )}>
                        {result.balanced
                            ? <CheckCircle2 className="h-4 w-4" />
                            : <AlertTriangle className="h-4 w-4" />}
                        {result.balanced
                            ? `Everything matches — ${result.matched.length} entries, ${result.matchedHours}h`
                            : 'These do not agree'}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                            <div className="text-muted-foreground">In Basecamp</div>
                            <div className="text-sm font-semibold">{result.providerHours}h</div>
                        </div>
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                            <div className="text-muted-foreground">In SEO PM</div>
                            <div className="text-sm font-semibold">{result.localHours}h</div>
                        </div>
                        <div className="rounded-lg bg-muted/30 px-2.5 py-2">
                            <div className="text-muted-foreground">Matched</div>
                            <div className="text-sm font-semibold">{result.matchedHours}h</div>
                        </div>
                    </div>

                    {result.providerOnly.length > 0 && (
                        <div>
                            <p className="text-[11px] font-medium text-amber-500">
                                In Basecamp, missing here — re-run the import
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                {result.providerOnly.map(entry => (
                                    <li key={entry.fingerprint} className="text-[11px] text-muted-foreground">
                                        {entry.date} · {entry.hours}h · {entry.projectName}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {result.localOnly.length > 0 && (
                        <div>
                            <p className="text-[11px] font-medium text-amber-500">
                                Here, not in Basecamp — deleted there, or logged in SEO PM
                            </p>
                            <ul className="mt-1 space-y-0.5">
                                {result.localOnly.map(entry => (
                                    <li key={entry.id} className="text-[11px] text-muted-foreground">
                                        {entry.date} · {entry.hours}h
                                        {entry.clientName ? ` · ${entry.clientName}` : ''}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
