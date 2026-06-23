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
    });

    useEffect(() => {
        const s = (plan.customFields.websiteAnalysis ?? {}) as WebsiteAnalysisData;
        setData({
            observations: s.observations ?? '',
            technicalFindings: s.technicalFindings ?? '',
            competitorExamples: s.competitorExamples ?? [],
        });
    }, [plan.customFields.websiteAnalysis]);

    const save = async (updated: WebsiteAnalysisData) => {
        setData(updated);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, websiteAnalysis: updated },
        });
        onRefresh();
    };

    const saveField = async (field: keyof Pick<WebsiteAnalysisData, 'observations' | 'technicalFindings'>) => {
        await save({ ...data });
    };

    const addCompetitor = async () => {
        const updated = {
            ...data,
            competitorExamples: [...(data.competitorExamples ?? []), { name: '', url: '', notes: '' }],
        };
        await save(updated);
    };

    const removeCompetitor = async (idx: number) => {
        const updated = {
            ...data,
            competitorExamples: (data.competitorExamples ?? []).filter((_, i) => i !== idx),
        };
        await save(updated);
    };

    const updateCompetitor = (idx: number, field: string, value: string) => {
        const comps = [...(data.competitorExamples ?? [])];
        comps[idx] = { ...comps[idx], [field]: value };
        setData(d => ({ ...d, competitorExamples: comps }));
    };

    const saveCompetitors = async () => {
        await save({ ...data });
    };

    const filledFields = [data.observations, data.technicalFindings].filter(v => v && v.trim().length > 0).length;
    const count = filledFields + (data.competitorExamples?.length ?? 0);

    return (
        <SectionCard
            icon={Globe} title="Website Analysis" count={count}
            expanded={expanded} onToggle={onToggle}
        >
            <div className="space-y-6">
                <ScreenshotUpload
                    screenshots={data.screenshots ?? []}
                    onUpdate={async (screenshots) => {
                        await save({ ...data, screenshots });
                    }}
                    label="Website & SEO Screenshots"
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Observations</label>
                        <InlineTextarea
                            value={data.observations ?? ''}
                            onChange={v => setData(d => ({ ...d, observations: v }))}
                            onBlur={() => saveField('observations')}
                            placeholder="General observations about the website..."
                            rows={4}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Technical Findings</label>
                        <InlineTextarea
                            value={data.technicalFindings ?? ''}
                            onChange={v => setData(d => ({ ...d, technicalFindings: v }))}
                            onBlur={() => saveField('technicalFindings')}
                            placeholder="Technical SEO findings..."
                            rows={4}
                        />
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">Competitor Examples</label>
                        <button
                            onClick={addCompetitor}
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                    </div>
                    {(data.competitorExamples ?? []).length === 0 && (
                        <p className="text-sm text-muted-foreground italic">No competitors added yet.</p>
                    )}
                    {(data.competitorExamples ?? []).map((comp, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-muted/30 border border-border/30 space-y-2 group">
                            <div className="flex items-center justify-between">
                                <InlineInput
                                    value={comp.name}
                                    onChange={v => updateCompetitor(idx, 'name', v)}
                                    placeholder="Competitor name…"
                                    className="flex-1"
                                />
                                <button
                                    onClick={() => removeCompetitor(idx)}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 ml-2"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <InlineInput
                                value={comp.url}
                                onChange={v => updateCompetitor(idx, 'url', v)}
                                placeholder="URL…"
                            />
                            <InlineInput
                                value={comp.notes}
                                onChange={v => updateCompetitor(idx, 'notes', v)}
                                placeholder="Notes…"
                            />
                            <div className="flex justify-end">
                                <button
                                    onClick={saveCompetitors}
                                    className="text-[10px] text-primary hover:text-primary/80"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
            </div>
        </SectionCard>
    );
}
