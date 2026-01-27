'use client';

import { useState, useEffect } from 'react';
import { X, Clock, Calendar, User, Tag, CheckSquare, MessageSquare, Play, Pause, ChevronDown, Command } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, Subtask } from '@/lib/types';

interface TaskDetailModalProps {
    task: Task | null;
    isOpen: boolean;
    onClose: () => void;
}

export function TaskDetailModal({ task, isOpen, onClose }: TaskDetailModalProps) {
    const [mounted, setMounted] = useState(false);
    const [activeTab, setActiveTab] = useState<'details' | 'history' | 'comments'>('details');
    const [subtasks, setSubtasks] = useState<Subtask[]>(task?.subtasks || []);
    const [comments, setComments] = useState<{ id: string, text: string, user: string, date: string }[]>([]);
    const [newComment, setNewComment] = useState('');

    useEffect(() => {
        if (task) {
            setSubtasks(task.subtasks || []);
        }
    }, [task]);

    useEffect(() => {
        setMounted(true);
    }, []);

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
                    "fixed inset-y-0 right-0 z-[120] w-full max-w-xl bg-card border-l border-border shadow-2xl transition-transform duration-300 ease-in-out transform",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
            >
                <div className="flex flex-col h-full uppercase-text-none shadow-none">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-border bg-background/50">
                        <div className="flex items-center gap-2">
                            <div className="bg-orange-500 text-white text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 bg-white rounded-full animate-pulse" />
                                Demo Mode (⌘+Shift+D to exit)
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
                                <Play className="h-4 w-4" />
                            </button>
                            <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors">
                                <Command className="h-4 w-4" />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-muted rounded-lg text-muted-foreground transition-colors"
                                title="Close"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-8">
                        {/* Title & Description */}
                        <div className="space-y-4">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Title</label>
                                <input
                                    type="text"
                                    defaultValue={task.title}
                                    className="w-full bg-transparent border-none text-xl font-bold p-0 focus:ring-0 placeholder:text-muted-foreground"
                                    placeholder="Task title..."
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                                <textarea
                                    className="w-full bg-transparent border-none text-sm p-0 focus:ring-0 resize-none min-h-[100px] placeholder:text-muted-foreground"
                                    placeholder="Add a detailed description..."
                                    defaultValue={task.description}
                                />
                            </div>
                        </div>

                        {/* Status & Priority */}
                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                                <button className="w-full flex items-center justify-between p-2 rounded-lg border border-border bg-muted/30 text-sm hover:bg-muted transition-colors">
                                    <span className="capitalize">{task.status.replace('_', ' ')}</span>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </button>
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <button className="w-full flex items-center justify-between p-2 rounded-lg border border-border bg-muted/30 text-sm hover:bg-muted transition-colors">
                                    <div className="flex items-center gap-2">
                                        <span className={cn(
                                            "h-2 w-2 rounded-full",
                                            task.priority === 'high' ? "bg-red-500" : task.priority === 'medium' ? "bg-yellow-500" : "bg-blue-500"
                                        )} />
                                        <span className="capitalize">{task.priority}</span>
                                    </div>
                                    <ChevronDown className="h-4 w-4 opacity-50" />
                                </button>
                            </div>
                        </div>

                        {/* Assignees */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assignees</label>
                            <div className="flex flex-wrap gap-2">
                                {['Jonah', 'Jordan', 'Stephen C', 'Daniel', 'Andrew'].map(name => (
                                    <button
                                        key={name}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all",
                                            task.assignees.includes(name) || name === 'Andrew' ? "bg-primary/10 border-primary text-primary" : "border-border hover:bg-muted/50"
                                        )}
                                    >
                                        <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center text-[8px] font-bold">{name.charAt(0)}</div>
                                        {name}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Due Date */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <div className="flex gap-2 mb-2">
                                <button className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-2">
                                    <Calendar className="h-3 w-3" /> Today
                                </button>
                                <button className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-2">
                                    <Calendar className="h-3 w-3" /> Tomorrow
                                </button>
                                <button className="px-3 py-1.5 rounded-lg border border-border text-xs hover:bg-muted transition-colors flex items-center gap-2">
                                    <Calendar className="h-3 w-3" /> Next Week
                                </button>
                            </div>
                            <input
                                type="date"
                                className="w-full bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-primary focus:border-primary"
                                defaultValue={task.dueDate}
                            />
                        </div>

                        {/* Client Context */}
                        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Client</label>
                            <p className="font-semibold text-foreground">{task.clientName || 'Pacific Coast Realty'}</p>
                            <div className="space-y-1">
                                <p className="text-xs text-muted-foreground flex items-center gap-2">
                                    <User className="h-3 w-3" /> Account Manager: Andrew
                                </p>
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tags</label>
                            <div className="flex flex-wrap gap-2">
                                {task.tags.map(tag => (
                                    <span key={tag} className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-500 text-[10px] border border-yellow-500/20 font-bold uppercase tracking-tight">{tag}</span>
                                ))}
                                <button className="px-2 py-1 rounded border border-dashed border-border text-[10px] hover:bg-muted transition-colors">+ Add</button>
                            </div>
                        </div>

                        {/* Subtasks */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <CheckSquare className="h-3 w-3" /> Subtasks
                                </label>
                            </div>
                            <div className="space-y-2">
                                {subtasks.map(sub => (
                                    <div key={sub.id} className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={sub.completed}
                                            onChange={() => {
                                                setSubtasks(prev => prev.map(s => s.id === sub.id ? { ...s, completed: !s.completed } : s));
                                            }}
                                            className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                                        />
                                        <span className={cn("text-sm", sub.completed && "line-through text-muted-foreground")}>{sub.title}</span>
                                    </div>
                                ))}
                                <button
                                    onClick={() => {
                                        const title = prompt('Enter subtask title:');
                                        if (title) {
                                            setSubtasks(prev => [...prev, { id: Math.random().toString(), title, completed: false }]);
                                        }
                                    }}
                                    className="text-[10px] text-primary hover:underline flex items-center gap-1 mt-1"
                                >
                                    + Add Subtask
                                </button>
                            </div>
                        </div>

                        {/* Time Log */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                    <Clock className="h-3 w-3" /> Time Log
                                </label>
                                <button className="text-[10px] text-primary hover:underline">+ Add Time</button>
                            </div>
                            <div className="border border-dashed border-border rounded-xl py-12 flex flex-col items-center justify-center text-muted-foreground gap-3">
                                <Clock className="h-8 w-8 opacity-20" />
                                <p className="text-xs italic">No time logged yet</p>
                                <p className="text-[10px]">Use the timer or add time manually</p>
                            </div>
                        </div>

                        {/* Comments */}
                        <div className="space-y-3">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                                <MessageSquare className="h-3 w-3" /> Comments
                            </label>
                            <div className="space-y-4">
                                <div className="bg-muted/30 border border-border rounded-lg p-3">
                                    <textarea
                                        className="w-full bg-transparent border-none text-sm p-0 focus:ring-0 resize-none min-h-[60px] placeholder:text-muted-foreground"
                                        placeholder="Add a comment... Use @name to mention someone"
                                        value={newComment}
                                        onChange={(e) => setNewComment(e.target.value)}
                                    />
                                    <div className="flex justify-end mt-2">
                                        <button
                                            onClick={() => {
                                                if (!newComment.trim()) return;
                                                setComments(prev => [{
                                                    id: Math.random().toString(),
                                                    text: newComment,
                                                    user: 'You',
                                                    date: 'Just now'
                                                }, ...prev]);
                                                setNewComment('');
                                            }}
                                            disabled={!newComment.trim()}
                                            className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded hover:bg-red-700 disabled:opacity-50"
                                        >
                                            Post Comment
                                        </button>
                                    </div>
                                </div>

                                <div className="space-y-4 mt-4">
                                    {comments.map(c => (
                                        <div key={c.id} className="flex gap-3">
                                            <div className="h-6 w-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold">Y</div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-xs font-bold">{c.user}</span>
                                                    <span className="text-[10px] text-muted-foreground">{c.date}</span>
                                                </div>
                                                <p className="text-xs text-foreground">{c.text}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
