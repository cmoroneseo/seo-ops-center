'use client';

import { useState, useEffect, useRef } from 'react';
import { Map, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineInput, InlineTextarea, CustomFieldSectionProps, RoadmapStage } from './SectionCard';

const DEFAULT_STAGES: RoadmapStage[] = [
    { title: 'Research & Foundation', monthRange: 'Months 0-3', description: '', expectedOutcomes: '' },
    { title: 'Optimization & Expansion', monthRange: 'Months 3-6', description: '', expectedOutcomes: '' },
    { title: 'Authority & Growth', monthRange: 'Months 6-12', description: '', expectedOutcomes: '' },
];

const STAGE_COLORS = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
    'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-amber-500',
];

export function PreliminaryRoadmapSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const stored = (plan.customFields.preliminaryRoadmap ?? {}) as { stages?: RoadmapStage[] };
    const [stages, setStages] = useState<RoadmapStage[]>(stored.stages ?? []);
    const initialized = useRef(false);

    useEffect(() => {
        const s = (plan.customFields.preliminaryRoadmap ?? {}) as { stages?: RoadmapStage[] };
        setStages(s.stages ?? []);
        initialized.current = false;
    }, [plan.customFields.preliminaryRoadmap]);

    // Auto-populate defaults when section first opens with no stages
    useEffect(() => {
        if (expanded && stages.length === 0 && !initialized.current) {
            initialized.current = true;
            const defaults = [...DEFAULT_STAGES];
            setStages(defaults);
            updateCampaignPlan(plan.id, {
                customFields: { ...plan.customFields, preliminaryRoadmap: { stages: defaults } },
            }).then(() => onRefresh());
        }
    }, [expanded, stages.length, plan.id, plan.customFields, onRefresh]);

    const saveStages = async (updated: RoadmapStage[]) => {
        setStages(updated);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, preliminaryRoadmap: { stages: updated } },
        });
        onRefresh();
    };

    const updateStage = (idx: number, field: keyof RoadmapStage, value: string) => {
        const updated = [...stages];
        updated[idx] = { ...updated[idx], [field]: value };
        setStages(updated);
    };

    const saveOnBlur = async () => {
        await saveStages(stages);
    };

    const addStage = async () => {
        const updated = [...stages, { title: `Stage ${stages.length + 1}`, monthRange: '', description: '', expectedOutcomes: '' }];
        await saveStages(updated);
    };

    const removeStage = async (idx: number) => {
        const updated = stages.filter((_, i) => i !== idx);
        await saveStages(updated);
    };

    return (
        <SectionCard
            icon={Map} title="Preliminary Roadmap" count={stages.length}
            expanded={expanded} onToggle={onToggle}
        >
            <p className="text-xs text-muted-foreground mb-4">
                Client-facing campaign roadmap — high-level stages before detailed execution plan
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stages.map((stage, idx) => (
                    <div key={idx} className="rounded-lg border border-border/50 bg-muted/20 p-4 space-y-3 group relative">
                        <button
                            onClick={() => removeStage(idx)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className={cn(
                                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white',
                                STAGE_COLORS[idx % STAGE_COLORS.length],
                            )}>
                                {idx + 1}
                            </div>
                            <InlineInput
                                value={stage.title}
                                onChange={v => updateStage(idx, 'title', v)}
                                className="flex-1 font-semibold"
                            />
                        </div>
                        <InlineInput
                            value={stage.monthRange}
                            onChange={v => updateStage(idx, 'monthRange', v)}
                            placeholder="e.g. Months 0-3"
                            className="text-xs text-muted-foreground"
                        />
                        <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Description</label>
                            <InlineTextarea
                                value={stage.description ?? ''}
                                onChange={v => updateStage(idx, 'description', v)}
                                onBlur={saveOnBlur}
                                placeholder="What we intend to do and why..."
                                rows={3}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Expected Outcomes</label>
                            <InlineTextarea
                                value={stage.expectedOutcomes ?? ''}
                                onChange={v => updateStage(idx, 'expectedOutcomes', v)}
                                onBlur={saveOnBlur}
                                placeholder="Expected results..."
                                rows={2}
                            />
                        </div>
                    </div>
                ))}
            </div>
            <button
                onClick={addStage}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mt-2"
            >
                <Plus className="h-3.5 w-3.5" /> Add Stage
            </button>
        </SectionCard>
    );
}
