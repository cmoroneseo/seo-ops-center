'use client';

import { DeliverableStatus, DeliverableType } from '@/lib/types';
import { Severity } from '@/lib/seo-ops-logic';
import { FileText, Link as LinkIcon, MapPin, Circle } from 'lucide-react';

export const DELIVERABLE_STATUSES: DeliverableStatus[] = [
    'Pending', 'In Progress', 'Review', 'Approved', 'Published',
];

export const SUBTYPE_OPTIONS: { value: string; label: string; type: DeliverableType }[] = [
    { value: 'blog', label: 'Blog Post', type: 'Content' },
    { value: 'service_page', label: 'Service Page', type: 'Content' },
    { value: 'city_page', label: 'City Page', type: 'Content' },
    { value: 'landing_page', label: 'Landing Page', type: 'Content' },
    { value: 'link_building', label: 'Link Building', type: 'Backlink' },
    { value: 'gbp_management', label: 'GBP Management', type: 'GBP' },
    { value: 'technical_seo', label: 'Technical SEO', type: 'Other' },
];

export function subtypeLabel(subtype?: string): string | undefined {
    if (!subtype) return undefined;
    return SUBTYPE_OPTIONS.find((s) => s.value === subtype)?.label
        ?? subtype.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Same color ladder as the original DeliverablesTracker. */
export function statusBadgeClass(status: string): string {
    switch (status) {
        case 'Approved': return 'text-green-500 bg-green-500/10 border-green-500/20';
        case 'Published': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
        case 'In Progress': return 'text-orange-500 bg-orange-500/10 border-orange-500/20';
        case 'Review': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
        default: return 'text-muted-foreground bg-muted border-border';
    }
}

/** Severity → badge classes, matching MonthlyPlannerCard's pace badges. */
export function severityBadgeClass(severity: Severity): string {
    switch (severity) {
        case 'critical': return 'text-red-500 bg-red-500/10 border-red-500/20';
        case 'warn': return 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20';
        case 'info': return 'text-blue-500 bg-blue-500/10 border-blue-500/20';
        default: return 'text-green-500 bg-green-500/10 border-green-500/20';
    }
}

export function typeIcon(type: DeliverableType) {
    switch (type) {
        case 'Content': return <FileText className="h-4 w-4" />;
        case 'Backlink': return <LinkIcon className="h-4 w-4" />;
        case 'GBP': return <MapPin className="h-4 w-4" />;
        default: return <Circle className="h-4 w-4" />;
    }
}

export function typeIconClass(type: DeliverableType): string {
    switch (type) {
        case 'Content': return 'bg-blue-500/10 text-blue-500';
        case 'Backlink': return 'bg-purple-500/10 text-purple-500';
        case 'GBP': return 'bg-green-500/10 text-green-500';
        default: return 'bg-muted text-muted-foreground';
    }
}

/** 'YYYY-MM' for an offset of months from the current month. */
export function monthKey(offset = 0, from: Date = new Date()): string {
    const d = new Date(from.getFullYear(), from.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthDisplay(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
}
