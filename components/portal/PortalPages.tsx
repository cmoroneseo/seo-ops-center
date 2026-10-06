import { PortalHome } from '@/components/portal/PortalHome';
import { portalToday, portalDate } from '@/lib/portal/dashboard';
import { loadPortalHome, loadPortalPlan, loadPortalPending, loadPortalConversations, loadPortalReports, loadPortalReport } from '@/lib/portal/data';
import { PortalPlan } from '@/components/portal/PortalPlan';
import { PortalPending } from '@/components/portal/PortalPending';
import { PortalConversations } from './PortalConversations';
import { PortalLink as Link } from './PortalViewContext';
import { ArrowRight, FileChartColumn, CalendarDays } from 'lucide-react';
import { monthLabel } from '@/lib/reports/sections';
import { notFound } from 'next/navigation';
import { PortalReportView } from '@/components/portal/PortalReportView';
import type { PortalClientScope } from '@/lib/portal/session';

export async function PortalHomeContent({ contact }: { contact: PortalClientScope }) {
    const home = await loadPortalHome(contact);
    return (
        <PortalHome
            waiting={home.waiting}
            inProgress={home.inProgress}
            shipped={home.shipped}
            latestReport={home.latestReport}
            plan={home.plan}
            performance={home.performance}
            clientName={contact.clientName}
            launchDate={contact.launchDate}
            today={portalToday()}
            update={home.update}
            managerName={home.managerName}
            analyticsShared={home.analyticsShared}
            analyticsSyncedAt={home.analyticsSyncedAt}
        />
    );
}

export async function PortalPlanContent({ contact }: { contact: PortalClientScope }) {
    const plan = await loadPortalPlan(contact);
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
            revisionId={plan.revisionId!}
            version={plan.version!}
            publishedAt={plan.publishedAt!}
            title={plan.title}
            steps={plan.steps}
            items={plan.items}
            createdAt={plan.createdAt}
            organizationId={contact.organizationId}
            clientId={contact.clientId}
            launchDate={contact.launchDate}
            state={plan.state}
            askedAgain={plan.askedAgain}
            decision={plan.decision}
            feedback={plan.feedback}
        />
    );
}

export async function PortalPendingContent({ contact }: { contact: PortalClientScope }) {
    const [pending, plan] = await Promise.all([
        loadPortalPending(contact),
        loadPortalPlan(contact),
    ]);
    return (
        <div className="space-y-4">
            <div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">Your next move</h1><p className="mt-3 text-sm text-muted-foreground">Approvals and requests that need your input to keep your campaign moving.</p></div>
            <PortalPending items={pending.items} feedback={pending.feedback} planId={plan.planId} />
        </div>
    );
}

export async function PortalMessagesContent({ contact }: { contact: PortalClientScope }) {
    const conversations = await loadPortalConversations(contact);
    return <div className="mx-auto max-w-3xl"><div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">A direct line to your team.</h1><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Questions, ideas, or a quick update — keep the conversation moving between reports.</p></div><PortalConversations conversations={conversations} /></div>;

}

export async function PortalReportsContent({ contact }: { contact: PortalClientScope }) {
    const reports = await loadPortalReports(contact);
    const latest = reports[0];
    return <div className="mx-auto max-w-4xl"><div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">The bigger picture.</h1><p className="mt-3 text-sm text-muted-foreground">Your results, the work behind them, and what we’re learning each month.</p></div>{latest ? <><section className="portal-panel"><div className="flex flex-wrap items-start justify-between gap-5"><div><span className="portal-status">Latest report</span><h2 className="mt-3">{latest.title}</h2><p className="portal-panel-description flex items-center gap-2"><CalendarDays size={14} aria-hidden="true" />{monthLabel(latest.reportMonth)} · Shared {portalDate(latest.sharedAt)}</p><p className="mt-4 text-sm text-muted-foreground">Explore your results and month-over-month changes. Save a PDF from the report view.</p></div><Link className="portal-button" href={`/portal/reports/${latest.id}`}>Open report <ArrowRight size={15} aria-hidden="true" /></Link></div></section><section className="portal-panel mt-5"><h2>Report history</h2><ul className="mt-4 divide-y divide-border">{reports.map(report => <li key={report.id}><Link href={`/portal/reports/${report.id}`} className="flex min-h-20 items-center gap-4 py-4 hover:text-primary"><FileChartColumn size={24} className="shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{report.title}</p><p className="mt-1 text-xs text-muted-foreground">{monthLabel(report.reportMonth)}</p></div><ArrowRight size={17} className="shrink-0" aria-hidden="true" /></Link></li>)}</ul></section></> : <section className="portal-panel portal-empty"><FileChartColumn size={32} className="mx-auto mb-3 text-primary" aria-hidden="true" /><h2>Your reports will live here</h2><p className="mt-3">Your team hasn’t shared a report yet. In the meantime, your overview shows the work in motion.</p><Link href="/portal" className="mt-5 inline-block text-sm font-semibold text-primary hover:underline">Back to your progress →</Link></section>}</div>;
}

export async function PortalReportContent({ contact, id }: { contact: PortalClientScope; id: string }) {
    const report = await loadPortalReport(contact, id);
    if (!report) notFound();

    return (
        <PortalReportView
            reportId={report.id}
            title={report.title}
            reportMonth={report.reportMonth}
            executiveSummary={report.executiveSummary}
            recommendations={report.recommendations}
            sections={report.sections}
            clientName={contact.clientName}
            logoUrl={contact.logoUrl}
            metrics={report.metrics}
            history={report.history}
            planSnapshot={report.planSnapshot}
        />
    );
}
