'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * One line in the Overview Impact lane. The lane layout stays as it is.
 * Hidden unless both the canvas and search-reporting flags are on.
 */
export function LatestResultLink({ clientId }: { clientId: string }) {
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
    const [latest, setLatest] = useState<{ title: string; verdict: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        setState('loading');
        fetch(`/api/search-reporting/ledger?clientId=${encodeURIComponent(clientId)}`)
            .then(async (response) => {
                if (!response.ok) throw new Error('load');
                return response.json() as Promise<{ latest?: { title: string; verdict: string } | null }>;
            })
            .then((body) => {
                if (cancelled) return;
                setLatest(body.latest ?? null);
                setState('ready');
            })
            .catch(() => {
                if (!cancelled) setState('error');
            });
        return () => { cancelled = true; };
    }, [clientId]);

    const href = `/workspace/${clientId}?tab=campaign&planView=results`;
    if (state === 'loading') return null;
    const text = state === 'error'
        ? 'Results could not be loaded → Results'
        : latest
            ? `Latest result: ${latest.title} · ${latest.verdict} → Results`
            : 'No shipped work recorded yet → Results';
    return (
        <Link href={href} className="mt-2 block text-xs font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {text}
        </Link>
    );
}
