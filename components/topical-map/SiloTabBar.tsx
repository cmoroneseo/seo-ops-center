'use client';

import { cn } from '@/lib/utils';
import type { MapRecordAction, MapRecordStatus, PageType, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';

export interface SiloFilters {
    action: MapRecordAction | 'all';
    pageType: PageType | 'all';
    status: MapRecordStatus | 'all';
}

const PAGE_TYPES: PageType[] = [
    'pillar', 'service', 'landing', 'product', 'collection', 'city',
    'blog_post', 'guide', 'faq', 'resource_center', 'knowledge_base',
    'homepage', 'comparison', 'case_study', 'other',
];

interface SiloTabBarProps {
    silos: TopicalMapSilo[];
    records: TopicalMapRecord[];
    activeSiloId: string | 'all';
    onSelectSilo: (siloId: string | 'all') => void;
    filters: SiloFilters;
    onFiltersChange: (filters: SiloFilters) => void;
}

export function SiloTabBar({ silos, records, activeSiloId, onSelectSilo, filters, onFiltersChange }: SiloTabBarProps) {
    const countFor = (siloId: string | 'all') =>
        siloId === 'all' ? records.length : records.filter(r => r.siloId === siloId).length;

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3">
            <div className="flex flex-1 min-w-0 items-center gap-2 overflow-x-auto pb-1">
                <button
                    onClick={() => onSelectSilo('all')}
                    className={cn(
                        'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        activeSiloId === 'all'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:bg-muted',
                    )}
                >
                    All <span className="ml-1 tabular-nums opacity-70">{countFor('all')}</span>
                </button>
                {silos.map(silo => (
                    <button
                        key={silo.id}
                        onClick={() => onSelectSilo(silo.id)}
                        className={cn(
                            'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                            activeSiloId === silo.id
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:bg-muted',
                        )}
                    >
                        {silo.name} <span className="ml-1 tabular-nums opacity-70">{countFor(silo.id)}</span>
                    </button>
                ))}
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <select
                    aria-label="Filter by action"
                    value={filters.action}
                    onChange={e => onFiltersChange({ ...filters, action: e.target.value as SiloFilters['action'] })}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                    <option value="all">All actions</option>
                    <option value="create">Create</option>
                    <option value="replace">Replace</option>
                    <option value="improve">Improve</option>
                    <option value="keep">Keep</option>
                </select>
                <select
                    aria-label="Filter by page type"
                    value={filters.pageType}
                    onChange={e => onFiltersChange({ ...filters, pageType: e.target.value as SiloFilters['pageType'] })}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                    <option value="all">All page types</option>
                    {PAGE_TYPES.map(pt => (
                        <option key={pt} value={pt}>{pt.replaceAll('_', ' ')}</option>
                    ))}
                </select>
                <select
                    aria-label="Filter by status"
                    value={filters.status}
                    onChange={e => onFiltersChange({ ...filters, status: e.target.value as SiloFilters['status'] })}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="declined">Declined</option>
                </select>
            </div>
        </div>
    );
}
