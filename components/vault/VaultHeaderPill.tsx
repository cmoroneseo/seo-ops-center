'use client';

import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { getVaultCounts, VaultRequestError } from '@/lib/supabase/vault';
import { canAdministerVault, formatVaultCount } from '@/lib/vault/permissions';
import type { VaultCounts } from '@/lib/vault/types';
import { useVaultEnabled } from './use-vault-enabled';

const UNKNOWN: VaultCounts = { active: null, inbox: null };

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
    const [counts, setCounts] = useState<VaultCounts>(UNKNOWN);

    useEffect(() => {
        if (enabled !== true) return;
        let cancelled = false;
        setCounts(UNKNOWN);
        getVaultCounts(clientId)
            .then(result => { if (!cancelled) setCounts(result.counts); })
            .catch((error: unknown) => {
                if (cancelled) return;
                if (error instanceof VaultRequestError && error.status === 404) return;
                setCounts(UNKNOWN);
            });
        return () => { cancelled = true; };
    }, [clientId, enabled]);

    if (enabled !== true) return null;

    const inbox = !isLoading && canAdministerVault(role) ? counts.inbox : null;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-foreground hover:bg-muted"
            aria-label={`Context Vault, ${formatVaultCount(counts.active)} active`}
        >
            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Vault</span>
            <span className="tabular-nums text-muted-foreground">{formatVaultCount(counts.active)}</span>
            {inbox != null && inbox > 0 && (
                <span className="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {inbox} to review
                </span>
            )}
        </button>
    );
}
