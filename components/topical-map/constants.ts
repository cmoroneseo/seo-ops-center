import type { MapRecordAction, MapRecordStatus, PageType, ProductionStatus, RecordSource, SpecStatus } from '@/lib/types';

// Shared badge styling for a record's action (create/replace/improve/keep).
// Used by RecordRow and ReconciliationSummary — keep in sync, don't duplicate.
export const ACTION_STYLES: Record<MapRecordAction, string> = {
    create: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
    replace: 'border-red-500/30 bg-red-500/10 text-red-500',
    improve: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    keep: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
};

export const ACTION_LABEL: Record<MapRecordAction, string> = {
    create: 'New page',
    replace: 'Replace this page',
    improve: 'Improve this page',
    keep: 'Keep this page',
};

export const PAGE_TYPE_LABEL: Record<PageType, string> = {
    pillar: 'Pillar page',
    service: 'Service page',
    landing: 'Landing page',
    product: 'Product page',
    collection: 'Collection',
    city: 'City page',
    blog_post: 'Blog post',
    guide: 'Guide',
    faq: 'FAQ',
    resource_center: 'Resource center',
    knowledge_base: 'Knowledge base',
    homepage: 'Homepage',
    comparison: 'Comparison',
    case_study: 'Case study',
    other: 'Other',
};

export const PILL_CLASS = 'rounded-full border px-2 py-0.5 text-[10px] font-medium';

export const AI_ESTIMATE_CLASS = 'border-amber-500/30 bg-amber-500/10 text-amber-600';

export const RECORD_STATUS_STYLES: Record<MapRecordStatus, string> = {
    pending: 'border-border bg-muted text-muted-foreground',
    approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
    declined: 'border-red-500/30 bg-red-500/10 text-red-500',
};

export const PRODUCTION_STATUS_STYLES: Record<ProductionStatus, string> = {
    not_written: 'border-border bg-muted text-muted-foreground',
    awaiting_approval: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    approved: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
    writing: 'border-sky-500/30 bg-sky-500/10 text-sky-700',
    client_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
    ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    published: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    already_live: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700',
    declined: 'border-border bg-muted text-muted-foreground',
    failed: 'border-red-500/30 bg-red-500/10 text-red-600',
};

export const SPEC_STATUS_STYLES: Record<SpecStatus, string> = {
    draft: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
};

export const SOURCE_STYLES: Record<RecordSource, string> = {
    manual: 'border-border bg-muted text-foreground',
    generated: 'border-border bg-muted text-muted-foreground',
    crawl: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
    gsc: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
};
