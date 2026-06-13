'use client';

import { useEffect, useState } from 'react';
import { X, FileSignature, Plus, Pencil, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    DeliverableCommitment, DeliverableType, OrganizationMember, User,
} from '@/lib/types';
import {
    createCommitment, updateCommitment, endCommitment,
} from '@/lib/supabase/commitments';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { SUBTYPE_OPTIONS, typeIcon, typeIconClass } from './deliverable-ui';

interface CommitmentsManagerProps {
    isOpen: boolean;
    onClose: () => void;
    organizationId: string;
    clientId: string;
    clientName: string;
    commitments: DeliverableCommitment[];
    onChanged: () => void; // parent refetches
}

const EMPTY_FORM = {
    title: '',
    type: 'Content' as DeliverableType,
    subtype: 'blog',
    quantityPerMonth: '1',
    engagementModel: 'Retainer' as 'Retainer' | 'Campaign',
    totalQuantity: '',
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: '',
    dueDay: '',
    defaultAssigneeId: '',
};

export function CommitmentsManager({
    isOpen, onClose, organizationId, clientId, clientName, commitments, onChanged,
}: CommitmentsManagerProps) {
    const [editing, setEditing] = useState<DeliverableCommitment | 'new' | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [members, setMembers] = useState<(OrganizationMember & { user: User })[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setEditing(null);
        getOrganizationMembers(organizationId).then(setMembers);
    }, [isOpen, organizationId]);

    useEffect(() => {
        if (editing === 'new') {
            setForm(EMPTY_FORM);
        } else if (editing) {
            setForm({
                title: editing.title,
                type: editing.type,
                subtype: editing.subtype ?? '',
                quantityPerMonth: String(editing.quantityPerMonth),
                engagementModel: editing.engagementModel,
                totalQuantity: editing.totalQuantity ? String(editing.totalQuantity) : '',
                startsOn: editing.startsOn,
                endsOn: editing.endsOn ?? '',
                dueDay: editing.dueDay ? String(editing.dueDay) : '',
                defaultAssigneeId: editing.defaultAssigneeId ?? '',
            });
        }
    }, [editing]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.title.trim()) return;
        setIsSubmitting(true);
        const payload = {
            title: form.title.trim(),
            type: form.type,
            subtype: form.subtype || undefined,
            quantityPerMonth: Number(form.quantityPerMonth) || 1,
            cadence: 'monthly' as const,
            engagementModel: form.engagementModel,
            totalQuantity: form.engagementModel === 'Campaign' && form.totalQuantity ? Number(form.totalQuantity) : undefined,
            startsOn: form.startsOn,
            endsOn: form.endsOn || undefined,
            dueDay: form.dueDay ? Number(form.dueDay) : undefined,
            defaultAssigneeId: form.defaultAssigneeId || undefined,
        };
        const res = editing === 'new'
            ? await createCommitment({ ...payload, organizationId, clientId, isActive: true, countsTowardHours: true, generateTasks: false })
            : await updateCommitment((editing as DeliverableCommitment).id, payload);
        setIsSubmitting(false);
        if (res.success) {
            setEditing(null);
            onChanged();
        }
    };

    const handleEnd = async (c: DeliverableCommitment) => {
        if (!confirm(`End "${c.title}"? Future months will no longer generate deliverables.`)) return;
        const res = await endCommitment(c.id);
        if (res.success) onChanged();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-lg max-h-[85vh] bg-card border border-border rounded-xl shadow-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
                    <h3 className="font-semibold flex items-center gap-2">
                        <FileSignature className="h-4 w-4 text-primary" />
                        Client Scope — {clientName}
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {editing ? (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Title</label>
                                <input
                                    autoFocus
                                    value={form.title}
                                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                                    placeholder="e.g. Blog Posts"
                                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Type</label>
                                    <select
                                        value={form.type}
                                        onChange={(e) => setForm({ ...form, type: e.target.value as DeliverableType, subtype: '' })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        {(['Content', 'Backlink', 'GBP', 'Other'] as const).map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Subtype</label>
                                    <select
                                        value={form.subtype}
                                        onChange={(e) => setForm({ ...form, subtype: e.target.value })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        <option value="">—</option>
                                        {SUBTYPE_OPTIONS.filter((s) => s.type === form.type).map((s) => (
                                            <option key={s.value} value={s.value}>{s.label}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Per month</label>
                                    <input
                                        type="number" min="0.5" step="0.5"
                                        value={form.quantityPerMonth}
                                        onChange={(e) => setForm({ ...form, quantityPerMonth: e.target.value })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Model</label>
                                    <select
                                        value={form.engagementModel}
                                        onChange={(e) => setForm({ ...form, engagementModel: e.target.value as 'Retainer' | 'Campaign' })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        <option value="Retainer">Retainer</option>
                                        <option value="Campaign">Campaign</option>
                                    </select>
                                </div>
                            </div>
                            {form.engagementModel === 'Campaign' && (
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Campaign total (cap)</label>
                                    <input
                                        type="number" min="1"
                                        value={form.totalQuantity}
                                        onChange={(e) => setForm({ ...form, totalQuantity: e.target.value })}
                                        className="mt-1 w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Starts</label>
                                    <input
                                        type="date"
                                        value={form.startsOn}
                                        onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Ends (optional)</label>
                                    <input
                                        type="date"
                                        value={form.endsOn}
                                        onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-xs font-medium text-muted-foreground">Due day (1–28)</label>
                                    <input
                                        type="number" min="1" max="28"
                                        value={form.dueDay}
                                        onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                                        placeholder="EOM"
                                        className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-muted-foreground">Default assignee</label>
                                <select
                                    value={form.defaultAssigneeId}
                                    onChange={(e) => setForm({ ...form, defaultAssigneeId: e.target.value })}
                                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                                >
                                    <option value="">Unassigned</option>
                                    {members.map((m) => (
                                        <option key={m.userId} value={m.userId}>{m.user.fullName || m.user.email}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex justify-end gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !form.title.trim()}
                                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                                >
                                    {isSubmitting ? 'Saving…' : editing === 'new' ? 'Add Scope Item' : 'Save Changes'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <>
                            {commitments.length === 0 && (
                                <div className="text-center py-8 text-muted-foreground">
                                    <FileSignature className="h-10 w-10 mx-auto mb-2 opacity-20" />
                                    <p className="text-sm font-medium">No scope items yet</p>
                                    <p className="text-xs opacity-60">Add what this client&apos;s scope includes each month</p>
                                </div>
                            )}
                            {commitments.map((c) => (
                                <div
                                    key={c.id}
                                    className={cn(
                                        'flex items-center gap-3 border rounded-lg p-3',
                                        c.isActive ? 'border-border/50' : 'border-border/30 opacity-60',
                                    )}
                                >
                                    <div className={cn('p-2 rounded-md shrink-0', typeIconClass(c.type))}>
                                        {typeIcon(c.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate">{c.title}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {c.quantityPerMonth}/mo · {c.engagementModel}
                                            {c.totalQuantity ? ` (cap ${c.totalQuantity})` : ''}
                                            {' · from '}{c.startsOn}
                                            {c.endsOn ? ` to ${c.endsOn}` : ''}
                                            {!c.isActive ? ' · Ended' : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setEditing(c)}
                                        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                        title="Edit scope item"
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    {c.isActive && (
                                        <button
                                            onClick={() => handleEnd(c)}
                                            className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                            title="End scope item"
                                        >
                                            <Ban className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                            <button
                                onClick={() => setEditing('new')}
                                className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                            >
                                <Plus className="h-4 w-4" /> Add Scope Item
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
