'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Trash2, GripVertical } from 'lucide-react';
import { TaskTemplate, TaskPriority, TaskCategory } from '@/lib/types';
import { createTaskTemplate, updateTaskTemplate } from '@/lib/supabase/tasks';
import { RecurrenceSelector } from './RecurrenceSelector';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/providers/organization-provider';

interface TaskTemplateModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: (template: TaskTemplate) => void;
    /** Pass an existing template to edit; omit to create new */
    template?: TaskTemplate;
    currentUserId?: string;
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

type ChecklistItem = { title: string; required: boolean };

export function TaskTemplateModal({ isOpen, onClose, onSaved, template, currentUserId }: TaskTemplateModalProps) {
    const { organization } = useOrganization();
    const isEditing = !!template;

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState<TaskCategory | ''>('');
    const [priority, setPriority] = useState<TaskPriority>('medium');
    const [estimatedHours, setEstimatedHours] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
    const [checklistInput, setChecklistInput] = useState('');
    const [recurrence, setRecurrence] = useState<TaskTemplate['recurrence']>(undefined);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Populate form when editing
    useEffect(() => {
        if (isOpen) {
            setName(template?.name ?? '');
            setDescription(template?.description ?? '');
            setCategory(template?.category ?? '');
            setPriority(template?.priority ?? 'medium');
            setEstimatedHours(template?.estimatedHours?.toString() ?? '');
            setTags(template?.tags ?? []);
            setChecklist(template?.checklist ?? []);
            setRecurrence(template?.recurrence);
            setError('');
        }
    }, [isOpen, template]);

    const handleAddTag = () => {
        const t = tagInput.trim().toLowerCase();
        if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
        setTagInput('');
    };

    const handleAddChecklist = () => {
        const t = checklistInput.trim();
        if (t) setChecklist(prev => [...prev, { title: t, required: false }]);
        setChecklistInput('');
    };

    const toggleRequired = (i: number) => {
        setChecklist(prev => prev.map((item, idx) => idx === i ? { ...item, required: !item.required } : item));
    };

    const removeChecklist = (i: number) => {
        setChecklist(prev => prev.filter((_, idx) => idx !== i));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) { setError('Name is required'); return; }
        if (!organization) { setError('Organization not found'); return; }
        setSaving(true);
        setError('');

        const payload = {
            name: name.trim(),
            description: description.trim() || undefined,
            category: category as TaskCategory || undefined,
            priority,
            estimatedHours: estimatedHours ? Number(estimatedHours) : undefined,
            tags,
            checklist,
            recurrence,
        };

        let result;
        if (isEditing && template) {
            result = await updateTaskTemplate(template.id, payload);
        } else {
            result = await createTaskTemplate({ ...payload, organizationId: organization.id, createdBy: currentUserId });
        }

        setSaving(false);
        if (result.success && result.data) {
            onSaved(result.data);
            onClose();
        } else {
            setError(result.error ?? 'Failed to save template');
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 z-[130] bg-background/80 backdrop-blur-sm" onClick={onClose} />
            <div className="fixed z-[140] inset-0 flex items-center justify-center p-4">
                <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                        <h3 className="font-bold text-foreground">
                            {isEditing ? 'Edit Template' : 'New Task Template'}
                        </h3>
                        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
                        {/* Name */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Template Name *</label>
                            <input
                                autoFocus
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Monthly GA4 Report"
                                className="w-full mt-1 p-2.5 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Description */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Description</label>
                            <textarea
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                placeholder="What does this task involve?"
                                rows={2}
                                className="w-full mt-1 p-2.5 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                            />
                        </div>

                        {/* Category + Priority */}
                        <div className="grid grid-cols-2 gap-3">
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
                        </div>

                        {/* Estimated hours */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Estimated Hours</label>
                            <input
                                type="number"
                                min={0}
                                step={0.5}
                                value={estimatedHours}
                                onChange={e => setEstimatedHours(e.target.value)}
                                placeholder="e.g. 2.5"
                                className="w-full mt-1 p-2 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                        </div>

                        {/* Tags */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tags</label>
                            <div className="flex gap-2 mt-1">
                                <input
                                    type="text"
                                    value={tagInput}
                                    onChange={e => setTagInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                                    placeholder="Add tag…"
                                    className="flex-1 p-2 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button type="button" onClick={handleAddTag} className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors">
                                    Add
                                </button>
                            </div>
                            {tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2">
                                    {tags.map(t => (
                                        <span key={t} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs">
                                            {t}
                                            <button type="button" onClick={() => setTags(prev => prev.filter(x => x !== t))} className="hover:text-red-500">×</button>
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Checklist */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Checklist Items</label>
                            <div className="flex gap-2 mt-1">
                                <input
                                    type="text"
                                    value={checklistInput}
                                    onChange={e => setChecklistInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddChecklist(); } }}
                                    placeholder="Add checklist item…"
                                    className="flex-1 p-2 bg-muted/30 border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                />
                                <button type="button" onClick={handleAddChecklist} className="px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm transition-colors">
                                    Add
                                </button>
                            </div>
                            {checklist.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    {checklist.map((item, i) => (
                                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30 border border-border/50">
                                            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                                            <span className="flex-1 text-sm truncate">{item.title}</span>
                                            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={item.required}
                                                    onChange={() => toggleRequired(i)}
                                                    className="rounded"
                                                />
                                                Required
                                            </label>
                                            <button type="button" onClick={() => removeChecklist(i)} className="p-1 hover:text-red-500 text-muted-foreground transition-colors">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Recurrence */}
                        <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">Recurrence</label>
                            <RecurrenceSelector value={recurrence} onChange={setRecurrence} />
                        </div>

                        {error && <p className="text-xs text-red-500">{error}</p>}
                    </form>

                    {/* Footer */}
                    <div className="flex justify-end gap-3 px-5 py-4 border-t border-border shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!name.trim() || saving}
                            className="px-4 py-2 text-sm font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                        >
                            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Create Template'}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
