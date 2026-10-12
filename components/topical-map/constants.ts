import type { MapRecordAction, MapRecordStatus, RecordSource, SpecStatus } from '@/lib/types';

// Shared badge styling for a record's action (create/replace/improve/keep).
// Used by RecordRow and ReconciliationSummary — keep in sync, don't duplicate.
export const ACTION_STYLES: Record<MapRecordAction, string> = {
    create: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
    replace: 'border-red-500/30 bg-red-500/10 text-red-500',
    improve: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    keep: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
};

export const PILL_CLASS = 'rounded-full border px-2 py-0.5 text-[10px] font-medium';

export const RECORD_STATUS_STYLES: Record<MapRecordStatus, string> = {
    pending: 'border-border bg-muted text-muted-foreground',
    approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
    declined: 'border-red-500/30 bg-red-500/10 text-red-500',
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
