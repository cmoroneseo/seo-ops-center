import { notFound } from 'next/navigation';
import { AgencyDashboardView } from '@/components/agency-dashboard/AgencyDashboard';
import { exampleDashboard } from '@/lib/agency-dashboard/fixture';
import { attachGa4Dashboard, parseCardMetric, type Ga4Aggregate } from '@/lib/agency-dashboard/ga4';
import { ga4CardsEnabled } from '@/lib/agency-dashboard/ga4-flag';

/** Dev-only render of the portfolio with sample history. Production stays 404. */
export default async function AgencyDashboardPreviewPage({
    searchParams,
}: {
    searchParams: Promise<{ view?: string; card?: string; filters?: string; metric?: string }>;
}) {
    if (process.env.NODE_ENV === 'production') notFound();
    const query = await searchParams;
    const ga4Cards = ga4CardsEnabled();
    const model = ga4Cards ? attachGa4Dashboard(exampleDashboard(), previewGa4()) : exampleDashboard();
    return (
        <main className="min-h-screen bg-[#0c0e12] p-4 sm:p-6">
            <AgencyDashboardView
                model={model}
                initialView={query.view === 'list' ? 'list' : 'grid'}
                initialOpenClient={query.card ?? null}
                initialFiltersOpen={query.filters === '1'}
                ga4Cards={ga4Cards}
                initialCardMetric={ga4Cards ? parseCardMetric(query.metric) : 'clicks'}
            />
        </main>
    );
}

/** Illustrative GA4 rows for the dev preview. Not live client data. */
function previewGa4() {
    const spine = exampleDashboard().buckets;
    const wave = (seed: number, organic: number, sessions: number, rate: number, events: number) => {
        const series = spine.map((bucket, index) => {
            const swing = 1 + Math.sin((index + seed) / 4) * 0.18;
            return {
                bucket,
                organicSessions: Math.round((organic / spine.length) * swing),
                keyEvents: Math.round((events / spine.length) * swing),
            };
        });
        const current = {
            organicSessions: organic,
            sessions,
            engagedSessions: Math.round(sessions * rate),
            keyEvents: events,
            days: spine.length,
        };
        const previous = {
            organicSessions: Math.round(organic / 1.184),
            sessions: Math.round(sessions / 1.12),
            engagedSessions: Math.round((sessions / 1.12) * rate),
            keyEvents: Math.round(events / 1.08),
            days: spine.length,
        };
        return { current, previous, series };
    };
    const clients = [
        ['north', wave(1, 12480, 20400, 0.612, 342)],
        ['harbor', wave(2, 8215, 15000, 0.548, 198)],
        ['bright', wave(3, 5903, 10640, 0.553, 121)],
        ['summit', wave(4, 15760, 23900, 0.66, 407)],
    ] as const;
    const aggregate: Ga4Aggregate = {
        clients: clients.map(([clientId, row]) => ({ clientId, ...row })),
    };
    return {
        links: clients.map(([clientId]) => ({ clientId, property: 'properties/1' })),
        aggregate,
        expectedPreviousDays: spine.length,
    };
}
