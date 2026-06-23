'use client';

import React from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    CampaignPlanStatus, CampaignGoalCategory, KpiGroup, KpiSource,
    KpiConfidence, WorkstreamCategory, WorkstreamStatus, PhaseStatus,
    ExpectationType,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Types for new custom-field sections
// ---------------------------------------------------------------------------

export interface SeoOverviewData {
    artExplanation?: string;
    currentState?: string;
    opportunities?: string;
    challenges?: string;
    campaignObjectives?: string;
}

export interface KeywordEntry {
    keyword: string;
    volume?: number;
    difficulty?: number;
    priority?: 'high' | 'medium' | 'low';
    cluster?: string;
}

export interface WebsiteAnalysisData {
    observations?: string;
    technicalFindings?: string;
    competitorExamples?: { name: string; url: string; notes: string }[];
}

export interface KeyActivityItem {
    title: string;
    description?: string;
    priority?: 'high' | 'medium' | 'low';
    category?: string;
}

export interface RoadmapStage {
    title: string;
    monthRange: string;
    description?: string;
    expectedOutcomes?: string;
}

// ---------------------------------------------------------------------------
// Shared label maps
// ---------------------------------------------------------------------------

export const GOAL_CATEGORIES: { value: CampaignGoalCategory; label: string }[] = [
    { value: 'leads', label: 'Leads' },
    { value: 'sales', label: 'Sales' },
    { value: 'local_visibility', label: 'Local Visibility' },
    { value: 'authority', label: 'Authority' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'content_moat', label: 'Content Moat' },
    { value: 'launch_support', label: 'Launch Support' },
    { value: 'reputation', label: 'Reputation' },
    { value: 'other', label: 'Other' },
];

export const KPI_GROUPS: { value: KpiGroup; label: string }[] = [
    { value: 'visibility', label: 'Visibility' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'conversion', label: 'Conversion' },
    { value: 'authority', label: 'Authority' },
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical' },
];

export const KPI_SOURCES: { value: KpiSource; label: string }[] = [
    { value: 'gsc', label: 'GSC' },
    { value: 'ga4', label: 'GA4' },
    { value: 'gbp', label: 'GBP' },
    { value: 'ahrefs', label: 'Ahrefs' },
    { value: 'manual', label: 'Manual' },
    { value: 'internal', label: 'Internal' },
];

export const WORKSTREAM_CATEGORIES: { value: WorkstreamCategory; label: string }[] = [
    { value: 'research_strategy', label: 'Research & Strategy' },
    { value: 'technical_seo', label: 'Technical SEO' },
    { value: 'on_page', label: 'On-Page' },
    { value: 'content', label: 'Content' },
    { value: 'authority', label: 'Authority / Links' },
    { value: 'local_seo', label: 'Local SEO' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'cro', label: 'CRO' },
];

export const CONFIDENCE_OPTIONS: { value: KpiConfidence; label: string; color: string }[] = [
    { value: 'low', label: 'Low', color: 'text-red-500' },
    { value: 'medium', label: 'Medium', color: 'text-yellow-500' },
    { value: 'high', label: 'High', color: 'text-green-500' },
];

export const EXPECTATION_TYPES: { value: ExpectationType; label: string }[] = [
    { value: 'ranking', label: 'Ranking' },
    { value: 'traffic', label: 'Traffic' },
    { value: 'conversion', label: 'Conversion' },
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical' },
    { value: 'authority', label: 'Authority' },
    { value: 'local', label: 'Local' },
];

export const STATUS_LABELS: Record<CampaignPlanStatus, { label: string; color: string }> = {
    draft: { label: 'Draft', color: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
    internal_review: { label: 'In Review', color: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' },
    approved: { label: 'Approved', color: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
    active: { label: 'Active', color: 'bg-green-500/10 text-green-500 border-green-500/20' },
    archived: { label: 'Archived', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};

export const GOAL_STATUSES: { value: string; label: string }[] = [
    { value: 'active', label: 'Active' },
    { value: 'achieved', label: 'Achieved' },
    { value: 'at_risk', label: 'At Risk' },
    { value: 'dropped', label: 'Dropped' },
];

export const WS_STATUS_COLORS: Record<WorkstreamStatus, string> = {
    planned: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
};

export const PHASE_STATUS_COLORS: Record<PhaseStatus, string> = {
    upcoming: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    active: 'bg-green-500/10 text-green-500 border-green-500/20',
    completed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    skipped: 'bg-gray-500/10 text-gray-300 border-gray-500/20',
};

// ---------------------------------------------------------------------------
// Shared props for all section components
// ---------------------------------------------------------------------------

export interface SectionProps {
    plan: import('@/lib/types').CampaignPlan;
    organizationId: string;
    clientId: string;
    expanded: boolean;
    onToggle: () => void;
    onRefresh: () => void;
}

export interface CustomFieldSectionProps {
    plan: import('@/lib/types').CampaignPlan;
    expanded: boolean;
    onToggle: () => void;
    onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// SectionCard component
// ---------------------------------------------------------------------------

export type SectionStatus = 'empty' | 'partial' | 'complete';

export function SectionCard({ icon: Icon, title, count, total, status, stepNumber, expanded, onToggle, onAdd, children }: {
    icon: React.ElementType; title: string; count: number; total?: number;
    status?: SectionStatus; stepNumber?: number;
    expanded: boolean; onToggle: () => void; onAdd?: () => void;
    children: React.ReactNode;
}) {
    const statusDot = status === 'complete'
        ? 'bg-green-500'
        : status === 'partial'
        ? 'bg-yellow-500'
        : 'bg-gray-400/40';

    return (
        <div className={cn(
            'rounded-xl border bg-card transition-colors',
            expanded ? 'border-border' : 'border-border/50',
        )}>
            <div
                className="flex items-center justify-between px-5 py-3 cursor-pointer select-none"
                onClick={onToggle}
            >
                <div className="flex items-center gap-2">
                    {stepNumber != null && (
                        <span className={cn(
                            'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0',
                            status === 'complete' ? 'bg-green-500/20 text-green-500' :
                            status === 'partial' ? 'bg-yellow-500/20 text-yellow-500' :
                            'bg-muted text-muted-foreground',
                        )}>
                            {status === 'complete' ? '✓' : stepNumber}
                        </span>
                    )}
                    {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{title}</span>
                    {total != null ? (
                        <span className="text-xs text-muted-foreground">{count}/{total}</span>
                    ) : (
                        <span className="text-xs text-muted-foreground">({count})</span>
                    )}
                    {status && <div className={cn('w-2 h-2 rounded-full shrink-0', statusDot)} />}
                </div>
                {onAdd && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onAdd(); }}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add
                    </button>
                )}
            </div>
            {expanded && <div className="px-5 pb-5 space-y-3">{children}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inline editor helpers
// ---------------------------------------------------------------------------

export function InlineInput({ value, onChange, placeholder, className }: {
    value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
    return (
        <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={cn(
                'bg-transparent border-b border-border/50 focus:border-primary outline-none text-sm py-1 transition-colors w-full',
                className,
            )}
        />
    );
}

export function InlineSelect({ value, onChange, options }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary"
        >
            <option value="">—</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

export function InlineTextarea({ value, onChange, onBlur, placeholder, rows = 3, className }: {
    value: string; onChange: (v: string) => void; onBlur?: () => void;
    placeholder?: string; rows?: number; className?: string;
}) {
    return (
        <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            placeholder={placeholder}
            rows={rows}
            className={cn(
                'w-full bg-transparent border border-border/50 rounded-md text-sm p-2 outline-none focus:border-primary resize-none transition-colors',
                className,
            )}
        />
    );
}
