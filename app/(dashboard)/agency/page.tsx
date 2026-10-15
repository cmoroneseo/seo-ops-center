import { notFound } from 'next/navigation';
import { AgencyDashboard } from '@/components/agency-dashboard/AgencyDashboard';
import { parseCardMetric } from '@/lib/agency-dashboard/ga4';
import { ga4CardsEnabled } from '@/lib/agency-dashboard/ga4-flag';
import { agencyDashboardEnabled } from '@/lib/agency-dashboard/flags';
import { resolveSessionOrganization } from '@/lib/reports/session-org';

export const dynamic = 'force-dynamic';

export default async function AgencyDashboardPage({
    searchParams,
}: {
    searchParams: Promise<{ metric?: string }>;
}) {
    const session = await resolveSessionOrganization();
    if (!session.ok || !agencyDashboardEnabled(process.env, session.organizationId)) notFound();
    const query = await searchParams;
    const ga4Cards = ga4CardsEnabled();
    return (
        <AgencyDashboard
            ga4Cards={ga4Cards}
            initialCardMetric={ga4Cards ? parseCardMetric(query.metric) : 'clicks'}
        />
    );
}
