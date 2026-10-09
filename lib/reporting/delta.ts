/**
 * The one comparison rule for reporting surfaces.
 *
 * October reports still call `lib/reports/delta.ts`, which passes
 * `presentation: 'legacy'` so their text stays put: a bare "≈", arrows that
 * follow the number, a real zero prior kept as a change, and the percent
 * inline. The default presentation is the review rule set.
 */

export const MISSING_VALUE = '—';
export const NO_COMPARABLE_BASELINE = 'No comparable baseline';
export const POSITION_HEADER = 'lower is better';
export const DISTORTED_FALLBACK_REASON = 'Comparison window is distorted.';

const MINUS = '−';

export type DeltaKind = 'missing' | 'no_baseline' | 'noise' | 'change' | 'distorted';
export type DeltaTone = 'neutral' | 'good' | 'bad';
export type DeltaDirection = 'up' | 'down';

export interface FormatDeltaContext {
    metric?: 'count' | 'position';
    lowerIsBetter?: boolean;
    /** Staff tiles keep the percent off the face of the number. */
    audience?: 'staff' | 'client';
    /**
     * Multiply both values before comparing. Percent metrics are stored as
     * 0–1, so pass 100 to test the band on the points a reader sees.
     */
    scale?: number;
    /**
     * `legacy` is the October report card. `reporting` is the shared rule.
     */
    presentation?: 'legacy' | 'reporting';
    /** Set when the comparison window itself is distorted for this surface. */
    distorted?: { reason?: string; priorLabel?: string } | null;
}

export interface FormattedDelta {
    kind: DeltaKind;
    text: string;
    tone: DeltaTone;
    /** Arrow direction. ▲ is `up`. For position, up means the rank improved. */
    direction?: DeltaDirection;
    /** Sign of current − previous. October copy uses this for "higher" / "lower". */
    numericDirection?: DeltaDirection;
    absolute?: number;
    /** Signed percent. Present only when the absolute prior base is at least 100. */
    percent?: number;
    /** Staff hover label. Absent under a base of 100 and on client surfaces. */
    percentHover?: string;
    priorLabel?: string;
    reason?: string;
    /** Set for position metrics so column headers can say "lower is better". */
    header?: string;
}

function finiteNumber(value: unknown): number | null {
    if (value == null || value === '') return null;
    if (typeof value === 'boolean') return null;
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number(value.trim())
            : Number.NaN;
    return Number.isFinite(numeric) ? numeric : null;
}

function formatAbs(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatSigned(delta: number): string {
    const rounded = Math.round(delta * 10) / 10;
    if (rounded === 0) return '0';
    const body = formatAbs(Math.abs(rounded));
    return rounded < 0 ? `${MINUS}${body}` : `+${body}`;
}

/** `|a−b| ≤ 2·√max(a,b)` for non-negative counts. Negatives use the absolute peak. */
export function noiseLimit(a: number, b: number): number {
    const peak = Math.max(a, b);
    const root = peak >= 0 ? peak : Math.max(Math.abs(a), Math.abs(b));
    return 2 * Math.sqrt(root);
}

export function deltaColumnHeader(label: string, metric: 'count' | 'position' = 'count'): string {
    if (metric !== 'position') return label;
    return `${label} (${POSITION_HEADER})`;
}

function baseResult(kind: DeltaKind, text: string, tone: DeltaTone = 'neutral'): FormattedDelta {
    return { kind, text, tone };
}

export function formatDelta(current: unknown, previous: unknown, ctx: FormatDeltaContext = {}): FormattedDelta {
    const presentation = ctx.presentation ?? 'reporting';
    const legacy = presentation === 'legacy';
    const header = ctx.metric === 'position' ? POSITION_HEADER : undefined;

    if (ctx.distorted) {
        const reason = ctx.distorted.reason?.trim() || DISTORTED_FALLBACK_REASON;
        const priorNumber = finiteNumber(previous);
        const priorLabel = ctx.distorted.priorLabel?.trim()
            || (priorNumber == null ? MISSING_VALUE : formatAbs(Math.abs(priorNumber)));
        return { ...baseResult('distorted', ''), priorLabel, reason, header };
    }

    const currentNumber = finiteNumber(current);
    if (currentNumber == null) return baseResult('missing', MISSING_VALUE);
    const previousNumber = finiteNumber(previous);
    if (previousNumber == null) return baseResult('no_baseline', NO_COMPARABLE_BASELINE);

    const scale = ctx.scale != null && ctx.scale > 0 ? ctx.scale : 1;
    const scaledCurrent = currentNumber * scale;
    const scaledPrevious = previousNumber * scale;
    if (!legacy && scaledPrevious === 0) return baseResult('no_baseline', NO_COMPARABLE_BASELINE);

    const delta = scaledCurrent - scaledPrevious;
    const absolute = Math.abs(delta);
    const numericDirection: DeltaDirection = delta > 0 ? 'up' : 'down';
    const lowerIsBetter = ctx.metric === 'position' || ctx.lowerIsBetter === true;
    const improved = lowerIsBetter ? numericDirection === 'down' : numericDirection === 'up';
    const arrowDirection: DeltaDirection = improved ? 'up' : 'down';
    const tone: DeltaTone = improved ? 'good' : 'bad';
    const base = Math.abs(scaledPrevious);
    const percent = base >= 100 ? (delta / base) * 100 : undefined;
    const withinNoise = absolute <= noiseLimit(scaledCurrent, scaledPrevious);

    if (withinNoise) {
        const reportingText = `≈ ${formatSigned(delta)}`;
        return {
            kind: 'noise',
            text: legacy ? '≈' : reportingText,
            tone: 'neutral',
            header,
        };
    }

    const shownArrow = (legacy ? numericDirection : arrowDirection) === 'up' ? '▲' : '▼';
    const amount = formatAbs(absolute);
    const legacyText = percent == null
        ? `${shownArrow} ${amount}`
        : `${shownArrow} ${amount} (${Math.abs(percent).toFixed(1)}%)`;
    const reportingArrow = arrowDirection === 'up' ? '▲' : '▼';
    const reportingText = `${reportingArrow} ${amount}`;
    const audience = ctx.audience ?? 'staff';
    const percentHover = !legacy && audience === 'staff' && percent != null
        ? `${Math.abs(percent).toFixed(1)}%`
        : undefined;

    return {
        kind: 'change',
        text: legacy ? legacyText : reportingText,
        tone,
        direction: legacy ? numericDirection : arrowDirection,
        numericDirection,
        absolute,
        percent,
        percentHover,
        header,
    };
}
