// October report cards. The comparison itself lives in `lib/reporting/delta.ts`.
// This wrapper keeps the presentation those cards already shipped: a bare "≈",
// arrows that follow the number, a real zero prior left as a change, and the
// percent written inline once the base is at least 100.

import { formatDelta as formatReportingDelta } from '../reporting/delta';

export interface DeltaFormatContext {
    lowerIsBetter?: boolean;
    /**
     * Multiply both values before comparing. Percent metrics are stored as
     * 0–1, so pass 100 to test the noise band on the percentage points a
     * reader actually sees (42 vs 55, not 0.42 vs 0.55).
     */
    scale?: number;
}

export interface FormattedDelta {
    kind: 'missing' | 'no_baseline' | 'noise' | 'change';
    /** "—", "No comparable baseline", "≈", or an absolute change such as "▲ 12". */
    text: string;
    tone: 'neutral' | 'good' | 'bad';
    direction?: 'up' | 'down';
    /** Unsigned change, on the scaled unit when `scale` is set. */
    absolute?: number;
    /** Present only when the prior value's absolute base is at least 100. */
    percent?: number;
}

/** Honest month-over-month text. Missing stays missing; a real zero stays zero. */
export function formatDelta(current: unknown, previous: unknown, ctx: DeltaFormatContext = {}): FormattedDelta {
    const result = formatReportingDelta(current, previous, {
        presentation: 'legacy',
        lowerIsBetter: ctx.lowerIsBetter,
        scale: ctx.scale,
    });

    if (result.kind === 'change') {
        return {
            kind: 'change',
            text: result.text,
            tone: result.tone,
            direction: result.numericDirection,
            absolute: result.absolute,
            percent: result.percent,
        };
    }

    const kind = result.kind === 'noise' || result.kind === 'no_baseline' ? result.kind : 'missing';
    return { kind, text: result.kind === 'distorted' ? '—' : result.text, tone: 'neutral' };
}
