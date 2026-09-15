'use client';

import { ExternalLink, LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MapRecordAction, TopicalMapRecord } from '@/lib/types';

const ACTION_STYLES: Record<MapRecordAction, string> = {
    create: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
    replace: 'border-red-500/30 bg-red-500/10 text-red-500',
    improve: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    keep: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
};

interface ReconciliationSummaryProps {
    records: TopicalMapRecord[];
}

export function ReconciliationSummary({ records }: ReconciliationSummaryProps) {
    const claimed = records.filter(r => r.matchedUrl);

    return (
        <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
                <LinkIcon className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Reconciliation</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
                Existing pages matched against the map, and pages the map has not yet claimed.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Claimed pages ({claimed.length})
                    </h4>
                    <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
                        {claimed.length === 0 && (
                            <p className="text-sm text-muted-foreground">No existing pages matched yet.</p>
                        )}
                        {claimed.map(record => (
                            <div key={record.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-xs">
                                <span className={cn('shrink-0 rounded-full border px-2 py-0.5 font-medium uppercase', ACTION_STYLES[record.action])}>
                                    {record.action}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-medium text-foreground">{record.title}</span>
                                    <span className="block truncate font-mono text-muted-foreground">{record.matchedUrl}</span>
                                </span>
                                <a
                                    href={record.matchedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-muted-foreground hover:text-primary"
                                >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Unclaimed existing pages
                    </h4>
                    <div className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                        Site inventory comparison is not wired into this view yet — visit Site Inventory to review pages
                        that have not been matched to a map record.
                    </div>
                </div>
            </div>
        </section>
    );
}
