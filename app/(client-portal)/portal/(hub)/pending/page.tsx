import { redirect } from 'next/navigation';
import { PortalPendingContent } from '@/components/portal/PortalPages';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    return <PortalPendingContent contact={access.identity.contact} />;
}
