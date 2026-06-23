'use client';

import { useState } from 'react';
import { Target, Check, X, Trash2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignGoal } from '@/lib/types';
import { upsertCampaignGoal, deleteCampaignGoal } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineInput, InlineSelect, GOAL_CATEGORIES, GOAL_STATUSES, SectionProps } from './SectionCard';

export function GoalsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: SectionProps) {
    const goals = plan.goals ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ title: '', category: '', description: '', status: 'active' });

    const startEdit = (g: CampaignGoal) => {
        setEditingId(g.id);
        setForm({ title: g.title, category: g.category ?? '', description: g.description ?? '', status: g.status });
    };

    const handleSave = async (g: CampaignGoal) => {
        if (!form.title.trim()) return;
        await upsertCampaignGoal({
            id: g.id, campaignPlanId: plan.id, organizationId, clientId,
            title: form.title.trim(), category: form.category || undefined,
            description: form.description.trim() || undefined,
            status: form.status || 'active', sortOrder: g.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.title.trim()) return;
        await upsertCampaignGoal({
            campaignPlanId: plan.id, organizationId, clientId,
            title: form.title.trim(), category: form.category || undefined,
            description: form.description.trim() || undefined,
            sortOrder: goals.length,
        });
        setForm({ title: '', category: '', description: '', status: 'active' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ title: '', category: '', description: '', status: 'active' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignGoal(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={Target} title="Goals" count={goals.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {goals.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No goals defined yet.</p>
            )}
            {goals.map(g => editingId === g.id ? (
                <div key={g.id} className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
                    <div className="flex items-center gap-2">
                        <InlineInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Goal title…" className="flex-1" />
                        <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={GOAL_CATEGORIES} />
                        <InlineSelect value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))} options={GOAL_STATUSES} />
                    </div>
                    <InlineInput value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Description (optional)…" />
                    <div className="flex justify-end gap-2">
                        <button onClick={() => handleSave(g)} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                        <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
                    </div>
                </div>
            ) : (
                <div key={g.id} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(g)}>
                    <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{g.title}</span>
                            {g.category && (
                                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                    {GOAL_CATEGORIES.find(c => c.value === g.category)?.label ?? g.category}
                                </span>
                            )}
                            <span className={cn(
                                'text-[10px] px-1.5 py-0.5 rounded-full border',
                                g.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                                g.status === 'achieved' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                g.status === 'at_risk' ? 'bg-red-500/10 text-red-500 border-red-500/20' :
                                'bg-gray-500/10 text-gray-400 border-gray-500/20'
                            )}>
                                {g.status}
                            </span>
                        </div>
                        {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(g.id); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}
            {adding && (
                <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-dashed border-border">
                    <div className="flex items-center gap-2">
                        <InlineInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Goal title…" className="flex-1" />
                        <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={GOAL_CATEGORIES} />
                    </div>
                    <InlineInput value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Description (optional)…" />
                    <div className="flex justify-end gap-2">
                        <button onClick={handleAdd} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                        <button onClick={() => { setAdding(false); }} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}
