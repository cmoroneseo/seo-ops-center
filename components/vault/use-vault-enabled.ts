'use client';

import { useEffect, useState } from 'react';

const cache = new Map<string, boolean>();

/** Null while the flag is unknown. False hides the vault. True shows it. */
export function useVaultEnabled(organizationId?: string | null): boolean | null {
    const [enabled, setEnabled] = useState<boolean | null>(
        organizationId && cache.has(organizationId) ? cache.get(organizationId)! : null,
    );

    useEffect(() => {
        if (!organizationId) {
            setEnabled(null);
            return;
        }
        if (!cache.has(organizationId)) setEnabled(null);
        let cancelled = false;
        fetch('/api/vault/availability')
            .then(response => response.ok ? response.json() : { enabled: false })
            .then(body => {
                const value = body?.enabled === true;
                cache.set(organizationId, value);
                if (!cancelled) setEnabled(value);
            })
            .catch(() => {
                if (!cancelled) setEnabled(false);
            });
        return () => { cancelled = true; };
    }, [organizationId]);

    return enabled;
}
