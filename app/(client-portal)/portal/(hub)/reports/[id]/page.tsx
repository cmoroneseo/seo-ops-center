import { notFound, redirect } from 'next/navigation';
import { PortalReportView } from '@/components/portal/PortalReportView';
import { loadPortalPlan, loadPortalReport } from '@/lib/portal/data';
import { checklistPlan } from '@/lib/portal/progress';
import { requirePortalAccess } from '@/lib/portal/session';

export const dynamic = 'force-dynamic';

export default async function PortalReportPage({ params }: { params: Promise<{ id: string }> }) {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const { id } = await params;
    const [report, plan] = await Promise.all([
        loadPortalReport(access.identity.contact, id),
        loadPortalPlan(access.identity.contact),
    ]);
    if (!report) notFound();

    const snapshot = plan.shared && plan.planId
        ? {
            plan: checklistPlan({
                planId: plan.planId,
                title: plan.title,
                steps: plan.steps,
                items: plan.items,
                createdAt: plan.createdAt,
                organizationId: access.identity.contact.organizationId,
                clientId: access.identity.contact.clientId,
            }),
        }
        : null;

    return (
        <PortalReportView
            reportId={report.id}
            title={report.title}
            reportMonth={report.reportMonth}
            executiveSummary={report.executiveSummary}
            recommendations={report.recommendations}
            sections={report.sections}
            clientName={access.identity.contact.clientName}
            logoUrl={access.identity.contact.logoUrl}
            metrics={report.metrics}
            history={report.history}
            planSnapshot={snapshot}
        />
    );
}
