'use client';

import { useState } from 'react';
import { BarChart3, Check, X, Trash2, Pencil } from 'lucide-react';
import { CampaignKpi } from '@/lib/types';
import { upsertCampaignKpi, deleteCampaignKpi } from '@/lib/supabase/campaign-plans';
import {
    SectionCard, InlineInput, InlineSelect,
    KPI_GROUPS, KPI_SOURCES, CONFIDENCE_OPTIONS, SectionProps,
} from './SectionCard';

function KpiEditForm({ form, setForm, onSave, onCancel }: {
    form: { metricName: string; kpiGroup: string; source: string; baselineValue: string; targetValue: string; confidence: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.metricName} onChange={v => setForm(f => ({ ...f, metricName: v }))} placeholder="Metric name…" className="flex-1" />
                <InlineSelect value={form.kpiGroup} onChange={v => setForm(f => ({ ...f, kpiGroup: v }))} options={KPI_GROUPS} />
                <InlineSelect value={form.source} onChange={v => setForm(f => ({ ...f, source: v }))} options={KPI_SOURCES} />
            </div>
            <div className="flex items-center gap-2">
                <input type="number" value={form.baselineValue} onChange={e => setForm(f => ({ ...f, baselineValue: e.target.value }))} placeholder="Baseline" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
                <input type="number" value={form.targetValue} onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))} placeholder="Target" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-24 outline-none focus:border-primary" />
                <InlineSelect value={form.confidence} onChange={v => setForm(f => ({ ...f, confidence: v }))} options={CONFIDENCE_OPTIONS} />
                <div className="flex-1" />
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

export function KpisSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: SectionProps) {
    const kpis = plan.kpis ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });

    const startEdit = (k: CampaignKpi) => {
        setEditingId(k.id);
        setForm({
            metricName: k.metricName, kpiGroup: k.kpiGroup ?? '', source: k.source ?? '',
            baselineValue: k.baselineValue != null ? String(k.baselineValue) : '',
            targetValue: k.targetValue != null ? String(k.targetValue) : '',
            confidence: k.confidence ?? 'medium',
        });
    };

    const handleSave = async (k: CampaignKpi) => {
        if (!form.metricName.trim()) return;
        await upsertCampaignKpi({
            id: k.id, campaignPlanId: plan.id, organizationId, clientId,
            metricName: form.metricName.trim(),
            kpiGroup: form.kpiGroup || undefined, source: form.source || undefined,
            baselineValue: form.baselineValue ? Number(form.baselineValue) : undefined,
            targetValue: form.targetValue ? Number(form.targetValue) : undefined,
            confidence: form.confidence || undefined, sortOrder: k.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.metricName.trim()) return;
        await upsertCampaignKpi({
            campaignPlanId: plan.id, organizationId, clientId,
            metricName: form.metricName.trim(),
            kpiGroup: form.kpiGroup || undefined, source: form.source || undefined,
            baselineValue: form.baselineValue ? Number(form.baselineValue) : undefined,
            targetValue: form.targetValue ? Number(form.targetValue) : undefined,
            confidence: form.confidence || undefined, sortOrder: kpis.length,
        });
        setForm({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ metricName: '', kpiGroup: '', source: '', baselineValue: '', targetValue: '', confidence: 'medium' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignKpi(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={BarChart3} title="KPIs" count={kpis.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {kpis.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No KPIs defined yet.</p>
            )}
            <div className="space-y-2">
                {kpis.map(k => editingId === k.id ? (
                    <KpiEditForm key={k.id} form={form} setForm={setForm} onSave={() => handleSave(k)} onCancel={() => setEditingId(null)} />
                ) : (
                    <div key={k.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(k)}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm truncate">{k.metricName}</span>
                                    {k.kpiGroup && (
                                        <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full shrink-0">
                                            {KPI_GROUPS.find(g => g.value === k.kpiGroup)?.label}
                                        </span>
                                    )}
                                    {k.source && (
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                            {KPI_SOURCES.find(s => s.value === k.source)?.label}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                                {k.baselineValue != null && <span>Baseline: <strong className="text-foreground">{k.baselineValue}</strong></span>}
                                {k.targetValue != null && <span>Target: <strong className="text-foreground">{k.targetValue}</strong></span>}
                                {k.confidence && (
                                    <span className={CONFIDENCE_OPTIONS.find(c => c.value === k.confidence)?.color}>
                                        {k.confidence}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(k.id); }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1 ml-1"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {adding && (
                <KpiEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}
