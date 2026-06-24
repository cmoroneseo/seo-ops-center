'use client';

import { useState, useEffect } from 'react';
import { Globe, Plus, Trash2, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import {
    SectionCard, InlineInput, InlineTextarea, CustomFieldSectionProps,
    WebsiteAnalysisData, AnalysisFinding,
} from './SectionCard';
import { ScreenshotUpload } from './ScreenshotUpload';

function generateId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function migrateToFindings(data: WebsiteAnalysisData): AnalysisFinding[] {
    if (data.findings?.length) return data.findings;
    const findings: AnalysisFinding[] = [];
    if (data.observations?.trim()) {
        findings.push({
            id: generateId(),
            title: 'Website Overview',
            description: data.observations,
            screenshot: data.screenshots?.[0],
        });
    }
    if (data.technicalFindings?.trim()) {
        findings.push({
            id: generateId(),
            title: 'Technical Findings',
            description: data.technicalFindings,
            screenshot: data.screenshots?.[1],
        });
    }
    // Remaining screenshots as their own findings
    if (data.screenshots && data.screenshots.length > 2) {
        for (let i = 2; i < data.screenshots.length; i++) {
            findings.push({
                id: generateId(),
                title: data.screenshots[i].caption || `Screenshot ${i + 1}`,
                description: '',
                screenshot: data.screenshots[i],
            });
        }
    }
    return findings;
}

export function WebsiteAnalysisSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const saved = (plan.customFields.websiteAnalysis ?? {}) as WebsiteAnalysisData;
    const [findings, setFindings] = useState<AnalysisFinding[]>(() => migrateToFindings(saved));
    const [competitors, setCompetitors] = useState(saved.competitorExamples ?? []);

    useEffect(() => {
        const s = (plan.customFields.websiteAnalysis ?? {}) as WebsiteAnalysisData;
        setFindings(migrateToFindings(s));
        setCompetitors(s.competitorExamples ?? []);
    }, [plan.customFields.websiteAnalysis]);

    const save = async (updatedFindings: AnalysisFinding[], updatedCompetitors: typeof competitors) => {
        const data: WebsiteAnalysisData = {
            findings: updatedFindings,
            competitorExamples: updatedCompetitors,
        };
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, websiteAnalysis: data },
        });
        onRefresh();
    };

    const addFinding = () => {
        const updated = [...findings, { id: generateId(), title: '', description: '' }];
        setFindings(updated);
        save(updated, competitors);
    };

    const updateFinding = (id: string, patch: Partial<AnalysisFinding>) => {
        setFindings(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    };

    const saveFinding = (id: string) => {
        save(findings, competitors);
    };

    const deleteFinding = (id: string) => {
        const updated = findings.filter(f => f.id !== id);
        setFindings(updated);
        save(updated, competitors);
    };

    const updateFindingScreenshot = (id: string, screenshots: { url: string; caption: string; addedAt: string }[]) => {
        const updated = findings.map(f => f.id === id ? { ...f, screenshot: screenshots[0] ?? undefined } : f);
        setFindings(updated);
        save(updated, competitors);
    };

    const addCompetitor = () => {
        const updated = [...competitors, { name: '', url: '', notes: '' }];
        setCompetitors(updated);
        save(findings, updated);
    };

    const removeCompetitor = (idx: number) => {
        const updated = competitors.filter((_, i) => i !== idx);
        setCompetitors(updated);
        save(findings, updated);
    };

    const updateCompetitor = (idx: number, field: string, value: string) => {
        const updated = [...competitors];
        updated[idx] = { ...updated[idx], [field]: value };
        setCompetitors(updated);
    };

    return (
        <SectionCard
            icon={Globe} title="Website Analysis" count={findings.length}
            expanded={expanded} onToggle={onToggle} onAdd={addFinding}
        >
            <div className="space-y-6">
                {findings.length === 0 && (
                    <div className="text-center py-8">
                        <Globe className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No findings yet. Click + Add to document your first finding.</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Each finding can have a title, description, and optional screenshot.</p>
                    </div>
                )}

                {findings.map((finding, idx) => (
                    <div key={finding.id} className="group relative">
                        {/* Finding card */}
                        <div className="rounded-lg border border-border/30 bg-card overflow-hidden">
                            {/* Finding header */}
                            <div className="flex items-start gap-2 px-4 pt-4 pb-2">
                                <span className="text-xs text-muted-foreground/40 font-mono pt-1 shrink-0">{idx + 1}.</span>
                                <input
                                    type="text"
                                    value={finding.title}
                                    onChange={e => updateFinding(finding.id, { title: e.target.value })}
                                    onBlur={() => saveFinding(finding.id)}
                                    placeholder="Finding title (e.g., Website Performance, Page Speed Insights)…"
                                    className="flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-muted-foreground/40 border-none"
                                />
                                <button
                                    onClick={() => deleteFinding(finding.id)}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 shrink-0"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>

                            {/* Finding description */}
                            <div className="px-4 pb-3">
                                <textarea
                                    value={finding.description}
                                    onChange={e => updateFinding(finding.id, { description: e.target.value })}
                                    onBlur={() => saveFinding(finding.id)}
                                    placeholder="Describe this finding — what you observed, why it matters, what it means for the client…"
                                    rows={2}
                                    className="w-full bg-transparent text-sm text-muted-foreground outline-none resize-none placeholder:text-muted-foreground/30 border-none"
                                />
                            </div>

                            {/* Screenshot area */}
                            <div className="px-4 pb-4">
                                <ScreenshotUpload
                                    screenshots={finding.screenshot ? [finding.screenshot] : []}
                                    onUpdate={(shots) => updateFindingScreenshot(finding.id, shots)}
                                    label=""
                                    single
                                />
                            </div>
                        </div>

                        {/* Separator between findings */}
                        {idx < findings.length - 1 && (
                            <div className="flex items-center gap-3 py-2 px-4">
                                <div className="flex-1 border-t border-border/20" />
                            </div>
                        )}
                    </div>
                ))}

                {findings.length > 0 && (
                    <button
                        onClick={addFinding}
                        className="w-full py-3 text-xs text-muted-foreground hover:text-primary border border-dashed border-border/40 rounded-lg hover:border-primary/30 transition-colors"
                    >
                        + Add Finding
                    </button>
                )}

                {/* Competitors — compact section at bottom */}
                <div className="border-t border-border/20 pt-4 space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Competitors</label>
                        <button
                            onClick={addCompetitor}
                            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                    </div>
                    {competitors.length === 0 && (
                        <p className="text-xs text-muted-foreground italic py-1">No competitors added yet.</p>
                    )}
                    {competitors.map((comp, idx) => (
                        <div key={idx} className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 border border-border/30 group/comp">
                            <InlineInput value={comp.name} onChange={v => updateCompetitor(idx, 'name', v)} placeholder="Name" className="w-32" />
                            <InlineInput value={comp.url} onChange={v => updateCompetitor(idx, 'url', v)} placeholder="domain.com" className="w-40" />
                            <InlineInput value={comp.notes} onChange={v => updateCompetitor(idx, 'notes', v)} placeholder="Notes..." className="flex-1" />
                            <button onClick={() => save(findings, competitors)} className="text-[10px] text-primary hover:text-primary/80 px-1.5">Save</button>
                            <button
                                onClick={() => removeCompetitor(idx)}
                                className="opacity-0 group-hover/comp:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
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
