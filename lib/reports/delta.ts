// Month-over-month display for report cards. PR 4a replaces this stub with the
// shared reporting rule; the noise band, small-base, and missing-baseline
// behavior below is the part October reports already have to get right.

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

function finiteNumber(value: unknown): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'boolean') return null;
    const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : Number.NaN;
    return Number.isFinite(numeric) ? numeric : null;
}

function formatAbs(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Honest month-over-month text. Missing stays missing; a real zero stays zero. */
export function formatDelta(current: unknown, previous: unknown, ctx: DeltaFormatContext = {}): FormattedDelta {
    const currentNumber = finiteNumber(current);
    if (currentNumber == null) return { kind: 'missing', text: '—', tone: 'neutral' };
    const previousNumber = finiteNumber(previous);
    if (previousNumber == null) return { kind: 'no_baseline', text: 'No comparable baseline', tone: 'neutral' };

    const scale = ctx.scale != null && ctx.scale > 0 ? ctx.scale : 1;
    const scaledCurrent = currentNumber * scale;
    const scaledPrevious = previousNumber * scale;
    const delta = scaledCurrent - scaledPrevious;
    const band = 2 * Math.sqrt(Math.max(Math.abs(scaledCurrent), Math.abs(scaledPrevious)));
    if (Math.abs(delta) <= band) return { kind: 'noise', text: '≈', tone: 'neutral' };

    const direction: 'up' | 'down' = delta > 0 ? 'up' : 'down';
    const good = ctx.lowerIsBetter ? direction === 'down' : direction === 'up';
    const absolute = Math.abs(delta);
    const base = Math.abs(scaledPrevious);
    const percent = base >= 100 ? (delta / base) * 100 : undefined;
    const arrow = direction === 'up' ? '▲' : '▼';
    const text = percent == null
        ? `${arrow} ${formatAbs(absolute)}`
        : `${arrow} ${formatAbs(absolute)} (${Math.abs(percent).toFixed(1)}%)`;
    return { kind: 'change', text, tone: good ? 'good' : 'bad', direction, absolute, percent };
}
