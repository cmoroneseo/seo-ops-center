import { redirect } from 'next/navigation';
import { PortalPlan } from '@/components/portal/PortalPlan';
import { loadPortalPlan } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function PortalPlanPage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const plan = await loadPortalPlan(access.identity.contact);
    if (!plan.shared || !plan.planId) {
        return (
            <div className="rounded-xl border border-border bg-card p-6">
                <h2 className="text-xl font-semibold">SEO Plan</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    Your team has not shared the SEO Plan yet. It will show up here when they do.
                </p>
            </div>
        );
    }
    return (
        <PortalPlan
            planId={plan.planId}
            title={plan.title}
            steps={plan.steps}
            items={plan.items}
            createdAt={plan.createdAt}
            organizationId={access.identity.contact.organizationId}
            clientId={access.identity.contact.clientId}
            launchDate={access.identity.contact.launchDate}
            state={plan.state}
            askedAgain={plan.askedAgain}
            decision={plan.decision}
            feedback={plan.feedback}
        />
    );
}
