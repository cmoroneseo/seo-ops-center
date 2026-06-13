'use client';

import { useEffect, useState } from 'react';
import { X, Calendar, ExternalLink, ListTodo, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    Deliverable, DeliverableStatus, OrganizationMember, TaskCategory, User,
} from '@/lib/types';
import { updateDeliverable, deleteDeliverable } from '@/lib/supabase/deliverables';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { createTask } from '@/lib/supabase/tasks';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { DELIVERABLE_STATUSES, statusBadgeClass, subtypeLabel } from './deliverable-ui';

const TYPE_TO_TASK_CATEGORY: Record<string, TaskCategory> = {
    Content: 'content',
    Backlink: 'links',
    GBP: 'local',
    Other: 'technical',
};

interface DeliverableDetailPanelProps {
    deliverable: Deliverable | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdated: (d: Deliverable) => void;
    onDeleted?: (id: string) => void;
    organizationId: string;
    clientName?: string;
}

export function DeliverableDetailPanel({
    deliverable, isOpen, onClose, onUpdated, onDeleted, organizationId, clientName,
}: DeliverableDetailPanelProps) {
    const { userId } = useCurrentMember();
    const [members, setMembers] = useState<(OrganizationMember & { user: User })[]>([]);
    const [publishedUrl, setPublishedUrl] = useState('');
    const [wordCount, setWordCount] = useState('');
    const [taskCreated, setTaskCreated] = useState(false);
    const [isCreatingTask, setIsCreatingTask] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');

    useEffect(() => {
        if (!isOpen || !deliverable) return;
        setPublishedUrl(deliverable.publishedUrl ?? '');
        setWordCount(deliverable.wordCount ? String(deliverable.wordCount) : '');
        setTitleDraft(deliverable.title);
        setEditingTitle(false);
        setTaskCreated(false);
        getOrganizationMembers(organizationId).then(setMembers);
    }, [isOpen, deliverable?.id, organizationId]);

    if (!isOpen || !deliverable) return null;

    const patch = async (p: Partial<Deliverable>) => {
        const res = await updateDeliverable(deliverable.id, p, { organizationId, actorId: userId });
        if (res.success && res.data) onUpdated(res.data);
    };

    const handleCreateTask = async () => {
        setIsCreatingTask(true);
        const res = await createTask({
            organizationId,
            clientId: deliverable.clientId,
            title: deliverable.title,
            description: `Production task for deliverable: ${deliverable.title}`,
            priority: 'medium',
            status: 'todo',
            category: TYPE_TO_TASK_CATEGORY[deliverable.type] ?? 'content',
            tags: [],
            dueDate: deliverable.dueDate ?? undefined,
            assigneeIds: deliverable.assigneeId ? [deliverable.assigneeId] : [],
            deliverableId: deliverable.id,
            createdBy: userId,
        });
        setIsCreatingTask(false);
        if (res.success) setTaskCreated(true);
    };

    const handleDelete = async () => {
        if (!confirm(`Delete "${deliverable.title}"? This cannot be undone.`)) return;
        const res = await deleteDeliverable(deliverable.id);
        if (res.success) {
            onDeleted?.(deliverable.id);
            onClose();
        }
    };

    const history = deliverable.statusHistory ?? [];

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="w-full max-w-md h-full bg-card border-l border-border shadow-xl overflow-y-auto animate-in slide-in-from-right duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between p-4 border-b border-border/50 bg-card">
                    <div className="min-w-0 flex-1">
                        {editingTitle ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onBlur={() => {
                                    setEditingTitle(false);
                                    const trimmed = titleDraft.trim();
                                    if (trimmed && trimmed !== deliverable.title) patch({ title: trimmed });
                                    else setTitleDraft(deliverable.title);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                    if (e.key === 'Escape') { setTitleDraft(deliverable.title); setEditingTitle(false); }
                                }}
                                className="w-full font-semibold bg-transparent border-b border-primary focus:outline-none text-sm pb-0.5"
                            />
                        ) : (
                            <h3
                                className="font-semibold truncate cursor-text hover:text-primary transition-colors"
                                onClick={() => setEditingTitle(true)}
                                title="Click to edit title"
                            >
                                {deliverable.title}
                            </h3>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {clientName ? `${clientName} · ` : ''}{deliverable.type}
                            {deliverable.subtype ? ` · ${subtypeLabel(deliverable.subtype)}` : ''}
                            {deliverable.generatedBy === 'cron' ? ' · Auto-generated' : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors shrink-0 ml-2">
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className="p-4 space-y-5">
                    {/* Status stepper */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                        <div className="flex items-center gap-1 mt-2">
                            {DELIVERABLE_STATUSES.map((s, i) => {
                                const currentIdx = DELIVERABLE_STATUSES.indexOf(deliverable.status);
                                const reached = i <= currentIdx;
                                return (
                                    <button
                                        key={s}
                                        onClick={() => patch({ status: s as DeliverableStatus })}
                                        title={s}
                                        className={cn(
                                            'flex-1 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded border transition-all',
                                            s === deliverable.status
                                                ? statusBadgeClass(s)
                                                : reached
                                                    ? 'text-muted-foreground bg-muted/50 border-border'
                                                    : 'text-muted-foreground/50 bg-transparent border-border/50 hover:bg-muted/30',
                                        )}
                                    >
                                        {s === 'In Progress' ? 'In Prog.' : s}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Due date + assignee */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Due date</label>
                            <input
                                type="date"
                                value={deliverable.dueDate ? String(deliverable.dueDate).slice(0, 10) : ''}
                                onChange={(e) => patch({ dueDate: e.target.value || undefined, month: e.target.value.slice(0, 7) })}
                                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Assignee</label>
                            <select
                                value={deliverable.assigneeId ?? ''}
                                onChange={(e) => patch({ assigneeId: e.target.value || undefined })}
                                className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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

                    {/* Published URL + word count */}
                    <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Published URL</label>
                        <div className="flex items-center gap-2 mt-1.5">
                            <input
                                value={publishedUrl}
                                onChange={(e) => setPublishedUrl(e.target.value)}
                                onBlur={() => publishedUrl !== (deliverable.publishedUrl ?? '') && patch({ publishedUrl: publishedUrl || undefined })}
                                placeholder="https://…"
                                className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            {deliverable.publishedUrl && (
                                <a
                                    href={deliverable.publishedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 rounded-lg border border-border text-muted-foreground hover:text-primary transition-colors"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            )}
                        </div>
                    </div>

                    {deliverable.type === 'Content' && (
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Word count</label>
                            <input
                                type="number"
                                value={wordCount}
                                onChange={(e) => setWordCount(e.target.value)}
                                onBlur={() => patch({ wordCount: wordCount ? Number(wordCount) : undefined })}
                                className="mt-1.5 w-32 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                        </div>
                    )}

                    {/* Production task shortcut */}
                    <button
                        onClick={handleCreateTask}
                        disabled={isCreatingTask || taskCreated}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                            taskCreated
                                ? 'border-green-500/20 bg-green-500/10 text-green-500'
                                : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40',
                        )}
                    >
                        {taskCreated
                            ? <><Check className="h-4 w-4" /> Production task created</>
                            : <><ListTodo className="h-4 w-4" /> {isCreatingTask ? 'Creating…' : 'Create production task'}</>}
                    </button>

                    {/* Status history */}
                    {history.length > 0 && (
                        <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">History</label>
                            <div className="mt-2 space-y-1.5">
                                {[...history].reverse().map((h, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border', statusBadgeClass(h.status))}>
                                            {h.status}
                                        </span>
                                        <Calendar className="h-3 w-3" />
                                        {new Date(h.at).toLocaleDateString()} {new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <button
                        onClick={handleDelete}
                        className="w-full flex items-center justify-center gap-2 rounded-lg border border-red-500/20 px-3 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                        <Trash2 className="h-4 w-4" /> Delete deliverable
                    </button>
                </div>
            </div>
        </div>
    );
}
