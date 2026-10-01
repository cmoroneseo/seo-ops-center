'use client';

import { useState } from 'react';
import type { MarketingPlanItem } from '@/lib/types';
import { isInRoadmap, ROADMAP_PHASES, type RoadmapPhase } from '@/lib/marketing-plan-roadmap';

export function RoadmapItemDetails({ item, onSave }: {
    item: MarketingPlanItem;
    onSave: (patch: { roadmapIncluded?: boolean; roadmapPhase?: RoadmapPhase; status?: string }) => Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const included = isInRoadmap(item);
    const save = async (patch: Parameters<typeof onSave>[0]) => {
        setBusy(true); setError('');
        try { await onSave(patch); } catch (e) { setError(e instanceof Error ? e.message : 'Could not save roadmap scope'); }
        finally { setBusy(false); }
    };
    return <fieldset disabled={busy} className="space-y-3 print:hidden">
        <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input aria-label={`Include ${item.title} in roadmap`} type="checkbox" checked={included} onChange={e => void save({ roadmapIncluded: e.target.checked, ...(e.target.checked && item.status === 'ignored' ? { status: 'todo' } : {}) })} className="mt-1 h-4 w-4 accent-primary" />
            <span><span className="font-medium">Include in roadmap</span><span className="mt-1 block text-xs text-muted-foreground">Scope selection is separate from task completion.</span></span>
        </label>
        <label className="block text-xs text-muted-foreground">Roadmap phase
            <select aria-label={`Roadmap phase for ${item.title}`} disabled={!included || busy} value={item.roadmapPhase ?? 'backlog'} onChange={e => void save({ roadmapPhase: e.target.value as RoadmapPhase })} className="mt-1 block min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground disabled:opacity-50">
                {ROADMAP_PHASES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
        </label>
        <p className="text-xs text-muted-foreground">Months are relative to launch. Task due dates remain separate.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </fieldset>;
}
