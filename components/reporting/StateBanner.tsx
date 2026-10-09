import type { FreshnessReadout } from '@/lib/reporting/freshness';

const INFORMATIONAL = new Set<FreshnessReadout['state']>(['not_connected', 'partial', 'missing']);

/** Non-fresh states. A real zero stays a neutral 0. Info copy is paired with ⓘ. */
export function StateBanner({ readout }: { readout: FreshnessReadout }) {
    if (readout.state === 'fresh') return null;

    return (
        <div
            role="status"
            className="flex flex-wrap items-center gap-2 text-sm text-foreground"
            data-state={readout.state}
            data-tone={readout.tone}
        >
            {INFORMATIONAL.has(readout.state) ? (
                <span aria-hidden="true" style={{ color: 'var(--reporting-info)' }}>ⓘ</span>
            ) : null}
            <span className="font-medium text-foreground" data-value={readout.displayValue}>
                {readout.displayValue}
            </span>
            <span>{readout.copy}</span>
            {readout.asOf ? <span>{readout.asOf}</span> : null}
        </div>
    );
}
