'use client';

import { ResultsView } from '@/components/marketing-plan/ResultsView';
import { searchReportingEnabled } from '@/lib/search-reporting/flag';

export function SearchReporting({
    organizationId,
    clientId,
    clientName,
    clientDomain,
    sharePageFreshness = false,
}: {
    organizationId: string;
    clientId: string;
    clientName: string;
    clientDomain: string | null;
    /** Search already shows the window and one as-of. Don't add a second date. */
    sharePageFreshness?: boolean;
}) {
    return (
        <section className="mt-10 border-t border-border pt-8" aria-label="Reporting">
            <h2 className="text-lg font-semibold">Reporting</h2>
            {searchReportingEnabled() ? (
                <div className="mt-4">
                    <ResultsView
                        organizationId={organizationId}
                        clientId={clientId}
                        clientName={clientName}
                        clientDomain={clientDomain}
                        sharePageFreshness={sharePageFreshness}
                    />
                </div>
            ) : (
                <p className="mt-2 text-sm text-muted-foreground">Reporting is not turned on for this workspace.</p>
            )}
        </section>
    );
}
