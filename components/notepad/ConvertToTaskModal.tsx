'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { PersonalNote, OrganizationMember, User, TaskPriority } from '@/lib/types';
import { createTask } from '@/lib/supabase/tasks';
import { updatePersonalNote } from '@/lib/supabase/personal-notes';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { useClients } from '@/lib/hooks/use-clients';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';

interface ConvertToTaskModalProps {
    note: PersonalNote;
    onClose: () => void;
    onConverted: (note: PersonalNote) => void;
}

function htmlToPlainText(html: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return (doc.body.innerText ?? doc.body.textContent ?? '').trim();
}

export function ConvertToTaskModal({ note, onClose, onConverted }: ConvertToTaskModalProps) {
    const { organization } = useOrganization();
    const { userId, displayName } = useCurrentMember();
    const { clients } = useClients({});
    const [members, setMembers] = useState<(OrganizationMember & { user: User })[]>([]);
    const [title, setTitle] = useState(note.title || 'Untitled note');
    const [clientId, setClientId] = useState('');
    const [assigneeId, setAssigneeId] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (organization) getOrganizationMembers(organization.id).then(setMembers);
    }, [organization]);

    async function handleSubmit() {
        if (!organization || !title.trim()) return;
        setIsSubmitting(true);
        setError('');
        const result = await createTask({
            organizationId: organization.id,
            title: title.trim(),
            description: htmlToPlainText(note.contentHtml) || undefined,
            clientId: clientId || undefined,
            assigneeIds: assigneeId ? [assigneeId] : undefined,
            priority,
            createdBy: userId || undefined,
            actorName: displayName || undefined,
        });
        if (result.success && result.data) {
            const updated = await updatePersonalNote(note.id, { taskId: result.data.id });
            onConverted(updated ?? { ...note, taskId: result.data.id });
        } else {
            setError(result.error ?? 'Couldn’t create the task. Try again.');
            setIsSubmitting(false);
        }
    }

    const fieldClass =
        'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary';
    const labelClass = 'mb-1 block text-xs font-medium text-muted-foreground';

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-4">
            <div className="w-full rounded-xl border border-border bg-card p-4 shadow-xl">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Convert to task</p>
                    <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent/20">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="mt-3 space-y-3">
                    <div>
                        <label className={labelClass}>Title</label>
                        <input value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} />
                    </div>
                    <div>
                        <label className={labelClass}>Client (optional)</label>
                        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={fieldClass}>
                            <option value="">No client</option>
                            {clients.map((c) => <option key={c.id} value={c.id}>{c.clientName}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Assignee (optional)</label>
                        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldClass}>
                            <option value="">Unassigned</option>
                            {members.map((m) => (
                                <option key={m.userId} value={m.userId}>{m.user.fullName || m.user.email}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={labelClass}>Priority</label>
                        <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={fieldClass}>
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                            <option value="urgent">Urgent</option>
                        </select>
                    </div>
                    {error && <p className="text-xs text-destructive">{error}</p>}
                </div>

                <div className="mt-4 flex justify-end gap-2">
                    <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/20">Cancel</button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !title.trim()}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        {isSubmitting ? 'Creating…' : 'Create task'}
                    </button>
                </div>
            </div>
        </div>
    );
}
