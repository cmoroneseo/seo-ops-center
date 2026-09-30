import Link from 'next/link';
import { redirect } from 'next/navigation';
import { loadPortalReports } from '@/lib/portal/data';
import { requirePortalAccess } from '@/lib/portal/session';
import { monthLabel } from '@/lib/reports/sections';

export const dynamic = 'force-dynamic';

export default async function PortalReportsPage() {
    const access = await requirePortalAccess();
    if (!access.ok) redirect('/portal/login');
    const reports = await loadPortalReports(access.identity.contact);
    return (
        <div>
            <h2 className="text-xl font-semibold">Reports</h2>
            {reports.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No reports have been shared yet.</p>
            ) : (
                <ul className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
                    {reports.map(report => (
                        <li key={report.id} className="flex items-center justify-between gap-3 px-4 py-3">
                            <div>
                                <Link href={`/portal/reports/${report.id}`} className="font-medium hover:underline">{report.title}</Link>
                                <p className="text-xs text-muted-foreground">{monthLabel(report.reportMonth)}</p>
                            </div>
                            <Link href={`/portal/reports/${report.id}`} className="text-sm text-primary hover:underline">View</Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
