'use client';

import { useState, useEffect } from 'react';
import { FileText } from 'lucide-react';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineTextarea, CustomFieldSectionProps, SeoOverviewData } from './SectionCard';

export function SeoOverviewSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const saved = (plan.customFields.seoOverview ?? {}) as SeoOverviewData;
    const [data, setData] = useState<SeoOverviewData>(saved);

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

    const filledCount = [
        data.artExplanation, data.currentState, data.opportunities,
        data.challenges, data.campaignObjectives,
    ].filter(v => v && v.trim().length > 0).length;

    return (
        <SectionCard
            icon={FileText} title="SEO Overview" count={filledCount}
            expanded={expanded} onToggle={onToggle}
        >
            <div className="space-y-4">
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
