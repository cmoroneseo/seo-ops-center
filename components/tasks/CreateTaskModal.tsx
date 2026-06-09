'use client';

import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task, TaskPriority, TaskStatus, TaskCategory } from '@/lib/types';
import { createTask } from '@/lib/supabase/tasks';
import { useOrganization } from '@/components/providers/organization-provider';

interface CreateTaskModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreated: (task: Task) => void;
    organizationId: string;
    currentUserId?: string;
    /** Pre-fill these when opened from a client context */
    defaultClientId?: string;
    defaultClientName?: string;
    defaultProjectId?: string;
}

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
    { value: 'urgent', label: 'Urgent' },
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const CATEGORY_OPTIONS: { value: TaskCategory; label: string }[] = [
    { value: 'content', label: 'Content' },
    { value: 'technical', label: 'Technical SEO' },
    { value: 'local', label: 'Local SEO' },
    { value: 'links', label: 'Link Building' },
    { value: 'reporting', label: 'Reporting' },
    { value: 'admin', label: 'Admin' },
];

export function CreateTaskModal({
    isOpen,
    onClose,
    onCreated,
    organizationId,
    currentUserId,
    defaultClientId,
    defaultClientName,
    defaultProjectId,
}: CreateTaskModalProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [dueDate, setDueDate] = useState('');
    const [status] = useState<TaskStatus>('todo');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim()) { setError('Title is required'); return; }
        if (!organizationId) { setError('Organization not found'); return; }
        setSaving(true);
        setError('');
        const result = await createTask({
            organizationId,
            projectId: defaultProjectId,
            clientId: defaultClientId,
            title: title.trim(),
            description: description.trim() || undefined,
            priority,
            status,
            category: category as TaskCategory || undefined,
            dueDate: dueDate || undefined,
            createdBy: currentUserId,
        });
        setSaving(false);
        if (result.success && result.data) {
            onCreated({ ...result.data, clientName: defaultClientName ?? result.data.clientName });
            // Reset
            setTitle('');
            setDescription('');
            setPriority('medium');
            setCategory('');
            setDueDate('');
            onClose();
        } else {
            setError(result.error ?? 'Failed to create task');
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[130] bg-background/80 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed z-[140] inset-0 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                        <h3 className="font-bold text-foreground flex items-center gap-2">
                            <Plus className="h-4 w-4" /> New Task
                        </h3>
                        {defaultClientName && (
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">{defaultClientName}</span>
                        )}
                        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="p-5 space-y-4">
                        {/* Title */}
                        <div>
                            <input
                                autoFocus
                                type="text"
                                value={title}
                                onChange={e => setTitle(e.target.value)}
                                placeholder="Task title…"
                                className="w-full text-base font-semibold bg-transparent border-none p-0 focus:ring-0 placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="Description (optional)…"
                                rows={3}
                                className="w-full text-sm bg-muted/30 border border-border rounded-lg p-3 focus:outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground/50"
                            />
                        </div>

                        {/* Priority + Category row */}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Priority</label>
                                <select
                                    value={priority}
                                    onChange={e => setPriority(e.target.value as TaskPriority)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Category</label>
                                <select
                                    value={category}
                                    onChange={e => setCategory(e.target.value as TaskCategory)}
                                    className="w-full mt-1 p-2 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="">None</option>
                                    {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                </select>
                            </div>
                        </div>

                        {/* Due Date */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Due Date</label>
                            <input
                                type="date"
                                value={dueDate}
                                onChange={e => setDueDate(e.target.value)}
                                className="w-full mt-1 bg-muted/30 border border-border rounded-lg p-2 text-sm focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {error && <p className="text-xs text-red-500">{error}</p>}

                        {/* Actions */}
                        <div className="flex justify-end gap-3 pt-2">
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={!title.trim() || saving}
                                className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                            >
                                {saving ? 'Creating…' : 'Create Task'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </>
    );
}
