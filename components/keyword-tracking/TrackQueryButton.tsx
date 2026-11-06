'use client';

import { useState } from 'react';

import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { addTrackedKeywords } from '@/lib/keyword-tracking/store';

export function TrackQueryButton({
    organizationId,
    clientId,
    query,
}: {
    organizationId: string;
    clientId: string;
    query: string;
}) {
    const [state, setState] = useState<'idle' | 'busy' | 'done' | 'cap' | 'error'>('idle');
    const [detail, setDetail] = useState('');
    if (!keywordTrackingEnabled()) return null;

    async function onTrack(event: { preventDefault(): void; stopPropagation(): void }) {
        event.preventDefault();
        event.stopPropagation();
        if (state === 'busy' || state === 'done') return;
        setState('busy');
        const result = await addTrackedKeywords({
            organizationId,
            clientId,
            entries: [query],
            source: 'gsc_promote',
        });
        if (!result.ok) {
            setState('error');
            setDetail(result.message);
            return;
        }
        const added = result.plan.insert.length + result.plan.reactivate.length;
        if (result.plan.rejectedByCap.length > 0 && added === 0) {
            setState('cap');
            setDetail(result.message);
            return;
        }
        setState('done');
        setDetail(result.message);
    }

    const label = state === 'busy' ? 'Tracking…' : state === 'done' ? 'Tracked' : state === 'cap' ? 'At cap' : 'Track';
    const accessible = state === 'done' ? `Tracked ${query}` : state === 'cap' ? `Keyword cap reached for ${query}` : `Track ${query}`;
    return (
        <button
            type="button"
            data-track-query={query}
            aria-label={accessible}
            aria-pressed={state === 'done'}
            disabled={state === 'busy' || state === 'done'}
            title={detail || `Track ${query}`}
            onMouseDown={event => event.stopPropagation()}
            onClick={onTrack}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
            {label}
        </button>
    );
}
