'use client';

import { useState, useEffect } from 'react';
import { Globe, Plus, Trash2 } from 'lucide-react';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineTextarea, InlineInput, CustomFieldSectionProps, WebsiteAnalysisData } from './SectionCard';
import { ScreenshotUpload } from './ScreenshotUpload';

export function WebsiteAnalysisSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const saved = (plan.customFields.websiteAnalysis ?? {}) as WebsiteAnalysisData;
    const [data, setData] = useState<WebsiteAnalysisData>({
        observations: saved.observations ?? '',
        technicalFindings: saved.technicalFindings ?? '',
        competitorExamples: saved.competitorExamples ?? [],
        screenshots: saved.screenshots ?? [],
    });

    useEffect(() => {
        const s = (plan.customFields.websiteAnalysis ?? {}) as WebsiteAnalysisData;
        setData({
            observations: s.observations ?? '',
            technicalFindings: s.technicalFindings ?? '',
            competitorExamples: s.competitorExamples ?? [],
            screenshots: s.screenshots ?? [],
        });
    }, [plan.customFields.websiteAnalysis]);

    const save = async (updated: WebsiteAnalysisData) => {
        setData(updated);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, websiteAnalysis: updated },
        });
        onRefresh();
    };

    const addCompetitor = async () => {
        await save({ ...data, competitorExamples: [...(data.competitorExamples ?? []), { name: '', url: '', notes: '' }] });
    };

    const removeCompetitor = async (idx: number) => {
        await save({ ...data, competitorExamples: (data.competitorExamples ?? []).filter((_, i) => i !== idx) });
    };

    const updateCompetitor = (idx: number, field: string, value: string) => {
        const comps = [...(data.competitorExamples ?? [])];
        comps[idx] = { ...comps[idx], [field]: value };
        setData(d => ({ ...d, competitorExamples: comps }));
    };

    const screenshotCount = data.screenshots?.length ?? 0;
    const textCount = [data.observations, data.technicalFindings].filter(v => v?.trim()).length;
    const compCount = data.competitorExamples?.length ?? 0;
    const count = screenshotCount + textCount + compCount;

    return (
        <SectionCard
            icon={Globe} title="Website Analysis" count={count}
            expanded={expanded} onToggle={onToggle}
        >
            <div className="space-y-6">
                {/* Screenshots — full width, prominent */}
                <ScreenshotUpload
                    screenshots={data.screenshots ?? []}
                    onUpdate={async (screenshots) => {
                        await save({ ...data, screenshots });
                    }}
                    label="Website & SEO Screenshots"
                />

                {/* Divider */}
                {screenshotCount > 0 && <div className="border-t border-border/30" />}

                {/* Findings — stacked, not side by side */}
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Observations</label>
                        <InlineTextarea
                            value={data.observations ?? ''}
                            onChange={v => setData(d => ({ ...d, observations: v }))}
                            onBlur={() => save({ ...data })}
                            placeholder="What stands out about this website? Current SEO state, content quality, UX issues, mobile experience..."
                            rows={3}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Technical Findings</label>
                        <InlineTextarea
                            value={data.technicalFindings ?? ''}
                            onChange={v => setData(d => ({ ...d, technicalFindings: v }))}
                            onBlur={() => save({ ...data })}
                            placeholder="Crawl issues, indexing problems, CWV scores, sitemap/robots status, schema markup, page speed..."
                            rows={3}
                        />
                    </div>
                </div>

                {/* Competitors — compact list */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Competitors</label>
                        <button
                            onClick={addCompetitor}
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                    </div>
                    {(data.competitorExamples ?? []).length === 0 && (
                        <p className="text-xs text-muted-foreground italic py-2">No competitors added yet.</p>
                    )}
                    {(data.competitorExamples ?? []).map((comp, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30 group">
                            <InlineInput
                                value={comp.name}
                                onChange={v => updateCompetitor(idx, 'name', v)}
                                placeholder="Name"
                                className="w-32"
                            />
                            <InlineInput
                                value={comp.url}
                                onChange={v => updateCompetitor(idx, 'url', v)}
                                placeholder="domain.com"
                                className="w-40"
                            />
                            <InlineInput
                                value={comp.notes}
                                onChange={v => updateCompetitor(idx, 'notes', v)}
                                placeholder="Notes..."
                                className="flex-1"
                            />
                            <button
                                onClick={() => save({ ...data })}
                                className="text-[10px] text-primary hover:text-primary/80 px-1.5"
                            >
                                Save
                            </button>
                            <button
                                onClick={() => removeCompetitor(idx)}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </SectionCard>
    );
}
