'use client';

import { Button } from '@/components/ui/button';
import { VAULT_TYPE_LABEL, type VaultSuggestion } from '@/lib/vault/types';
import { formatVaultCount } from '@/lib/vault/permissions';

const STATUS_LABEL = { pending: 'Pending', accepted: 'Accepted', dismissed: 'Dismissed', withdrawn: 'Withdrawn' };

export function MyProposals({
    suggestions,
    loaded,
    busyId,
    onWithdraw,
}: {
    suggestions: VaultSuggestion[] | null;
    loaded: boolean;
    busyId: string | null;
    onWithdraw: (id: string) => void;
}) {
    return (
        <section aria-label="Your vault proposals" className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">Your proposals</h3>
                <span className="tabular-nums text-sm text-muted-foreground">{loaded ? formatVaultCount(suggestions?.length ?? null) : '—'}</span>
            </header>
            <div className="space-y-3 p-3">
                {!loaded && <div className="h-16 animate-pulse rounded-lg bg-muted/50" />}
                {loaded && suggestions == null && (
                    <p className="px-1 py-4 text-sm text-destructive" role="alert">Proposals could not be loaded.</p>
                )}
                {loaded && suggestions && suggestions.length === 0 && (
                    <p className="px-1 py-4 text-sm text-muted-foreground">You have not proposed anything for this client.</p>
                )}
                {loaded && suggestions?.map(suggestion => (
                    <article key={suggestion.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{VAULT_TYPE_LABEL[suggestion.payload.entryType]}</p>
                            <p className="text-xs text-muted-foreground">{STATUS_LABEL[suggestion.status]}</p>
                        </div>
                        <h4 className="mt-1 text-sm font-medium">{suggestion.payload.title}</h4>
                        {suggestion.status === 'dismissed' && suggestion.dismissReason && (
                            <p className="mt-1 text-xs text-muted-foreground">{suggestion.dismissReason}</p>
                        )}
                        {suggestion.status === 'accepted' && (
                            <p className="mt-1 text-xs text-muted-foreground">Saved{suggestion.resolvedByName ? ` by ${suggestion.resolvedByName}` : ''}.</p>
                        )}
                        {suggestion.status === 'pending' && (
                            <Button type="button" size="sm" variant="outline" className="mt-3" disabled={busyId === suggestion.id} onClick={() => onWithdraw(suggestion.id)}>Withdraw</Button>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}
