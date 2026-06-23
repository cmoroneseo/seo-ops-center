'use client';

import { useState } from 'react';
import { Clock, Check, X, Trash2, Pencil, ListTodo, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CampaignPhase } from '@/lib/types';
import { upsertCampaignPhase, deleteCampaignPhase } from '@/lib/supabase/campaign-plans';
import { createTask } from '@/lib/supabase/tasks';
import { logActivity } from '@/lib/supabase/client-activity';
import { SectionCard, InlineInput, PHASE_STATUS_COLORS, SectionProps } from './SectionCard';

function PhaseEditForm({ form, setForm, onSave, onCancel }: {
    form: { name: string; objective: string; exitCriteria: string; startDate: string; endDate: string };
    setForm: (fn: (f: typeof form) => typeof form) => void;
    onSave: () => void; onCancel: () => void;
}) {
    return (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <InlineInput value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Phase name…" />
            <InlineInput value={form.objective} onChange={v => setForm(f => ({ ...f, objective: v }))} placeholder="Objective…" />
            <InlineInput value={form.exitCriteria} onChange={v => setForm(f => ({ ...f, exitCriteria: v }))} placeholder="Exit criteria (optional)…" />
            <div className="flex items-center gap-2">
                <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary" />
                <span className="text-xs text-muted-foreground">to</span>
                <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} className="bg-transparent border border-border/50 rounded-md text-xs py-1 px-2 outline-none focus:border-primary" />
                <div className="flex-1" />
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );
}

export function TimelineSection({ plan, organizationId, clientId, expanded, onToggle, onRefresh }: SectionProps) {
    const phases = plan.phases ?? [];
    const [adding, setAdding] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });

    const startEdit = (ph: CampaignPhase) => {
        setEditingId(ph.id);
        setForm({ name: ph.name, objective: ph.objective ?? '', exitCriteria: ph.exitCriteria ?? '', startDate: ph.startDate ?? '', endDate: ph.endDate ?? '' });
    };

    const handleSave = async (ph: CampaignPhase) => {
        if (!form.name.trim()) return;
        await upsertCampaignPhase({
            id: ph.id, campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), phaseOrder: ph.phaseOrder, status: ph.status,
            objective: form.objective.trim() || undefined,
            exitCriteria: form.exitCriteria.trim() || undefined,
            startDate: form.startDate || undefined,
            endDate: form.endDate || undefined,
        });
        setEditingId(null);
        onRefresh();
    };

    const handleAdd = async () => {
        if (!form.name.trim()) return;
        await upsertCampaignPhase({
            campaignPlanId: plan.id, organizationId, clientId,
            name: form.name.trim(), phaseOrder: phases.length,
            objective: form.objective.trim() || undefined,
            exitCriteria: form.exitCriteria.trim() || undefined,
            startDate: form.startDate || undefined,
            endDate: form.endDate || undefined,
        });
        setForm({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });
        setAdding(false);
        onRefresh();
    };

    const startAdd = () => {
        setForm({ name: '', objective: '', exitCriteria: '', startDate: '', endDate: '' });
        setAdding(true);
    };

    const handleStatusChange = async (ph: CampaignPhase, status: string) => {
        await upsertCampaignPhase({
            id: ph.id, campaignPlanId: ph.campaignPlanId,
            organizationId: ph.organizationId, clientId: ph.clientId,
            name: ph.name, phaseOrder: ph.phaseOrder, status,
            objective: ph.objective, exitCriteria: ph.exitCriteria,
        });
        logActivity({ clientId, eventType: 'campaign.phase_status_changed', metadata: { phase: ph.name, newStatus: status } });
        onRefresh();
    };

    const handleDelete = async (id: string) => {
        await deleteCampaignPhase(id);
        onRefresh();
    };

    const [generatingFor, setGeneratingFor] = useState<string | null>(null);

    const handleGenerateTasks = async (ph: CampaignPhase) => {
        setGeneratingFor(ph.id);
        const objective = ph.objective ?? ph.name;
        const taskTitles = objective
            .split(/[,;.\n]/)
            .map(s => s.trim())
            .filter(s => s.length > 5);

        const titles = taskTitles.length > 0
            ? taskTitles
            : [`${ph.name}: Research & planning`, `${ph.name}: Implementation`, `${ph.name}: Review & QA`];

        for (const title of titles) {
            await createTask({
                organizationId, clientId, title,
                category: 'seo',
                priority: 'medium',
                campaignPhaseId: ph.id,
                description: `Generated from campaign phase: ${ph.name}`,
            });
        }

        logActivity({ clientId, eventType: 'campaign.phase_status_changed', metadata: { phase: ph.name, action: 'tasks_generated', count: titles.length } });
        setGeneratingFor(null);
    };

    return (
        <SectionCard
            icon={Clock} title="Timeline" count={phases.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {phases.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No phases defined yet.</p>
            )}
            <div className="space-y-2">
                {phases.map((ph, idx) => (
                    <div key={ph.id} className="flex items-start gap-3 group">
                        <div className="flex flex-col items-center pt-1">
                            <div className={cn(
                                'w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] font-bold',
                                ph.status === 'completed' ? 'border-blue-500 bg-blue-500/20 text-blue-500' :
                                ph.status === 'active' ? 'border-green-500 bg-green-500/20 text-green-500' :
                                'border-border text-muted-foreground',
                            )}>
                                {ph.status === 'completed' ? <Check className="h-3 w-3" /> : idx}
                            </div>
                            {idx < phases.length - 1 && <div className="w-px h-full min-h-[2rem] bg-border/50 mt-1" />}
                        </div>
                        {editingId === ph.id ? (
                            <div className="flex-1">
                                <PhaseEditForm form={form} setForm={setForm} onSave={() => handleSave(ph)} onCancel={() => setEditingId(null)} />
                            </div>
                        ) : (
                            <div className="flex-1 p-3 rounded-lg bg-muted/30 border border-border/30 space-y-1 cursor-pointer hover:border-border/60" onClick={() => startEdit(ph)}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="font-medium text-sm">{ph.name}</span>
                                        <select
                                            value={ph.status}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => { e.stopPropagation(); handleStatusChange(ph, e.target.value); }}
                                            className={cn(
                                                'text-[10px] font-medium rounded-full px-2 py-0.5 border outline-none cursor-pointer appearance-none',
                                                PHASE_STATUS_COLORS[ph.status],
                                            )}
                                        >
                                            <option value="upcoming">Upcoming</option>
                                            <option value="active">Active</option>
                                            <option value="completed">Completed</option>
                                            <option value="skipped">Skipped</option>
                                        </select>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        {ph.startDate && <span>{new Date(ph.startDate + 'T00:00:00').toLocaleDateString()}</span>}
                                        {ph.startDate && ph.endDate && <span>→</span>}
                                        {ph.endDate && <span>{new Date(ph.endDate + 'T00:00:00').toLocaleDateString()}</span>}
                                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDelete(ph.id); }}
                                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </button>
                                    </div>
                                </div>
                                {ph.objective && <p className="text-xs text-muted-foreground">{ph.objective}</p>}
                                {ph.exitCriteria && (
                                    <div className="text-xs text-muted-foreground">
                                        <span className="font-medium">Exit criteria:</span> {ph.exitCriteria}
                                    </div>
                                )}
                                <button
                                    onClick={(e) => { e.stopPropagation(); handleGenerateTasks(ph); }}
                                    disabled={generatingFor === ph.id}
                                    className="flex items-center gap-1.5 text-[10px] text-primary hover:text-primary/80 transition-colors mt-1 disabled:opacity-50"
                                >
                                    {generatingFor === ph.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ListTodo className="h-3 w-3" />}
                                    {generatingFor === ph.id ? 'Generating…' : 'Generate Tasks'}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            {adding && (
                <PhaseEditForm form={form} setForm={setForm} onSave={handleAdd} onCancel={() => { setAdding(false); }} />
            )}
        </SectionCard>
    );
}
