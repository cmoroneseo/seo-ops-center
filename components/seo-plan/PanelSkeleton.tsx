/** Placeholder blocks for a panel whose data is still in flight. */
export function PanelSkeleton({ label }: { label: string }) {
    return (
        <div role="status" aria-label={label} className="space-y-3">
            <span className="sr-only">{label}</span>
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-40 animate-pulse rounded-xl bg-muted" />
                <div className="h-40 animate-pulse rounded-xl bg-muted" />
            </div>
        </div>
    );
}
