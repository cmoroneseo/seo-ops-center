import { deltaColumnHeader, formatDelta, type FormatDeltaContext } from '@/lib/reporting/delta';

const TONE_CLASS = {
    neutral: 'text-muted-foreground',
    good: 'text-green-600',
    bad: 'text-red-600',
} as const;

export function DeltaHeader({
    label,
    metric = 'count',
}: {
    label: string;
    metric?: 'count' | 'position';
}) {
    return <span>{deltaColumnHeader(label, metric)}</span>;
}

/** Grey ≈ inside the noise band. A distorted window strikes the prior and shows the reason. */
export function DeltaText({
    current,
    previous,
    context,
}: {
    current: unknown;
    previous: unknown;
    context?: FormatDeltaContext;
}) {
    const delta = formatDelta(current, previous, context);
    if (delta.kind === 'distorted') {
        return (
            <span className="inline-flex items-baseline gap-1 text-foreground" data-delta="distorted">
                <s className="text-muted-foreground">{delta.priorLabel}</s>
                <span>{delta.reason}</span>
            </span>
        );
    }
    if (delta.kind === 'missing') return null;

    return (
        <span
            className={`inline-flex items-center text-[11px] font-semibold ${TONE_CLASS[delta.tone]}`}
            data-delta={delta.kind}
            data-lower-is-better={delta.header ? 'true' : undefined}
            title={delta.percentHover}
        >
            {delta.text}
        </span>
    );
}
