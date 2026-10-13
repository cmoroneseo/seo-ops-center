'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { VAULT_TYPE_LABEL, type VaultSuggestion } from '@/lib/vault/types';
import { formatVaultCount } from '@/lib/vault/permissions';

export function InboxLite({
    suggestions,
    loaded,
    busyId,
    onAccept,
    onDismiss,
}: {
    suggestions: VaultSuggestion[] | null;
    loaded: boolean;
    busyId: string | null;
    onAccept: (id: string) => void;
    onDismiss: (id: string, reason: string) => void;
}) {
    const [reasonFor, setReasonFor] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    return (
        <section aria-label="Vault proposals to review" className="rounded-xl border border-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold">To review</h3>
                <span className="tabular-nums text-sm text-muted-foreground">{loaded ? formatVaultCount(suggestions?.length ?? null) : '—'}</span>
            </header>
            <div className="space-y-3 p-3">
                {!loaded && <div className="h-16 animate-pulse rounded-lg bg-muted/50" />}
                {loaded && suggestions == null && (
                    <p className="px-1 py-4 text-sm text-destructive" role="alert">Proposals could not be loaded.</p>
                )}
                {loaded && suggestions && suggestions.length === 0 && (
                    <p className="px-1 py-4 text-sm text-muted-foreground">No proposals waiting.</p>
                )}
                {loaded && suggestions?.map(suggestion => (
                    <article key={suggestion.id} className="rounded-lg border border-border p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{VAULT_TYPE_LABEL[suggestion.payload.entryType]}</p>
                        <h4 className="mt-1 text-sm font-medium">{suggestion.payload.title}</h4>
                        <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{suggestion.payload.body}</p>
                        <p className="mt-2 text-xs text-muted-foreground">Proposed by {suggestion.proposedByName || 'a teammate'}</p>
                        <div className="mt-3 flex gap-2">
                            <Button type="button" size="sm" disabled={busyId === suggestion.id} onClick={() => onAccept(suggestion.id)}>Accept</Button>
                            <Button type="button" size="sm" variant="outline" disabled={busyId === suggestion.id} onClick={() => { setReasonFor(suggestion.id); setReason(''); }}>Dismiss</Button>
                        </div>
                        {reasonFor === suggestion.id && (
                            <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); onDismiss(suggestion.id, reason.trim()); }}>
                                <label className="block text-xs text-muted-foreground" htmlFor={`dismiss-${suggestion.id}`}>Reason, optional</label>
                                <input id={`dismiss-${suggestion.id}`} value={reason} onChange={event => setReason(event.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" />
                                <Button type="submit" size="sm" variant="secondary" disabled={busyId === suggestion.id}>Confirm dismiss</Button>
                            </form>
                        )}
                    </article>
                ))}
            </div>
        </section>
    );
}
