import { notFound } from 'next/navigation';
import { AgencyDashboard } from '@/components/agency-dashboard/AgencyDashboard';
import { agencyDashboardEnabled } from '@/lib/agency-dashboard/flags';
import { resolveSessionOrganization } from '@/lib/reports/session-org';

export const dynamic = 'force-dynamic';

export default async function AgencyDashboardPage() {
    const session = await resolveSessionOrganization();
    if (!session.ok || !agencyDashboardEnabled(process.env, session.organizationId)) notFound();
    return <AgencyDashboard />;
}
