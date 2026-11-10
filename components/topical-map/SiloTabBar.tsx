'use client';

import { cn } from '@/lib/utils';
import { ACTION_LABEL, PAGE_TYPE_LABEL } from './constants';
import { PRODUCTION_STATUS_LABEL, PRODUCTION_STATUSES } from '@/lib/topical-map/production';
import type { MapRecordAction, PageType, ProductionStatus, TopicalMapRecord, TopicalMapSilo } from '@/lib/types';

export interface SiloFilters {
    action: MapRecordAction | 'all';
    pageType: PageType | 'all';
    status: ProductionStatus | 'all';
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
                    <option value="create">{ACTION_LABEL.create}</option>
                    <option value="replace">{ACTION_LABEL.replace}</option>
                    <option value="improve">{ACTION_LABEL.improve}</option>
                    <option value="keep">{ACTION_LABEL.keep}</option>
                </select>
                <select
                    aria-label="Filter by page type"
                    value={filters.pageType}
                    onChange={e => onFiltersChange({ ...filters, pageType: e.target.value as SiloFilters['pageType'] })}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                    <option value="all">All types of page</option>
                    {PAGE_TYPES.map(pt => (
                        <option key={pt} value={pt}>{PAGE_TYPE_LABEL[pt]}</option>
                    ))}
                </select>
                <select
                    aria-label="Filter by status"
                    value={filters.status}
                    onChange={e => onFiltersChange({ ...filters, status: e.target.value as SiloFilters['status'] })}
                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                >
                    <option value="all">All statuses</option>
                    {PRODUCTION_STATUSES.map(status => (
                        <option key={status} value={status}>{PRODUCTION_STATUS_LABEL[status]}</option>
                    ))}
                </select>
            </div>
        </div>
    );
}
