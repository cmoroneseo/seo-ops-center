'use client';

import { useEffect, useState } from 'react';
import { SourceChip } from '@/components/reporting/SourceChip';
import { freshnessValue, opportunityMonthRange } from '@/lib/opportunities/view';

interface FreshnessGap {
    id: string;
    label: string;
    value: string;
    detail: string;
}

interface FreshnessModel {
    sourceLabel: string;
    historyRangeLabel: string;
    banner: string | null;
    gaps: FreshnessGap[];
}

function readModel(value: unknown): FreshnessModel | null {
    if (!value || typeof value !== 'object') return null;
    const body = value as Record<string, unknown>;
    if (typeof body.sourceLabel !== 'string' || !Array.isArray(body.gaps)) return null;
    const gaps: FreshnessGap[] = [];
    for (const item of body.gaps) {
        if (!item || typeof item !== 'object') continue;
        const gap = item as Record<string, unknown>;
        if (typeof gap.id !== 'string' || typeof gap.label !== 'string') continue;
        gaps.push({
            id: gap.id,
            label: gap.label,
            value: freshnessValue(gap.value),
            detail: typeof gap.detail === 'string' ? gap.detail : '',
        });
    }
    return {
        sourceLabel: body.sourceLabel,
        historyRangeLabel: typeof body.historyRangeLabel === 'string' ? body.historyRangeLabel : '',
        banner: typeof body.banner === 'string' && body.banner.trim() ? body.banner : null,
        gaps,
    };
}

/** Compact ledger from the existing search-reporting endpoint. No second results list. */
export function PerformanceFreshness({ clientId, refreshKey }: { clientId: string; refreshKey: string }) {
    const [model, setModel] = useState<FreshnessModel | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        const controller = new AbortController();
        const params = new URLSearchParams({ clientId });
        const month = typeof window === 'undefined'
            ? null
            : opportunityMonthRange(new URLSearchParams(window.location.search).get('range'));
        if (month) params.set('range', month);
        setState('loading');
        fetch(`/api/search-reporting/ledger?${params}`, { signal: controller.signal, cache: 'no-store' })
            .then(async response => {
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error('ledger');
                const next = readModel(body);
                if (!next) throw new Error('ledger');
                if (!controller.signal.aborted) {
                    setModel(next);
                    setState('ready');
                }
            })
            .catch(() => {
                if (controller.signal.aborted) return;
                setModel(null);
                setState('error');
            });
        return () => controller.abort();
    }, [clientId, refreshKey]);

    if (state === 'loading') {
        return <p role="status" className="text-xs text-muted-foreground">Loading freshness…</p>;
    }
    if (state === 'error' || !model) {
        return <p role="status" className="text-xs text-muted-foreground">Freshness could not be loaded.</p>;
    }

    return (
        <section aria-label="Freshness" className="rounded-lg border border-border bg-card px-3 py-2">
            <SourceChip source={model.sourceLabel} rangeLabel={model.historyRangeLabel} />
            {model.banner ? <p className="mt-1 text-xs text-muted-foreground">{model.banner}</p> : null}
            {model.gaps.length > 0 ? (
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {model.gaps.map(gap => (
                        <li key={gap.id} className="text-xs" title={gap.detail || undefined}>
                            <span className="text-muted-foreground">{gap.label}</span>
                            {' '}
                            <span className="font-medium tabular-nums text-foreground">{gap.value}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </section>
    );
}
