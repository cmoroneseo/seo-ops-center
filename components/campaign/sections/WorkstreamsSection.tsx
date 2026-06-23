'use client';

import { useState } from 'react';
import { Layers, Check, X, Trash2, Pencil, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignWorkstream } from '@/lib/types';
import { upsertCampaignWorkstream, deleteCampaignWorkstream } from '@/lib/supabase/campaign-plans';
import {
    SectionCard, InlineInput, InlineSelect,
    WORKSTREAM_CATEGORIES, WS_STATUS_COLORS, SectionProps,
} from './SectionCard';

function WsEditForm({ form, setForm, onSave, onCancel }: {
    form: { name: string; category: string; currentState: string; targetState: string; risks: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Workstream name…" className="flex-1" />
                <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={WORKSTREAM_CATEGORIES} />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <InlineInput value={form.currentState} onChange={v => setForm(f => ({ ...f, currentState: v }))} placeholder="Current state…" />
                <InlineInput value={form.targetState} onChange={v => setForm(f => ({ ...f, targetState: v }))} placeholder="Target state…" />
            </div>
            <InlineInput value={form.risks} onChange={v => setForm(f => ({ ...f, risks: v }))} placeholder="Risks (optional)…" />
            <div className="flex justify-end gap-2">
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

export function WorkstreamsSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: SectionProps) {
    const workstreams = plan.workstreams ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', category: '', currentState: '', targetState: '', risks: '' });

    const startEdit = (ws: CampaignWorkstream) => {
        setEditingId(ws.id);
        setForm({ name: ws.name, category: ws.category ?? '', currentState: ws.currentState ?? '', targetState: ws.targetState ?? '', risks: ws.risks ?? '' });
    };

    const handleSave = async (ws: CampaignWorkstream) => {
        if (!form.name.trim()) return;
        await upsertCampaignWorkstream({
            id: ws.id, campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), category: form.category || undefined,
            currentState: form.currentState.trim() || undefined,
            targetState: form.targetState.trim() || undefined,
            risks: form.risks.trim() || undefined,
            status: ws.status, sortOrder: ws.sortOrder,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.name.trim()) return;
        await upsertCampaignWorkstream({
            campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), category: form.category || undefined,
            currentState: form.currentState.trim() || undefined,
            targetState: form.targetState.trim() || undefined,
            risks: form.risks.trim() || undefined,
            sortOrder: workstreams.length,
        });
        setForm({ name: '', category: '', currentState: '', targetState: '', risks: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ name: '', category: '', currentState: '', targetState: '', risks: '' });
        setAdding(true);
    };

    const handleStatusChange = async (ws: CampaignWorkstream, status: string) => {
        await upsertCampaignWorkstream({
            id: ws.id, campaignPlanId: ws.campaignPlanId,
            organizationId: ws.organizationId, clientId: ws.clientId,
            name: ws.name, category: ws.category, status,
            sortOrder: ws.sortOrder,
        });
        onRefresh();
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignWorkstream(id);
        onRefresh();
    };

    return (
        <SectionCard
            icon={Layers} title="Workstreams" count={workstreams.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {workstreams.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No workstreams defined yet.</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workstreams.map(ws => editingId === ws.id ? (
                    <WsEditForm key={ws.id} form={form} setForm={setForm} onSave={() => handleSave(ws)} onCancel={() => setEditingId(null)} />
                ) : (
                    <div key={ws.id} className="p-3 rounded-lg bg-muted/30 border border-border/30 group space-y-2 cursor-pointer hover:border-border/60" onClick={() => startEdit(ws)}>
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-medium text-sm">{ws.name}</div>
                                {ws.category && (
                                    <span className="text-[10px] text-muted-foreground">
                                        {WORKSTREAM_CATEGORIES.find(c => c.value === ws.category)?.label}
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-1">
                                <select
                                    value={ws.status}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => { e.stopPropagation(); handleStatusChange(ws, e.target.value); }}
                                    className={cn(
                                        'text-[10px] font-medium rounded-full px-2 py-0.5 border outline-none cursor-pointer appearance-none',
                                        WS_STATUS_COLORS[ws.status],
                                    )}
                                >
                                    <option value="planned">Planned</option>
                                    <option value="active">Active</option>
                                    <option value="paused">Paused</option>
                                    <option value="completed">Completed</option>
                                </select>
                                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleDelete(ws.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                                >
                                    <Trash2 className="h-3 w-3" />
                                </button>
                            </div>
                        </div>
                        {(ws.currentState || ws.targetState) && (
                            <div className="text-xs space-y-1">
                                {ws.currentState && <div><span className="text-muted-foreground">Current:</span> {ws.currentState}</div>}
                                {ws.targetState && <div><span className="text-muted-foreground">Target:</span> {ws.targetState}</div>}
                            </div>
                        )}
                        {ws.risks && (
                            <div className="flex items-start gap-1 text-xs text-yellow-500">
                                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                                {ws.risks}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {adding && (
                <WsEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => setAdding(false)} />
            )}
        </SectionCard>
    );
}
