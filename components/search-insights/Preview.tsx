'use client';

import { exampleReportingInput } from '@/lib/search-insights/fixture';
import { buildSearchReporting } from '@/lib/search-reporting/assemble';
import { SearchInsightsV2 } from './SearchInsightsV2';

/** 28 final days, so the example line spans the plot. Tests keep the October month. */
const fixture = buildSearchReporting({ ...exampleReportingInput(), range: '28d' });

/** Local fixture screen. The route 404s unless the reporting flag is on in development. */
export function SearchInsightsPreview() {
    return (
        <main className="mx-auto min-h-screen max-w-[1440px] bg-background px-4 py-6 text-foreground sm:px-6">
            <SearchInsightsV2
                clientId="example"
                clientName="Scott Cole Plumbing"
                onConnections={() => undefined}
                fixture={fixture}
                example
            />
        </main>
    );
}
