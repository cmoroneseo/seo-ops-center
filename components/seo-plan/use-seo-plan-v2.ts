'use client';

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

const cache = new Map<string, boolean>();

const SeoPlanV2Context = createContext<boolean | null>(null);

/** Server layout seeds the flag so the client page does not paint the wrong shell. */
export function SeoPlanV2Provider({
    enabled,
    children,
}: {
    enabled: boolean | null;
    children: ReactNode;
}) {
    return createElement(SeoPlanV2Context.Provider, { value: enabled }, children);
}

/** Null while the flag is unknown. False keeps the current workspace. True shows Plan v2. */
export function useSeoPlanV2(organizationId?: string | null): boolean | null {
    const seeded = useContext(SeoPlanV2Context);
    const [enabled, setEnabled] = useState<boolean | null>(() => {
        if (organizationId && cache.has(organizationId)) return cache.get(organizationId)!;
        return seeded;
    });

    useEffect(() => {
        if (!organizationId) {
            if (seeded == null) setEnabled(null);
            else setEnabled(seeded);
            return;
        }
        const cached = cache.get(organizationId);
        if (cached != null) setEnabled(cached);
        else if (seeded != null) setEnabled(seeded);
        let cancelled = false;
        fetch('/api/seo-plan/availability')
            .then(response => response.ok ? response.json() : { enabled: false })
            .then(body => {
                const value = body?.enabled === true;
                cache.set(organizationId, value);
                if (!cancelled) setEnabled(value);
            })
            .catch(() => {
                if (cancelled) return;
                if (cached == null && seeded == null) setEnabled(false);
            });
        return () => { cancelled = true; };
    }, [organizationId, seeded]);

    return enabled;
}
