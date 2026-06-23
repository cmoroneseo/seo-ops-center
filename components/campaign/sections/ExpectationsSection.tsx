'use client';

import { useState } from 'react';
import { ShieldCheck, Check, X, Trash2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignExpectation } from '@/lib/types';
import { upsertCampaignExpectation, deleteCampaignExpectation } from '@/lib/supabase/campaign-plans';
import {
    SectionCard, InlineInput, InlineSelect,
    EXPECTATION_TYPES, CONFIDENCE_OPTIONS, SectionProps,
} from './SectionCard';

function ExpEditForm({ form, setForm, onSave, onCancel }: {
    form: { statement: string; type: string; targetWindowDays: string; confidence: string; preconditions: string; escalationRule: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <textarea
                value={form.statement}
                onChange={(e) => setForm(f => ({ ...f, statement: e.target.value }))}
                placeholder="Expectation statement…"
                rows={2}
                className="w-full bg-transparent border border-border/50 rounded-md text-sm p-2 outline-none focus:border-primary resize-none"
            />
            <div className="flex items-center gap-2">
                <InlineSelect value={form.type} onChange={v => setForm(f => ({ ...f, type: v }))} options={EXPECTATION_TYPES} />
                <input type="number" value={form.targetWindowDays} onChange={e => setForm(f => ({ ...f, targetWindowDays: e.target.value }))} placeholder="Days" className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 w-20 outline-none focus:border-primary" />
                <InlineSelect value={form.confidence} onChange={v => setForm(f => ({ ...f, confidence: v }))} options={CONFIDENCE_OPTIONS} />
            </div>
            <InlineInput value={form.preconditions} onChange={v => setForm(f => ({ ...f, preconditions: v }))} placeholder="Preconditions (optional)…" />
            <InlineInput value={form.escalationRule} onChange={v => setForm(f => ({ ...f, escalationRule: v }))} placeholder="Escalation rule (optional)…" />
            <div className="flex justify-end gap-2">
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

export function ExpectationsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: SectionProps) {
    const expectations = plan.expectations ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });

    const startEdit = (exp: CampaignExpectation) => {
        setEditingId(exp.id);
        setForm({
            statement: exp.statement, type: exp.type ?? '',
            targetWindowDays: exp.targetWindowDays != null ? String(exp.targetWindowDays) : '',
            confidence: exp.confidence ?? 'medium',
            preconditions: exp.preconditions ?? '', escalationRule: exp.escalationRule ?? '',
        });
    };

    const handleSave = async (exp: CampaignExpectation) => {
        if (!form.statement.trim()) return;
        await upsertCampaignExpectation({
            id: exp.id, campaignPlanId: plan.id, organizationId, clientId,
            statement: form.statement.trim(), type: form.type || undefined,
            targetWindowDays: form.targetWindowDays ? Number(form.targetWindowDays) : undefined,
            confidence: form.confidence || undefined,
            preconditions: form.preconditions.trim() || undefined,
            escalationRule: form.escalationRule.trim() || undefined,
            sortOrder: exp.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.statement.trim()) return;
        await upsertCampaignExpectation({
            campaignPlanId: plan.id, organizationId, clientId,
            statement: form.statement.trim(), type: form.type || undefined,
            targetWindowDays: form.targetWindowDays ? Number(form.targetWindowDays) : undefined,
            confidence: form.confidence || undefined,
            preconditions: form.preconditions.trim() || undefined,
            escalationRule: form.escalationRule.trim() || undefined,
            sortOrder: expectations.length,
        });
        setForm({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ statement: '', type: '', targetWindowDays: '', confidence: 'medium', preconditions: '', escalationRule: '' });
        setAdding(true);
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignExpectation(id);
        onRefresh();
    };

    const windowLabel = (days: number) => {
        if (days <= 60) return `${days}d`;
        if (days <= 365) return `${Math.round(days / 30)}mo`;
        return `${Math.round(days / 365)}yr`;
    };

    return (
        <SectionCard
            icon={ShieldCheck} title="Expectations" count={expectations.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {expectations.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No expectations defined yet.</p>
            )}
            {expectations.map(exp => editingId === exp.id ? (
                <ExpEditForm key={exp.id} form={form} setForm={setForm} onSave={() => handleSave(exp)} onCancel={() => setEditingId(null)} />
            ) : (
                <div key={exp.id} className="p-3 rounded-lg bg-muted/30 border border-border/30 group space-y-1 cursor-pointer hover:border-border/60" onClick={() => startEdit(exp)}>
                    <div className="flex items-start justify-between">
                        <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                                {exp.type && (
                                    <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                        {EXPECTATION_TYPES.find(t => t.value === exp.type)?.label ?? exp.type}
                                    </span>
                                )}
                                {exp.targetWindowDays && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {windowLabel(exp.targetWindowDays)} window
                                    </span>
                                )}
                                {exp.confidence && (
                                    <span className={cn('text-[10px]', CONFIDENCE_OPTIONS.find(c => c.value === exp.confidence)?.color)}>
                                        {exp.confidence} confidence
                                    </span>
                                )}
                            </div>
                            <p className="text-sm">{exp.statement}</p>
                            {exp.preconditions && (
                                <p className="text-xs text-muted-foreground"><span className="font-medium">Preconditions:</span> {exp.preconditions}</p>
                            )}
                            {exp.escalationRule && (
                                <p className="text-xs text-yellow-500"><span className="font-medium">Escalation:</span> {exp.escalationRule}</p>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                            <button
                                onClick={(e) => { e.stopPropagation(); handleDelete(exp.id); }}
                                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            ))}
            {adding && (
                <ExpEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}
