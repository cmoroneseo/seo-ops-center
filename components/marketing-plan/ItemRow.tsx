'use client';

import { useState } from 'react';
import {
    ChevronDown, ChevronUp, MoreVertical, User, Clock,
    MessageSquare, ArrowUpRight, Trash2,
} from 'lucide-react';
import { TASK_STATUS_LABELS } from '@/lib/marketing-plan-execution';
import { cn } from '@/lib/utils';
import {
    MarketingPlanItem, MarketingPlanItemPriority, Task,
} from '@/lib/types';
import {
    updateMarketingPlanItem, addItemComment,
    deleteCustomItem, promoteItemToTask,
} from '@/lib/supabase/marketing-plans';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { RoadmapItemDetails } from './RoadmapItemDetails';
import { isInRoadmap } from '@/lib/marketing-plan-roadmap';
import { checklistTogglePlan } from '@/lib/marketing-plan-logic';

export interface MemberOption {
    userId: string;
    displayName: string;
}

const PRIORITY_STYLES: Record<MarketingPlanItemPriority, string> = {
    high: 'text-red-600',
    medium: 'text-yellow-600',
    low: 'text-blue-600',
};

interface ItemRowProps {
    item: MarketingPlanItem;
    members: MemberOption[];
    currentUser: { id?: string; name: string };
    onChanged: () => void;
    onOpenTask?: (task: Task) => void;
}

export function ItemRow({ item, members, currentUser, onChanged, onOpenTask }: ItemRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [commentDraft, setCommentDraft] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [toggling, setToggling] = useState(false);

    const isDone = item.status === 'done';
    const isIgnored = !isInRoadmap(item);
    const assignee = members.find(m => m.userId === item.assigneeId);

    const saveItem = async (patch: Parameters<typeof updateMarketingPlanItem>[1]) => {
        setError('');
        const res = await updateMarketingPlanItem(item.id, patch);
        if (!res.success) { const message = res.error ?? 'Could not save changes'; setError(message); return; }
        onChanged();
    };

    const toggleDone = async () => {
        await saveItem({ status: isDone ? 'todo' : 'done' });
        onChanged();
    };

    const setPriority = async (p: MarketingPlanItemPriority) => {
        await saveItem({ priority: p });
        onChanged();
    };

    const setAssignee = async (userId: string) => {
        await saveItem({ assigneeId: userId || null });
        onChanged();
    };

    const setDueDate = async (date: string) => {
        await saveItem({ dueDate: date || null });
        onChanged();
    };

    const handlePromote = async () => {
        setMenuOpen(false);
        const res = await promoteItemToTask(item, currentUser.name);
        if (!res.success) alert(res.error ?? 'Failed to create task');
        onChanged();
    };

    const handleDelete = async () => {
        setMenuOpen(false);
        if (!confirm('Delete this item?')) return;
        await deleteCustomItem(item.id);
        onChanged();
    };

    const submitComment = async () => {
        const body = commentDraft.trim();
        if (!body) return;
        setSaving(true);
        await addItemComment(item.id, item.comments, {
            authorId: currentUser.id,
            authorName: currentUser.name,
            body,
            createdAt: new Date().toISOString(),
        });
        setCommentDraft('');
        setSaving(false);
        onChanged();
    };

    const initials = (name: string) =>
        name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

    // Render [label](url) markdown links in descriptions as clickable anchors
    const renderDescription = (text: string) => {
        const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
        return parts.map((part, i) => {
            const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            if (m) {
                return (
                    <a
                        key={i}
                        href={m[2]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline underline-offset-2 hover:opacity-80"
                    >
                        {m[1]}
                    </a>
                );
            }
            return <span key={i}>{part}</span>;
        });
    };

    if (item.taskId) return <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 py-4 last:border-b-0">
        <div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{isIgnored ? 'Excluded from plan' : item.linkedTask ? TASK_STATUS_LABELS[item.linkedTask.status] : isDone ? 'Done' : 'Linked task'} · {item.dueDate ?? 'No due date'} · Shared with Tasks</p></div>
        <div className="flex gap-2">{item.linkedTask && onOpenTask ? <button className="min-h-10 shrink-0 rounded-lg border border-border px-3 text-sm text-primary hover:bg-muted" onClick={() => onOpenTask(item.linkedTask!)}>Open task</button> : <a className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-sm text-primary" href={`/tasks?task=${item.taskId}`}>Open task</a>}</div>
        <details className="w-full rounded-lg bg-muted/30 p-3"><summary className="cursor-pointer text-xs font-medium text-primary">Roadmap scope &amp; details</summary><div className="mt-3"><RoadmapItemDetails item={item} onSave={async patch => { const res = await updateMarketingPlanItem(item.id, patch); if (!res.success) throw new Error(res.error ?? 'Could not save roadmap scope'); onChanged(); }} /></div></details>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>;

    return (
        <div className={cn(
            'py-4 border-b border-border/40 last:border-b-0',
            isIgnored && 'opacity-50',
        )}>
            {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
            {/* Title row */}
            <div className="flex items-start gap-3">
                <input
                    aria-label={`Complete ${item.title}`}
                    type="checkbox"
                    checked={isDone}
                    onChange={toggleDone}
                    disabled={isIgnored || toggling}
                    className="mt-1 h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                    <span className={cn('font-semibold text-sm', isDone && 'line-through text-muted-foreground')}>
                        {item.title}
                    </span>
                    {item.taskId && (
                        <a
                            href={`/tasks?task=${item.taskId}`}
                            className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full align-middle"
                        >
                            Task <ArrowUpRight className="h-2.5 w-2.5" />
                        </a>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0 print:hidden">
                    <select
                        aria-label={`Priority for ${item.title}`}
                        value={item.priority}
                        onChange={e => setPriority(e.target.value as MarketingPlanItemPriority)}
                        className={cn(
                            'text-xs font-medium border border-border rounded-lg px-2 py-1.5 bg-card cursor-pointer',
                            PRIORITY_STYLES[item.priority],
                        )}
                    >
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                    </select>
                    <div className="relative">
                        <button
                            aria-label={`Actions for ${item.title}`}
                            aria-expanded={menuOpen}
                            onClick={() => setMenuOpen(o => !o)}
                            className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                        {menuOpen && (
                            <div className="absolute right-0 mt-1 w-44 rounded-lg border border-border bg-card shadow-lg z-10 py-1 text-sm">
                                {!item.taskId && (
                                    <button onClick={handlePromote} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left">
                                        <ArrowUpRight className="h-3.5 w-3.5" /> Promote to Task
                                    </button>
                                )}
                                {item.isCustom && (
                                    <button onClick={handleDelete} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left text-red-600">
                                        <Trash2 className="h-3.5 w-3.5" /> Delete
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Description — always visible, like SE Ranking */}
            {item.description && (
                <p className="text-sm text-muted-foreground leading-relaxed mt-2 ml-7">
                    {renderDescription(item.description)}
                </p>
            )}

            {/* Details toggle + meta chips */}
            <div className="flex items-center justify-between mt-2 ml-7">
                <button
                    aria-expanded={expanded}
                    onClick={() => setExpanded(e => !e)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline print:hidden"
                >
                    {expanded ? 'Hide details' : 'Roadmap scope & details'}
                    {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground print:hidden">
                    <span className="flex items-center gap-1 border border-dashed border-border rounded-full px-2 py-0.5">
                        <User className="h-3 w-3" /> {assignee?.displayName ?? 'Unassigned'}
                    </span>
                    <span className="flex items-center gap-1 border border-dashed border-border rounded-full px-2 py-0.5">
                        <Clock className="h-3 w-3" /> {item.dueDate ?? 'None'}
                    </span>
                    <span className="flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" /> {item.comments.length}
                    </span>
                </div>
            </div>

            {/* Expanded: assignee/due controls + comment section */}
            {expanded && (
                <div className="ml-7 mt-3 space-y-4 rounded-lg bg-muted/30 p-4">
                    <RoadmapItemDetails item={item} onSave={async patch => { const res = await updateMarketingPlanItem(item.id, patch); if (!res.success) throw new Error(res.error ?? 'Could not save roadmap scope'); onChanged(); }} />
                    <div className="flex items-center gap-3 print:hidden">
                        <select
                            aria-label={`Owner for ${item.title}`}
                            value={item.assigneeId ?? ''}
                            onChange={e => setAssignee(e.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                        >
                            <option value="">Unassigned</option>
                            {members.map(m => (
                                <option key={m.userId} value={m.userId}>{m.displayName}</option>
                            ))}
                        </select>
                        <input
                            aria-label={`Due date for ${item.title}`}
                            type="date"
                            value={item.dueDate ?? ''}
                            onChange={e => setDueDate(e.target.value)}
                            className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                        />
                    </div>
                    {item.comments.length > 0 && (
                        <div className="space-y-2">
                            {item.comments.map((c, i) => (
                                <div key={i} className="flex items-start gap-2">
                                    <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                                        {initials(c.authorName)}
                                    </div>
                                    <div className="text-sm">
                                        <span className="font-semibold">{c.authorName}</span>
                                        <span className="text-xs text-muted-foreground ml-2">
                                            {new Date(c.createdAt).toLocaleDateString()}
                                        </span>
                                        <p className="text-muted-foreground">{c.body}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex items-start gap-2 print:hidden">
                        <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                            {initials(currentUser.name)}
                        </div>
                        <div className="flex-1 space-y-2">
                            <input
                                value={commentDraft}
                                onChange={e => setCommentDraft(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !saving) submitComment(); }}
                                placeholder="Add a comment..."
                                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
                            />
                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setCommentDraft(''); setExpanded(false); }}
                                    className="text-xs font-medium border border-border rounded-lg px-3 py-1.5 hover:bg-muted"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={submitComment}
                                    disabled={saving || !commentDraft.trim()}
                                    className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                                >
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
