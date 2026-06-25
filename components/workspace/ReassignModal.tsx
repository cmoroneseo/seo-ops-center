'use client';

import { useState, useEffect } from 'react';
import { X, UserCheck, Loader2 } from 'lucide-react';
import { reassignClient } from '@/lib/supabase/client-assignments';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useOrganization } from '@/components/providers/organization-provider';
import { ClientProject } from '@/lib/types';

interface ReassignModalProps {
    client: ClientProject;
    currentManager: string;
    onClose: () => void;
    onSuccess: (newManager: string, newManagerId?: string) => void;
}

export function ReassignModal({ client, currentManager, onClose, onSuccess }: ReassignModalProps) {
    const { organization } = useOrganization();
    const [members, setMembers] = useState<{ userId: string; name: string; email: string }[]>([]);
    const [selectedAssignee, setSelectedAssignee] = useState('');
    const [customName, setCustomName] = useState('');
    const [notes, setNotes] = useState('');
    const [assignedByName, setAssignedByName] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!organization) return;
        getOrganizationMembers(organization.id).then((data: any[]) => {
            const mapped = data.map((m: any) => ({
                userId: m.userId,
                name: m.user?.fullName || m.user?.email || 'Team Member',
                email: m.user?.email || '',
            }));
            setMembers(mapped);
        });
    }, [organization]);

    const selectedMember = selectedAssignee === '__custom__'
        ? undefined
        : members.find((m) => m.userId === selectedAssignee);
    const finalName = selectedAssignee === '__custom__' ? customName.trim() : selectedMember?.name ?? '';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!finalName || !organization) return;
        setLoading(true);
        setError(null);

        const { error: err } = await reassignClient({
            clientId: client.id,
            organizationId: organization.id,
            newAssigneeName: finalName,
            newAssigneeId: selectedMember?.userId,
            assignedByName: assignedByName.trim() || 'Team',
            notes: notes.trim() || undefined,
        });

        setLoading(false);
        if (err) {
            setError(err);
        } else {
            onSuccess(finalName, selectedMember?.userId);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                            <UserCheck className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                            <h2 className="text-base font-semibold">Reassign Account Manager</h2>
                            <p className="text-xs text-muted-foreground">{client.clientName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-md transition-colors">
                        <X className="h-4 w-4 text-muted-foreground" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Current */}
                    <div className="p-3 rounded-lg bg-muted/30 border border-border/50 text-sm">
                        <span className="text-muted-foreground">Current manager: </span>
                        <span className="font-medium">{currentManager || '—'}</span>
                    </div>

                    {/* New Assignee */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Assign to</label>
                        <select
                            value={selectedAssignee}
                            onChange={(e) => setSelectedAssignee(e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            required
                        >
                            <option value="">Select team member…</option>
                            {members.map((m) => (
                                <option key={m.userId || m.email} value={m.userId}>{m.name}</option>
                            ))}
                            <option value="__custom__">Enter name manually…</option>
                        </select>
                    </div>

                    {selectedAssignee === '__custom__' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Name</label>
                            <input
                                type="text"
                                value={customName}
                                onChange={(e) => setCustomName(e.target.value)}
                                placeholder="e.g. Abel"
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                required
                            />
                        </div>
                    )}

                    {/* Assigned by */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Reassigned by</label>
                        <input
                            type="text"
                            value={assignedByName}
                            onChange={(e) => setAssignedByName(e.target.value)}
                            placeholder="Your name"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Reason <span className="text-muted-foreground font-normal">(optional)</span></label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="e.g. Passing to Abel while Carlos is on leave"
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        />
                    </div>

                    {error && <p className="text-xs text-red-500">{error}</p>}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !finalName}
                            className="flex-1 flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
                            Reassign
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
