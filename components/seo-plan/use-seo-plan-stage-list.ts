'use client';

import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';

const cache = new Map<string, boolean>();

const SeoPlanStageListContext = createContext<boolean>(false);

/** Server layout seeds the flag so the plan tab does not flash the other list. */
export function SeoPlanStageListProvider({
    enabled,
    children,
}: {
    enabled: boolean;
    children: ReactNode;
}) {
    return createElement(SeoPlanStageListContext.Provider, { value: enabled }, children);
}

/**
 * False keeps the current SEO Plan. True shows the stage-grouped task list.
 * The availability route derives the organization from the session.
 */
export function useSeoPlanStageList(organizationId?: string | null): boolean {
    const seeded = useContext(SeoPlanStageListContext);
    const [enabled, setEnabled] = useState<boolean>(() => {
        if (organizationId && cache.has(organizationId)) return cache.get(organizationId)!;
        return seeded;
    });

    useEffect(() => {
        if (!organizationId) {
            setEnabled(seeded);
            return;
        }
        const cached = cache.get(organizationId);
        if (cached != null) setEnabled(cached);
        else setEnabled(seeded);
        let cancelled = false;
        fetch('/api/seo-plan/stage-list/availability')
            .then(response => response.ok ? response.json() : { enabled: false })
            .then(body => {
                const value = body?.enabled === true;
                cache.set(organizationId, value);
                if (!cancelled) setEnabled(value);
            })
            .catch(() => {
                if (!cancelled && cached == null) setEnabled(seeded);
            });
        return () => { cancelled = true; };
    }, [organizationId, seeded]);

    return enabled;
}
