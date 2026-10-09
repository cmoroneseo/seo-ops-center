'use client';

import { formatDelta } from '@/lib/reports/delta';

const TONE_COLOR = {
    neutral: '#6b7280',
    good: '#16a34a',
    bad: '#dc2626',
} as const;

export function MoMDelta({
    current,
    previous,
    lowerIsBetter,
    scale,
}: {
    current: unknown;
    previous: unknown;
    lowerIsBetter?: boolean;
    scale?: number;
}) {
    const delta = formatDelta(current, previous, { lowerIsBetter, scale });
    if (delta.kind === 'missing') return null;

    return (
        <span className="inline-flex items-center text-[11px] font-semibold" style={{ color: TONE_COLOR[delta.tone] }}>
            {delta.text}
        </span>
    );
}
