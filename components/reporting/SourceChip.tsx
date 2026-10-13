/** Card-level source line for a surface that shares one source and range. */
export function SourceChip({
    source,
    rangeLabel,
    staleLabel,
}: {
    source: string;
    rangeLabel: string;
    /** Full "as of {date}" label. Stale is never color alone. */
    staleLabel?: string | null;
}) {
    return (
        <p className="reporting-source-chip text-xs text-muted-foreground">
            <span>{source}</span>
            {rangeLabel ? (
                <>
                    <span aria-hidden="true"> · </span>
                    <span>{rangeLabel}</span>
                </>
            ) : null}
            {staleLabel ? (
                <>
                    <span aria-hidden="true"> · </span>
                    <span>{staleLabel}</span>
                </>
            ) : null}
        </p>
    );
}
