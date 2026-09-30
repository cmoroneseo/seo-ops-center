import { redirect } from 'next/navigation';
import { PortalHome } from '@/components/portal/PortalHome';
import { loadPortalHome } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function PortalHomePage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const home = await loadPortalHome(access.identity.contact);
    return (
        <PortalHome
            waiting={home.waiting}
            inProgress={home.inProgress}
            shipped={home.shipped}
            latestReport={home.latestReport}
        />
    );
}
