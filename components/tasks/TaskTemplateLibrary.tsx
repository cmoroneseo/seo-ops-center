'use client';

import { useState, useEffect } from 'react';
import { X, Plus, Edit2, Trash2, FileText, ChevronRight } from 'lucide-react';
import { TaskTemplate, TaskCategory } from '@/lib/types';
import { getTaskTemplates, deleteTaskTemplate } from '@/lib/supabase/tasks';
import { TaskTemplateModal } from './TaskTemplateModal';
import { describeRecurrence } from '@/lib/utils/recurrence';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/components/providers/organization-provider';

interface TaskTemplateLibraryProps {
    isOpen: boolean;
    onClose: () => void;
    /** Called when user clicks "Use Template" — lets parent open CreateTaskModal pre-filled */
    onUseTemplate?: (template: TaskTemplate) => void;
    currentUserId?: string;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
    content: 'Content',
    technical: 'Technical SEO',
    local: 'Local SEO',
    links: 'Link Building',
    reporting: 'Reporting',
    admin: 'Admin',
};

const CATEGORY_COLORS: Record<TaskCategory, string> = {
    content: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    technical: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    local: 'bg-green-500/10 text-green-600 border-green-500/20',
    links: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    reporting: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
    admin: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

const PRIORITY_COLOR: Record<string, string> = {
    urgent: 'text-red-500',
    high: 'text-orange-500',
    medium: 'text-blue-500',
    low: 'text-muted-foreground',
};

export function TaskTemplateLibrary({ isOpen, onClose, onUseTemplate, currentUserId }: TaskTemplateLibraryProps) {
    const { organization, memberships } = useOrganization();
    const member = memberships.find(m => m.organizationId === organization?.id);
    const [templates, setTemplates] = useState<TaskTemplate[]>([]);
    const [loading, setLoading] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState<TaskTemplate | undefined>(undefined);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && organization) {
            setLoading(true);
            getTaskTemplates(organization.id).then(data => {
                setTemplates(data);
                setLoading(false);
            });
        }
    }, [isOpen, organization?.id]);

    const handleSaved = (saved: TaskTemplate) => {
        setTemplates(prev => {
            const idx = prev.findIndex(t => t.id === saved.id);
            if (idx >= 0) return prev.map(t => t.id === saved.id ? saved : t);
            return [...prev, saved];
        });
        setEditingTemplate(undefined);
        setIsModalOpen(false);
    };

    const handleDelete = async (templateId: string) => {
        if (!confirm('Delete this template? Tasks created from it will not be affected.')) return;
        setDeletingId(templateId);
        await deleteTaskTemplate(templateId);
        setTemplates(prev => prev.filter(t => t.id !== templateId));
        setDeletingId(null);
    };

    const openCreate = () => {
        setEditingTemplate(undefined);
        setIsModalOpen(true);
    };

    const openEdit = (template: TaskTemplate) => {
        setEditingTemplate(template);
        setIsModalOpen(true);
    };

    // Group by category
    const grouped = templates.reduce<Record<string, TaskTemplate[]>>((acc, t) => {
        const key = t.category ?? 'uncategorized';
        (acc[key] = acc[key] ?? []).push(t);
        return acc;
    }, {});

    const allCategories = Object.keys(grouped).sort();

    if (!isOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-[120] bg-background/60 backdrop-blur-sm" onClick={onClose} />

            {/* Slide-over panel */}
            <div className="fixed right-0 top-0 bottom-0 z-[125] w-full max-w-md bg-card border-l border-border shadow-2xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
                    <div>
                        <h3 className="font-bold text-foreground">Task Templates</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Reusable SEO task blueprints</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={openCreate}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 transition-colors"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            New Template
                        </button>
                        <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                    {loading ? (
                        <div className="text-center text-muted-foreground text-sm py-12">Loading templates…</div>
                    ) : templates.length === 0 ? (
                        <div className="text-center py-16">
                            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                                <FileText className="h-8 w-8 text-muted-foreground/40" />
                            </div>
                            <p className="font-semibold mb-1">No templates yet</p>
                            <p className="text-sm text-muted-foreground mb-6">Create reusable task blueprints for your most common SEO work.</p>
                            <button
                                onClick={openCreate}
                                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 transition-colors"
                            >
                                Create First Template
                            </button>
                        </div>
                    ) : (
                        allCategories.map(catKey => {
                            const cat = catKey as TaskCategory;
                            const label = CATEGORY_LABELS[cat] ?? catKey.charAt(0).toUpperCase() + catKey.slice(1);
                            const colorCls = CATEGORY_COLORS[cat] ?? 'bg-muted text-muted-foreground border-border';
                            return (
                                <div key={catKey}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', colorCls)}>
                                            {label}
                                        </span>
                                        <span className="text-xs text-muted-foreground">{grouped[catKey].length}</span>
                                    </div>
                                    <div className="space-y-2">
                                        {grouped[catKey].map(template => (
                                            <div
                                                key={template.id}
                                                className="group bg-muted/20 border border-border/50 rounded-xl p-3 hover:border-border transition-colors"
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-sm truncate">{template.name}</span>
                                                            <span className={cn('text-[10px] font-bold capitalize', PRIORITY_COLOR[template.priority ?? 'medium'])}>
                                                                {template.priority}
                                                            </span>
                                                        </div>
                                                        {template.description && (
                                                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{template.description}</p>
                                                        )}
                                                        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                                                            {template.estimatedHours && (
                                                                <span>{template.estimatedHours}h est.</span>
                                                            )}
                                                            {template.checklist.length > 0 && (
                                                                <span>{template.checklist.length} steps</span>
                                                            )}
                                                            {template.recurrence && (
                                                                <span className="text-primary/70">{describeRecurrence(template.recurrence)}</span>
                                                            )}
                                                        </div>
                                                        {template.tags.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1.5">
                                                                {template.tags.map(t => (
                                                                    <span key={t} className="px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[10px]">{t}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                                        <button
                                                            onClick={() => openEdit(template)}
                                                            className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                                                            title="Edit"
                                                        >
                                                            <Edit2 className="h-3.5 w-3.5" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(template.id)}
                                                            disabled={deletingId === template.id}
                                                            className="p-1.5 hover:bg-red-500/10 rounded-lg text-muted-foreground hover:text-red-500 transition-colors"
                                                            title="Delete"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Use Template button */}
                                                {onUseTemplate && (
                                                    <button
                                                        onClick={() => { onUseTemplate(template); onClose(); }}
                                                        className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-xs font-medium transition-colors"
                                                    >
                                                        Use Template
                                                        <ChevronRight className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Template create/edit modal */}
            <TaskTemplateModal
                isOpen={isModalOpen}
                onClose={() => { setIsModalOpen(false); setEditingTemplate(undefined); }}
                onSaved={handleSaved}
                template={editingTemplate}
                currentUserId={currentUserId ?? member?.userId}
            />
        </>
    );
}
