import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, FileChartColumn, CalendarDays } from 'lucide-react';
import { loadPortalReports } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';
import { monthLabel } from '@/lib/reports/sections';
import { portalDate } from '@/lib/portal/dashboard';

export const dynamic = 'force-dynamic';

export default async function PortalReportsPage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const reports = await loadPortalReports(access.identity.contact);
    const latest = reports[0];
    return <div className="mx-auto max-w-4xl"><div className="mb-6 text-foreground"><h1 className="text-3xl font-bold tracking-tight">The bigger picture.</h1><p className="mt-3 text-sm text-muted-foreground">Your results, the work behind them, and what we’re learning each month.</p></div>{latest ? <><section className="portal-panel"><div className="flex flex-wrap items-start justify-between gap-5"><div><span className="portal-status">Latest report</span><h2 className="mt-3">{latest.title}</h2><p className="portal-panel-description flex items-center gap-2"><CalendarDays size={14} aria-hidden="true" />{monthLabel(latest.reportMonth)} · Shared {portalDate(latest.sharedAt)}</p><p className="mt-4 text-sm text-muted-foreground">Explore your results and month-over-month changes. Save a PDF from the report view.</p></div><Link className="portal-button" href={`/portal/reports/${latest.id}`}>Open report <ArrowRight size={15} aria-hidden="true" /></Link></div></section><section className="portal-panel mt-5"><h2>Report history</h2><ul className="mt-4 divide-y divide-border">{reports.map(report => <li key={report.id}><Link href={`/portal/reports/${report.id}`} className="flex min-h-20 items-center gap-4 py-4 hover:text-primary"><FileChartColumn size={24} className="shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{report.title}</p><p className="mt-1 text-xs text-muted-foreground">{monthLabel(report.reportMonth)}</p></div><ArrowRight size={17} className="shrink-0" aria-hidden="true" /></Link></li>)}</ul></section></> : <section className="portal-panel portal-empty"><FileChartColumn size={32} className="mx-auto mb-3 text-primary" aria-hidden="true" /><h2>Your reports will live here</h2><p className="mt-3">Your team hasn’t shared a report yet. In the meantime, your overview shows the work in motion.</p><Link href="/portal" className="mt-5 inline-block text-sm font-semibold text-primary hover:underline">Back to your progress →</Link></section>}</div>;
}
