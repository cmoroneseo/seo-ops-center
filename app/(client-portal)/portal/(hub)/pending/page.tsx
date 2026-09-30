import { redirect } from 'next/navigation';
import { PortalPending } from '@/components/portal/PortalPending';
import { loadPortalPending, loadPortalPlan } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function PortalPendingPage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const [pending, plan] = await Promise.all([
        loadPortalPending(access.identity.contact),
        loadPortalPlan(access.identity.contact),
    ]);
    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">Pending</h2>
            <PortalPending items={pending.items} feedback={pending.feedback} planId={plan.planId} />
        </div>
    );
}
