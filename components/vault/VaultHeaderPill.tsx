'use client';

import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getVaultCounts, VaultRequestError } from '@/lib/supabase/vault';
import { canAdministerVault, formatVaultCount } from '@/lib/vault/permissions';
import type { VaultCounts } from '@/lib/vault/types';
import { useVaultEnabled } from './use-vault-enabled';

const countsCache = new Map<string, VaultCounts>();

type VaultBadge =
    | { kind: 'loading' }
    | { kind: 'ready'; counts: VaultCounts }
    | { kind: 'unknown' };

export function VaultHeaderPill({
    clientId,
    organizationId,
    onOpen,
}: {
    clientId: string;
    organizationId?: string | null;
    onOpen: () => void;
}) {
    const enabled = useVaultEnabled(organizationId);
    const { role, isLoading } = useCurrentMember();
    const [badge, setBadge] = useState<VaultBadge>(() => {
        const hit = countsCache.get(clientId);
        return hit ? { kind: 'ready', counts: hit } : { kind: 'loading' };
    });

    useEffect(() => {
        if (enabled !== true) return;
        const hit = countsCache.get(clientId);
        setBadge(hit ? { kind: 'ready', counts: hit } : { kind: 'loading' });
        let cancelled = false;
        getVaultCounts(clientId)
            .then(result => {
                if (cancelled) return;
                countsCache.set(clientId, result.counts);
                setBadge({ kind: 'ready', counts: result.counts });
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                const fallback = countsCache.get(clientId);
                if (fallback && !(error instanceof VaultRequestError && error.status === 404)) {
                    setBadge({ kind: 'ready', counts: fallback });
                    return;
                }
                setBadge({ kind: 'unknown' });
            });
        return () => { cancelled = true; };
    }, [clientId, enabled]);

    if (enabled !== true) return null;

    const counts = badge.kind === 'ready' ? badge.counts : null;
    const activeLabel = badge.kind === 'loading' ? 'loading' : formatVaultCount(counts?.active);
    const inbox = !isLoading && canAdministerVault(role) && counts ? counts.inbox : null;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-foreground hover:bg-muted"
            aria-label={badge.kind === 'loading' ? 'Context Vault, loading' : `Context Vault, ${activeLabel} active`}
        >
            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Vault</span>
            {badge.kind === 'loading' ? (
                <span className="inline-block h-4 w-4 animate-pulse rounded bg-muted" aria-hidden="true" />
            ) : (
                <span className="tabular-nums text-muted-foreground">{formatVaultCount(counts?.active)}</span>
            )}
            {inbox != null && inbox > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {inbox} to review
                </span>
            )}
        </button>
    );
}
