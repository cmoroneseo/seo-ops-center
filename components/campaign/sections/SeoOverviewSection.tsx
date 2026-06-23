'use client';

import { useState, useEffect } from 'react';
import { FileText, Sparkles, Loader2 } from 'lucide-react';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineTextarea, CustomFieldSectionProps, SeoOverviewData, SectionStatus } from './SectionCard';

export function SeoOverviewSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const saved = (plan.customFields.seoOverview ?? {}) as SeoOverviewData;
    const [data, setData] = useState<SeoOverviewData>(saved);
    const [drafting, setDrafting] = useState(false);

    useEffect(() => {
        setData((plan.customFields.seoOverview ?? {}) as SeoOverviewData);
    }, [plan.customFields.seoOverview]);

    const save = async (patch: Partial<SeoOverviewData>) => {
        const merged = { ...data, ...patch };
        setData(merged);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, seoOverview: merged },
        });
        onRefresh();
    };

    const handleAIDraft = async () => {
        setDrafting(true);
        try {
            const context = {
                clientName: plan.title,
                goals: plan.goals?.map(g => g.title) ?? [],
                kpis: plan.kpis?.map(k => k.metricName) ?? [],
                workstreams: plan.workstreams?.map(w => w.name) ?? [],
                intake: plan.customFields,
                strategyModel: plan.strategyModel,
            };
            const res = await fetch('/api/campaign/draft-overview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(context),
            });
            if (res.ok) {
                const draft = await res.json() as SeoOverviewData;
                setData(draft);
                await updateCampaignPlan(plan.id, {
                    customFields: { ...plan.customFields, seoOverview: draft },
                });
                onRefresh();
            }
        } finally {
            setDrafting(false);
        }
    };

    const fields = [
        data.artExplanation, data.currentState, data.opportunities,
        data.challenges, data.campaignObjectives,
    ];
    const filledCount = fields.filter(v => v && v.trim().length > 0).length;
    const status: SectionStatus = filledCount === 0 ? 'empty' : filledCount >= 5 ? 'complete' : 'partial';

    return (
        <SectionCard
            icon={FileText} title="SEO Overview" count={filledCount} total={5}
            status={status} stepNumber={1}
            expanded={expanded} onToggle={onToggle}
        >
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Define the strategic narrative for this SEO campaign.</p>
                    <button
                        onClick={handleAIDraft}
                        disabled={drafting}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                    >
                        {drafting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        {drafting ? 'Drafting…' : 'AI Draft'}
                    </button>
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">ART Framework Explanation</label>
                    <InlineTextarea
                        value={data.artExplanation ?? ''}
                        onChange={v => setData(d => ({ ...d, artExplanation: v }))}
                        onBlur={() => save({ artExplanation: data.artExplanation })}
                        placeholder="Explain the Authority, Relevance, Trust framework for this client..."
                        rows={3}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Current State</label>
                    <InlineTextarea
                        value={data.currentState ?? ''}
                        onChange={v => setData(d => ({ ...d, currentState: v }))}
                        onBlur={() => save({ currentState: data.currentState })}
                        placeholder="Current SEO state and baseline..."
                        rows={3}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Opportunities</label>
                    <InlineTextarea
                        value={data.opportunities ?? ''}
                        onChange={v => setData(d => ({ ...d, opportunities: v }))}
                        onBlur={() => save({ opportunities: data.opportunities })}
                        placeholder="Key opportunities identified..."
                        rows={3}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Challenges</label>
                    <InlineTextarea
                        value={data.challenges ?? ''}
                        onChange={v => setData(d => ({ ...d, challenges: v }))}
                        onBlur={() => save({ challenges: data.challenges })}
                        placeholder="Challenges and obstacles..."
                        rows={3}
                    />
                </div>
                <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Campaign Objectives</label>
                    <InlineTextarea
                        value={data.campaignObjectives ?? ''}
                        onChange={v => setData(d => ({ ...d, campaignObjectives: v }))}
                        onBlur={() => save({ campaignObjectives: data.campaignObjectives })}
                        placeholder="What this campaign is designed to accomplish..."
                        rows={3}
                    />
                </div>
            </div>
        </SectionCard>
    );
}
