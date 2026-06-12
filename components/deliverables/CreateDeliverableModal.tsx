'use client';

import { useEffect, useState } from 'react';
import { X, Package } from 'lucide-react';
import { Deliverable, DeliverableCommitment, DeliverableType, OrganizationMember, User } from '@/lib/types';
import { createDeliverable } from '@/lib/supabase/deliverables';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { SUBTYPE_OPTIONS } from './deliverable-ui';

interface CreateDeliverableModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (deliverable: Deliverable) => void;
    organizationId: string;
    clientId: string;
    /** Pre-fill from a commitment's "+ Add" button */
    commitment?: DeliverableCommitment;
    defaultMonth?: string; // 'YYYY-MM'
}

export function CreateDeliverableModal({
    isOpen, onClose, onCreated, organizationId, clientId, commitment, defaultMonth,
}: CreateDeliverableModalProps) {
    const [title, setTitle] = useState('');
    const [type, setType] = useState<DeliverableType>('Content');
    const [subtype, setSubtype] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [assigneeId, setAssigneeId] = useState('');
    const [notes, setNotes] = useState('');
    const [members, setMembers] = useState<(OrganizationMember & { user: User })[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setTitle('');
        setType(commitment?.type ?? 'Content');
        setSubtype(commitment?.subtype ?? '');
        setAssigneeId(commitment?.defaultAssigneeId ?? '');
        setNotes('');
        const month = defaultMonth ?? new Date().toISOString().slice(0, 7);
        const day = commitment?.dueDay
            ? String(commitment.dueDay).padStart(2, '0')
            : String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate());
        setDueDate(`${month}-${day}`);
        getOrganizationMembers(organizationId).then(setMembers);
    }, [isOpen, commitment, defaultMonth, organizationId]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) return;
        setIsSubmitting(true);
        const res = await createDeliverable({
            organizationId,
            clientId,
            title: title.trim(),
            type,
            subtype: subtype || undefined,
            status: 'Pending',
            dueDate,
            month: dueDate.slice(0, 7),
            assigneeId: assigneeId || undefined,
            commitmentId: commitment?.id,
            countsTowardsHours: commitment?.countsTowardHours ?? true,
            generatedBy: 'manual',
            notes: notes || undefined,
        });
        setIsSubmitting(false);
        if (res.success && res.data) {
            onCreated(res.data);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between p-4 border-b border-border/50 bg-muted/30">
                    <h3 className="font-semibold flex items-center gap-2">
                        <Package className="h-4 w-4 text-primary" />
                        New Deliverable{commitment ? ` — ${commitment.title}` : ''}
                    </h3>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-4 space-y-4">
                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Title</label>
                        <input
                            autoFocus
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            placeholder="e.g. 5 Signs Your AC Needs Repair"
                            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Type</label>
                            <select
                                value={type}
                                onChange={(e) => setType(e.target.value as DeliverableType)}
                                disabled={!!commitment}
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            >
                                {(['Content', 'Backlink', 'GBP', 'Other'] as const).map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Subtype</label>
                            <select
                                value={subtype}
                                onChange={(e) => setSubtype(e.target.value)}
                                disabled={!!commitment}
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
                            >
                                <option value="">—</option>
                                {SUBTYPE_OPTIONS.filter((s) => s.type === type).map((s) => (
                                    <option key={s.value} value={s.value}>{s.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Due date</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={(e) => setDueDate(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground">Assignee</label>
                            <select
                                value={assigneeId}
                                onChange={(e) => setAssigneeId(e.target.value)}
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                                <option value="">Unassigned</option>
                                {members.map((m) => (
                                    <option key={m.userId} value={m.userId}>
                                        {m.user.fullName || m.user.email}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-medium text-muted-foreground">Notes</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            rows={2}
                            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                        />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting || !title.trim()}
                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                            {isSubmitting ? 'Creating…' : 'Create Deliverable'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
