import type { MapRecordAction } from '@/lib/types';

// Shared badge styling for a record's action (create/replace/improve/keep).
// Used by RecordRow and ReconciliationSummary — keep in sync, don't duplicate.
export const ACTION_STYLES: Record<MapRecordAction, string> = {
    create: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
    replace: 'border-red-500/30 bg-red-500/10 text-red-500',
    improve: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
    keep: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
};
