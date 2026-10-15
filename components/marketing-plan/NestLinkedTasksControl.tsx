'use client';

import { useState } from 'react';
import { ListTree } from 'lucide-react';
import type { MarketingPlanItem } from '@/lib/types';
import { itemsEligibleForPillarNest, nestCandidateFromPlanItem } from '@/lib/tasks/pillars';
import { getMarketingPlan, nestTasksUnderPillar } from '@/lib/supabase/marketing-plans';
import { NestUnderPillarPanel } from './NestUnderPillarPanel';

export function NestLinkedTasksControl({
    clientId,
    actorName,
    onDone,
}: {
    clientId: string;
    actorName?: string;
    onDone: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [items, setItems] = useState<MarketingPlanItem[]>([]);
    const [planId, setPlanId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const openPanel = async () => {
        setLoading(true);
        setError(null);
        try {
            const plan = await getMarketingPlan(clientId);
            setPlanId(plan?.id ?? null);
            setItems(itemsEligibleForPillarNest(plan?.items ?? []));
            setOpen(true);
        } catch (caught) {
            setPlanId(null);
            setItems([]);
            setError(caught instanceof Error ? caught.message : 'Could not load the SEO Plan');
            setOpen(true);
        } finally {
            setLoading(false);
        }
    };

    const confirm = async (chosen: MarketingPlanItem[], pillar: { title: string }) => {
        if (!planId || creating) return;
        setCreating(true);
        setError(null);
        try {
            const candidates = chosen.flatMap(item => {
                const candidate = nestCandidateFromPlanItem(item);
                return candidate ? [candidate] : [];
            });
            const result = await nestTasksUnderPillar({
                planId,
                candidates,
                title: pillar.title,
                actorName,
            });
            if (!result.success) {
                setError(result.error ?? 'Could not nest these tasks');
                return;
            }
            setOpen(false);
            onDone();
            if (result.warning) alert(result.warning);
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="space-y-3">
            <button
                type="button"
                onClick={() => { void openPanel(); }}
                disabled={loading || creating}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
                <ListTree className="h-4 w-4" />
                {loading ? 'Loading linked tasks…' : 'Nest under pillar'}
            </button>
            {open && (
                <NestUnderPillarPanel
                    scopeLabel="Linked tasks"
                    items={items}
                    creating={creating}
                    error={error}
                    onConfirm={(chosen, pillar) => { void confirm(chosen, pillar); }}
                    onClose={() => { if (!creating) setOpen(false); }}
                />
            )}
        </div>
    );
}
