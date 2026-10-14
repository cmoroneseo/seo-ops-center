import { notFound } from 'next/navigation';
import { AgencyDashboardView } from '@/components/agency-dashboard/AgencyDashboard';
import { exampleDashboard } from '@/lib/agency-dashboard/fixture';

/** Dev-only render of the portfolio with sample history. Production stays 404. */
export default async function AgencyDashboardPreviewPage({
    searchParams,
}: {
    searchParams: Promise<{ view?: string }>;
}) {
    if (process.env.NODE_ENV === 'production') notFound();
    const query = await searchParams;
    return (
        <main className="min-h-screen bg-[#0c0e12] p-4 sm:p-6">
            <AgencyDashboardView model={exampleDashboard()} initialView={query.view === 'list' ? 'list' : 'grid'} />
        </main>
    );
}
