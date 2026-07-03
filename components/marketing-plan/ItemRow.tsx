'use client';

import { useState } from 'react';
import {
    ChevronDown, ChevronUp, MoreVertical, User, Clock,
    MessageSquare, ArrowUpRight, Trash2, EyeOff, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
    MarketingPlanItem, MarketingPlanItemPriority,
} from '@/lib/types';
import {
    updateMarketingPlanItem, addItemComment,
    deleteCustomItem, promoteItemToTask,
} from '@/lib/supabase/marketing-plans';

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
}

export function ItemRow({ item, members, currentUser, onChanged }: ItemRowProps) {
    const [expanded, setExpanded] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [commentDraft, setCommentDraft] = useState('');
    const [saving, setSaving] = useState(false);

    const isDone = item.status === 'done';
    const isIgnored = item.status === 'ignored';
    const assignee = members.find(m => m.userId === item.assigneeId);

    const toggleDone = async () => {
        await updateMarketingPlanItem(item.id, { status: isDone ? 'todo' : 'done' });
        onChanged();
    };

    const setPriority = async (p: MarketingPlanItemPriority) => {
        await updateMarketingPlanItem(item.id, { priority: p });
        onChanged();
    };

    const setAssignee = async (userId: string) => {
        await updateMarketingPlanItem(item.id, { assigneeId: userId || null });
        onChanged();
    };

    const setDueDate = async (date: string) => {
        await updateMarketingPlanItem(item.id, { dueDate: date || null });
        onChanged();
    };

    const toggleIgnored = async () => {
        setMenuOpen(false);
        await updateMarketingPlanItem(item.id, { status: isIgnored ? 'todo' : 'ignored' });
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

    return (
        <div className={cn(
            'py-4 border-b border-border/40 last:border-b-0',
            isIgnored && 'opacity-50',
        )}>
            {/* Title row */}
            <div className="flex items-start gap-3">
                <input
                    type="checkbox"
                    checked={isDone}
                    onChange={toggleDone}
                    disabled={isIgnored}
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
                                <button onClick={toggleIgnored} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted text-left">
                                    {isIgnored ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                                    {isIgnored ? 'Restore' : 'Ignore'}
                                </button>
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

            {/* Details toggle + meta chips */}
            <div className="flex items-center justify-between mt-2 ml-7">
                <button
                    onClick={() => setExpanded(e => !e)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline print:hidden"
                >
                    {expanded ? 'Hide details' : 'Show details'}
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

            {/* Expanded details */}
            {expanded && (
                <div className="ml-7 mt-3 space-y-4">
                    {item.description && (
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 print:hidden">
                        <select
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
                                onKeyDown={e => { if (e.key === 'Enter') submitComment(); }}
                                placeholder="Add a comment..."
                                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
                            />
                            {commentDraft.trim() && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={submitComment}
                                        disabled={saving}
                                        className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5"
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setCommentDraft('')}
                                        className="text-xs font-medium border border-border rounded-lg px-3 py-1.5"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
