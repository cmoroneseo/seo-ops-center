import Link from 'next/link';
import { labelSubtype, type PortalDeliverable, type PortalPendingItem } from '@/lib/portal/progress';
import type { PortalReportSummary } from '@/lib/portal/data';
import { monthLabel } from '@/lib/reports/sections';

function WorkList({ items, empty }: { items: PortalDeliverable[]; empty: string }) {
    if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
    return (
        <ul className="divide-y divide-border">
            {items.map(item => (
                <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                    <div>
                        <p className="font-medium">{item.title}</p>
                        <p className="text-xs text-muted-foreground">
                            {item.type}{labelSubtype(item.subtype) ? ` · ${labelSubtype(item.subtype)}` : ''}
                            {item.month ? ` · ${monthLabel(item.month)}` : ''}
                        </p>
                    </div>
                    {item.publishedUrl && (
                        <a href={item.publishedUrl} className="shrink-0 text-sm text-primary hover:underline" target="_blank" rel="noreferrer">
                            View
                        </a>
                    )}
                </li>
            ))}
        </ul>
    );
}

export function PortalHome({
    waiting,
    inProgress,
    shipped,
    latestReport,
}: {
    waiting: PortalPendingItem[];
    inProgress: PortalDeliverable[];
    shipped: PortalDeliverable[];
    latestReport: PortalReportSummary | null;
}) {
    return (
        <div className="space-y-8">
            <section>
                <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-xl font-semibold">Waiting on you</h2>
                    <Link href="/portal/pending" className="text-sm text-primary hover:underline">Open inbox</Link>
                </div>
                {waiting.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Nothing is waiting on you right now.</p>
                ) : (
                    <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
                        {waiting.map(item => (
                            <li key={`${item.kind}-${item.id}`} className="px-4 py-3">
                                {item.external ? (
                                    <a href={item.href} className="font-medium hover:underline">{item.title}</a>
                                ) : (
                                    <Link href={item.href} className="font-medium hover:underline">{item.title}</Link>
                                )}
                                {item.detail && <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border border-border bg-card p-5">
                    <h2 className="font-semibold">In progress</h2>
                    <p className="mb-2 text-xs text-muted-foreground">{inProgress.length} with the team</p>
                    <WorkList items={inProgress} empty="No work is in progress this period." />
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                    <h2 className="font-semibold">Recently completed</h2>
                    <p className="mb-2 text-xs text-muted-foreground">Approved or published this month and last</p>
                    <WorkList items={shipped} empty="Nothing has shipped in the last two months." />
                </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
                <h2 className="font-semibold">Latest report</h2>
                {latestReport ? (
                    <p className="mt-2 text-sm">
                        <Link href={`/portal/reports/${latestReport.id}`} className="font-medium text-primary hover:underline">
                            {latestReport.title}
                        </Link>
                        <span className="text-muted-foreground"> · {monthLabel(latestReport.reportMonth)}</span>
                    </p>
                ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Your team has not shared a report yet.</p>
                )}
            </section>
        </div>
    );
}
