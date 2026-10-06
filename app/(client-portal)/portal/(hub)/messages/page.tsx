import { redirect } from 'next/navigation';
import { PortalMessagesContent } from '@/components/portal/PortalPages';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function Page() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    return <PortalMessagesContent contact={access.identity.contact} />;
}
