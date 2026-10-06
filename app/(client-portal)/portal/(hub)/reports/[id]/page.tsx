import { redirect } from 'next/navigation';
import { PortalReportContent } from '@/components/portal/PortalPages';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const { id } = await params;
    return <PortalReportContent contact={access.identity.contact} id={id} />;
}
