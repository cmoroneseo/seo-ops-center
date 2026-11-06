'use client';

/** Empty Rankings surface. Keyword lists land in a later change. */
export function RankingsTab() {
    return (
        <section aria-label="Rankings" className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <h2 className="text-sm font-medium text-foreground">No tracked keywords yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Keyword tracking for this client lands in a later update.
            </p>
        </section>
    );
}
