'use client';

import { Map, Pencil, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TopicalMap, TopicalMapRecord, TopicalMapStatus } from '@/lib/types';
import { computeMapStats } from '@/lib/topical-map/stats';

const number = new Intl.NumberFormat('en-US');

const STATUS_STYLES: Record<TopicalMapStatus, string> = {
    draft: 'border-border bg-muted/50 text-muted-foreground',
    review: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    active: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
    archived: 'border-border bg-muted/50 text-muted-foreground',
};

interface TopicalMapHeaderProps {
    map: TopicalMap;
    records: TopicalMapRecord[];
    onEditProfile: () => void;
    onRegenerate: () => void;
}

export function TopicalMapHeader({ map, records, onEditProfile, onRegenerate }: TopicalMapHeaderProps) {
    const stats = computeMapStats(records);

    const cells: Array<{ label: string; value: string }> = [
        { label: 'Total Records', value: number.format(stats.totalRecords) },
        { label: 'Existing', value: number.format(stats.existingCount) },
        { label: 'New', value: number.format(stats.totalRecords - stats.existingCount) },
        { label: 'Total Demand', value: number.format(stats.totalDemand) },
        { label: 'Approved', value: number.format(stats.approvedCount) },
        { label: 'Links', value: number.format(stats.plannedLinks) },
    ];

    return (
        <header className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-primary">
                        <Map className="h-5 w-5 shrink-0" />
                        <h2 className="truncate text-lg font-semibold text-foreground">{map.title}</h2>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_STYLES[map.status])}>
                            {map.status}
                        </span>
                    </div>
                    {map.architectureSummary && (
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{map.architectureSummary}</p>
                    )}
                </div>
                <div className="flex shrink-0 gap-2">
                    <button
                        onClick={onEditProfile}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                    >
                        <Pencil className="h-3.5 w-3.5" /> Edit Profile
                    </button>
                    <button
                        onClick={onRegenerate}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                    >
                        <RefreshCw className="h-3.5 w-3.5" /> Regenerate
                    </button>
                </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {cells.map(cell => (
                    <div key={cell.label} className="rounded-lg bg-muted/40 p-3">
                        <dt className="text-[11px] text-muted-foreground">{cell.label}</dt>
                        <dd className="mt-1 text-lg font-semibold tabular-nums">{cell.value}</dd>
                    </div>
                ))}
            </dl>
        </header>
    );
}
