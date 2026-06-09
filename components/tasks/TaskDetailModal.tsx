'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Clock, Calendar, Tag, CheckSquare, MessageSquare, ChevronDown, Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, TaskComment, TaskStatus, TaskPriority, TaskCategory } from '@/lib/types';
import { getTask, updateTask, createTask, deleteTask, getTaskComments, createTaskComment } from '@/lib/supabase/tasks';
import { useOrganization } from '@/components/providers/organization-provider';
import { useTimer } from '@/components/providers/timer-provider';

interface TaskDetailModalProps {
    task: Task | null;
    isOpen: boolean;
    onClose: () => void;
    onUpdate?: (task: Task) => void;
    currentUserId?: string;
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
    { value: 'todo', label: 'To Do' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'review', label: 'Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'done', label: 'Done' },
];

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; color: string }[] = [
    { value: 'urgent', label: 'Urgent', color: 'bg-red-600' },
    { value: 'high', label: 'High', color: 'bg-red-500' },
    { value: 'medium', label: 'Medium', color: 'bg-yellow-500' },
    { value: 'low', label: 'Low', color: 'bg-blue-400' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical SEO' },
    { value: 'local', label: 'Local SEO' },
    { value: 'links', label: 'Link Building' },
    { value: 'reporting', label: 'Reporting' },
    { value: 'admin', label: 'Admin' },
];

export function TaskDetailModal({ task, isOpen, onClose, onUpdate, currentUserId }: TaskDetailModalProps) {
    const { organization, memberships } = useOrganization();
    const { timer, start, pause } = useTimer();
    const [mounted, setMounted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [comments, setComments] = useState<TaskComment[]>([]);
    const [newComment, setNewComment] = useState('');
    const [postingComment, setPostingComment] = useState(false);
    const [loggedHours, setLoggedHours] = useState(0);
    const [subtasks, setSubtasks] = useState<Task[]>([]);
    const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
    const [addingSubtask, setAddingSubtask] = useState(false);

    // Local editable state
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [status, setStatus] = useState<TaskStatus>('todo');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [dueDate, setDueDate] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [newTag, setNewTag] = useState('');

    useEffect(() => { setMounted(true); }, []);

    // Reset state when task changes
    useEffect(() => {
        if (!task) return;
        setTitle(task.title ?? '');
        setDescription(task.description ?? '');
        setStatus(task.status ?? 'todo');
        setPriority(task.priority ?? 'medium');
        setCategory((task.category as TaskCategory) ?? '');
        setDueDate(task.dueDate ? task.dueDate.slice(0, 10) : '');
        setTags(task.tags ?? []);
    }, [task?.id]);

    // Load comments + hours when task opens
    const loadTaskData = useCallback(async () => {
        if (!task) return;
        const [commentsData, taskData] = await Promise.all([
            getTaskComments(task.id),
            getTask(task.id),
        ]);
        setComments(commentsData);
        setLoggedHours(taskData.loggedHours);
        setSubtasks(taskData.subtasks);
    }, [task?.id]);

    useEffect(() => {
        if (isOpen && task) loadTaskData();
    }, [isOpen, task?.id]);

    const save = useCallback(async (patch: Parameters<typeof updateTask>[1]) => {
        if (!task) return;
        setSaving(true);
        const result = await updateTask(task.id, { ...patch, updatedBy: currentUserId });
        setSaving(false);
        if (result.success && result.data) {
            onUpdate?.(result.data);
        }
    }, [task?.id, currentUserId, onUpdate]);

    const handleStatusChange = async (newStatus: TaskStatus) => {
        setStatus(newStatus);
        await save({ status: newStatus });
    };

    const handlePriorityChange = async (newPriority: TaskPriority) => {
        setPriority(newPriority);
        await save({ priority: newPriority });
    };

    const handleTitleBlur = async () => {
        if (title !== task?.title) await save({ title });
    };

    const handleDescriptionBlur = async () => {
        if (description !== task?.description) await save({ description });
    };

    const handleDueDateChange = async (date: string) => {
        setDueDate(date);
        await save({ dueDate: date || undefined });
    };

    const handleCategoryChange = async (cat: TaskCategory | '') => {
        setCategory(cat);
        await save({ category: cat as TaskCategory || undefined });
    };

    const handleAddTag = async () => {
        const tag = newTag.trim().toLowerCase();
        if (!tag || tags.includes(tag)) { setNewTag(''); return; }
        const next = [...tags, tag];
        setTags(next);
        setNewTag('');
        await save({ tags: next });
    };

    const handleRemoveTag = async (tag: string) => {
        const next = tags.filter(t => t !== tag);
        setTags(next);
        await save({ tags: next });
    };

    const handleAddSubtask = async () => {
        const t = newSubtaskTitle.trim();
        if (!t || !task || !organization) return;
        setAddingSubtask(true);
        const result = await createTask({
            organizationId: organization.id,
            projectId: task.projectId,
            clientId: task.clientId,
            title: t,
            parentTaskId: task.id,
            priority: 'medium',
            status: 'todo',
            createdBy: currentUserId,
        });
        if (result.success && result.data) {
            setSubtasks(prev => [...prev, result.data!]);
            setNewSubtaskTitle('');
        }
        setAddingSubtask(false);
    };

    const handleSubtaskToggle = async (subtask: Task) => {
        const newStatus: TaskStatus = subtask.status === 'done' ? 'todo' : 'done';
        const result = await updateTask(subtask.id, { status: newStatus });
        if (result.success && result.data) {
            setSubtasks(prev => prev.map(s => s.id === subtask.id ? result.data! : s));
        }
    };

    const handlePostComment = async () => {
        if (!newComment.trim() || !task || !organization) return;
        const currentMember = memberships.find(m => m.organizationId === organization.id);
        setPostingComment(true);
        const result = await createTaskComment({
            organizationId: organization.id,
            taskId: task.id,
            authorId: currentUserId,
            authorName: currentMember ? undefined : 'Unknown',
            body: newComment.trim(),
        });
        if (result.success && result.data) {
            setComments(prev => [...prev, result.data!]);
            setNewComment('');
        }
        setPostingComment(false);
    };

    const isThisTaskRunning = timer?.status === 'running' && timer.taskId === task?.id;

    const handleTimerClick = async () => {
        if (!task) return;
        if (isThisTaskRunning) {
            await pause();
        } else if (task.clientId || task.projectId) {
            await start({
                clientId: task.clientId ?? task.projectId ?? '',
                clientName: task.clientName ?? 'Unknown',
                taskId: task.id,
                taskTitle: task.title,
            });
        }
    };

    const setQuickDate = async (offset: number) => {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        const iso = d.toISOString().slice(0, 10);
        await handleDueDateChange(iso);
    };

    if (!mounted || !task) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className={cn(
                    "fixed inset-0 z-[110] bg-background/80 backdrop-blur-sm transition-opacity duration-300",
                    isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
                )}
                onClick={onClose}
            />

            {/* Slide-over panel */}
            <div
                className={cn(
                    "fixed inset-y-0 right-0 z-[120] w-full max-w-xl bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/50 shrink-0">
                        <div className="flex items-center gap-2">
                            {saving && (
                                <span className="text-[10px] text-muted-foreground animate-pulse">Saving…</span>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                            {(task.clientId || task.projectId) && (
                                <button
                                    onClick={handleTimerClick}
                                    title={isThisTaskRunning ? 'Pause timer' : 'Start timer'}
                                    className={cn(
                                        "p-2 rounded-lg transition-colors text-xs font-medium flex items-center gap-1.5",
                                        isThisTaskRunning
                                            ? "bg-amber-500/15 text-amber-500 hover:bg-amber-500/25"
                                            : "hover:bg-muted text-muted-foreground"
                                    )}
                                >
                                    <Clock className="h-4 w-4" />
                                    {isThisTaskRunning ? 'Pause' : 'Start Timer'}
                                </button>
                            )}
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-7 custom-scrollbar">
                        {/* Title */}
                        <div>
                            <input
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                onBlur={handleTitleBlur}
                                className="w-full bg-transparent border-none text-xl font-bold p-0 focus:ring-0 placeholder:text-muted-foreground"
                                placeholder="Task title…"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                onBlur={handleDescriptionBlur}
                                className="w-full bg-transparent border-none text-sm p-0 mt-1 focus:ring-0 resize-none min-h-[80px] placeholder:text-muted-foreground"
                                placeholder="Add details…"
                            />
                        </div>

                        {/* Status & Priority */}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                                <div className="relative">
                                    <select
                                        value={status}
                                        onChange={e => handleStatusChange(e.target.value as TaskStatus)}
                                        className="w-full appearance-none p-2 pr-8 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                    >
                                        {STATUS_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <div className="relative">
                                    <select
                                        value={priority}
                                        onChange={e => handlePriorityChange(e.target.value as TaskPriority)}
                                        className="w-full appearance-none p-2 pr-8 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                    >
                                        {PRIORITY_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 opacity-50 pointer-events-none" />
                                </div>
                            </div>
                        </div>

                        {/* Category */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">SEO Category</label>
                            <div className="flex flex-wrap gap-2">
                                {CATEGORY_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => handleCategoryChange(category === opt.value ? '' : opt.value)}
                                        className={cn(
                                            "px-3 py-1 rounded-full text-xs font-medium transition-all border",
                                            category === opt.value
                                                ? "bg-primary/15 border-primary text-primary"
                                                : "border-border hover:bg-muted text-muted-foreground"
                                        )}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Due Date */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <div className="flex gap-2 mb-2">
                                {[{ label: 'Today', offset: 0 }, { label: 'Tomorrow', offset: 1 }, { label: 'Next Week', offset: 7 }].map(({ label, offset }) => (
                                    <button
                                        key={label}
                                        onClick={() => setQuickDate(offset)}
                                        className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-1.5"
                                    >
                                        <Calendar className="h-3 w-3" /> {label}
                                    </button>
                                ))}
                            </div>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={e => handleDueDateChange(e.target.value)}
                                className="w-full bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary focus:border-primary"
                            />
                        </div>

                        {/* Client Context */}
                        {task.clientName && (
                            <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Client</label>
                                <p className="font-semibold text-foreground mt-1">{task.clientName}</p>
                            </div>
                        )}

                        {/* Tags */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tags</label>
                            <div className="flex flex-wrap gap-2 items-center">
                                {tags.map(tag => (
                                    <button
                                        key={tag}
                                        onClick={() => handleRemoveTag(tag)}
                                        className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-600 text-[10px] border border-yellow-500/20 font-bold uppercase tracking-tight hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/20 transition-colors group"
                                        title="Click to remove"
                                    >
                                        {tag} <span className="opacity-0 group-hover:opacity-100">×</span>
                                    </button>
                                ))}
                                <div className="flex items-center gap-1">
                                    <input
                                        type="text"
                                        value={newTag}
                                        onChange={e => setNewTag(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                                        placeholder="Add tag…"
                                        className="text-[11px] bg-muted/40 border border-dashed border-border rounded px-2 py-1 w-24 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    {newTag && (
                                        <button onClick={handleAddTag} className="text-[10px] text-primary hover:underline">Add</button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Subtasks */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <CheckSquare className="h-3 w-3" /> Subtasks
                                {subtasks.length > 0 && (
                                    <span className="ml-1 text-muted-foreground">
                                        ({subtasks.filter(s => s.status === 'done').length}/{subtasks.length})
                                    </span>
                                )}
                            </label>
                            <div className="space-y-2">
                                {subtasks.map(sub => (
                                    <div key={sub.id} className="flex items-center gap-3 group">
                                        <input
                                            type="checkbox"
                                            checked={sub.status === 'done'}
                                            onChange={() => handleSubtaskToggle(sub)}
                                            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                                        />
                                        <span className={cn(
                                            "text-sm flex-1",
                                            sub.status === 'done' && "line-through text-muted-foreground"
                                        )}>
                                            {sub.title}
                                        </span>
                                    </div>
                                ))}
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="text"
                                        value={newSubtaskTitle}
                                        onChange={e => setNewSubtaskTitle(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddSubtask()}
                                        placeholder="Add subtask…"
                                        className="text-sm bg-muted/30 border border-dashed border-border rounded-lg px-3 py-1.5 flex-1 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
                                    />
                                    {newSubtaskTitle && (
                                        <button
                                            onClick={handleAddSubtask}
                                            disabled={addingSubtask}
                                            className="p-1.5 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50"
                                        >
                                            <Plus className="h-4 w-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Time Log */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                    <Clock className="h-3 w-3" /> Time Logged
                                </label>
                            </div>
                            {loggedHours > 0 ? (
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border">
                                    <Clock className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="text-sm font-semibold">{loggedHours.toFixed(1)}h logged</p>
                                        <p className="text-[10px] text-muted-foreground">Use the timer to track more time on this task</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="border border-dashed border-border rounded-xl py-8 flex flex-col items-center justify-center text-muted-foreground gap-2">
                                    <Clock className="h-6 w-6 opacity-20" />
                                    <p className="text-xs italic">No time logged yet</p>
                                    {(task.clientId || task.projectId) && (
                                        <button
                                            onClick={handleTimerClick}
                                            className="mt-1 text-[11px] text-primary hover:underline"
                                        >
                                            Start timer for this task →
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Comments */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                <MessageSquare className="h-3 w-3" /> Comments
                                {comments.length > 0 && <span className="ml-1 text-muted-foreground">({comments.length})</span>}
                            </label>

                            {/* Existing comments */}
                            {comments.length > 0 && (
                                <div className="space-y-4">
                                    {comments.map(c => (
                                        <div key={c.id} className="flex gap-3">
                                            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary shrink-0">
                                                {(c.authorName ?? 'U').charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-bold">{c.authorName ?? 'Team member'}</span>
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-foreground whitespace-pre-wrap">{c.body}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* New comment */}
                            <div className="bg-muted/30 border border-border rounded-lg p-3">
                                <textarea
                                    className="w-full bg-transparent border-none text-sm p-0 focus:ring-0 resize-none min-h-[60px] placeholder:text-muted-foreground"
                                    placeholder="Add a comment…"
                                    value={newComment}
                                    onChange={e => setNewComment(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePostComment();
                                    }}
                                />
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-[10px] text-muted-foreground">⌘+Enter to post</span>
                                    <button
                                        onClick={handlePostComment}
                                        disabled={!newComment.trim() || postingComment}
                                        className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                                    >
                                        {postingComment ? 'Posting…' : 'Post Comment'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
