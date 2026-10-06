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
            <div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">Your next move</h1><p className="mt-3 text-sm text-muted-foreground">Approvals and requests that need your input to keep your campaign moving.</p></div>
            <PortalPending items={pending.items} feedback={pending.feedback} planId={plan.planId} />
        </div>
    );
}
