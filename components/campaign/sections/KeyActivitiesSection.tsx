'use client';

import { useState, useEffect } from 'react';
import { Zap, Check, X, Trash2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateCampaignPlan } from '@/lib/supabase/campaign-plans';
import { SectionCard, InlineInput, InlineSelect, CustomFieldSectionProps, KeyActivityItem } from './SectionCard';

const PRIORITY_OPTIONS = [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
];

const ACTIVITY_CATEGORIES = [
    { value: 'technical_seo', label: 'Technical SEO' },
    { value: 'on_page', label: 'On-Page' },
    { value: 'content', label: 'Content' },
    { value: 'authority', label: 'Authority' },
    { value: 'local_seo', label: 'Local SEO' },
    { value: 'analytics', label: 'Analytics' },
    { value: 'cro', label: 'CRO' },
    { value: 'other', label: 'Other' },
];

const PRIORITY_COLORS: Record<string, string> = {
    high: 'bg-red-500/10 text-red-500 border-red-500/20',
    medium: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    low: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function KeyActivitiesSection({ plan, expanded, onToggle, onRefresh }: CustomFieldSectionProps) {
    const stored = (plan.customFields.keyActivities ?? {}) as { items?: KeyActivityItem[] };
    const [items, setItems] = useState<KeyActivityItem[]>(stored.items ?? []);
    const [adding, setAdding] = useState(false);
    const [editingIdx, setEditingIdx] = useState<number | null>(null);
    const [form, setForm] = useState({ title: '', description: '', priority: '', category: '' });

    useEffect(() => {
        const s = (plan.customFields.keyActivities ?? {}) as { items?: KeyActivityItem[] };
        setItems(s.items ?? []);
    }, [plan.customFields.keyActivities]);

    const saveItems = async (updated: KeyActivityItem[]) => {
        setItems(updated);
        await updateCampaignPlan(plan.id, {
            customFields: { ...plan.customFields, keyActivities: { items: updated } },
        });
        onRefresh();
    };

    const startAdd = () => {
        setForm({ title: '', description: '', priority: '', category: '' });
        setAdding(true);
    };

    const startEdit = (idx: number) => {
        const item = items[idx];
        setEditingIdx(idx);
        setForm({
            title: item.title,
            description: item.description ?? '',
            priority: item.priority ?? '',
            category: item.category ?? '',
        });
    };

    const handleAdd = async () => {
        if (!form.title.trim()) return;
        const entry: KeyActivityItem = {
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            priority: (form.priority as KeyActivityItem['priority']) || undefined,
            category: form.category || undefined,
        };
        await saveItems([...items, entry]);
        setForm({ title: '', description: '', priority: '', category: '' });
        setAdding(false);
    };

    const handleSave = async (idx: number) => {
        if (!form.title.trim()) return;
        const updated = [...items];
        updated[idx] = {
            title: form.title.trim(),
            description: form.description.trim() || undefined,
            priority: (form.priority as KeyActivityItem['priority']) || undefined,
            category: form.category || undefined,
        };
        await saveItems(updated);
        setEditingIdx(null);
    };

    const handleDelete = async (idx: number) => {
        const updated = items.filter((_, i) => i !== idx);
        await saveItems(updated);
    };

    const renderForm = (onSave: () => void, onCancel: () => void) => (
        <div className="space-y-2 p-3 rounded-lg bg-muted/20 border border-primary/30">
            <div className="flex items-center gap-2">
                <InlineInput value={form.title} onChange={v => setForm(f => ({ ...f, title: v }))} placeholder="Activity title…" className="flex-1" />
                <InlineSelect value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))} options={PRIORITY_OPTIONS} />
                <InlineSelect value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={ACTIVITY_CATEGORIES} />
            </div>
            <InlineInput value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="Description (optional)…" />
            <div className="flex justify-end gap-2">
                <button onClick={onSave} className="text-green-500 hover:text-green-400 p-1"><Check className="h-4 w-4" /></button>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
        </div>
    );

    return (
        <SectionCard
            icon={Zap} title="Key Activities" count={items.length}
            expanded={expanded} onToggle={onToggle} onAdd={startAdd}
        >
            {items.length === 0 && !adding && (
                <p className="text-sm text-muted-foreground italic">No key activities defined yet.</p>
            )}
            {items.map((item, idx) => editingIdx === idx ? (
                <div key={idx}>
                    {renderForm(() => handleSave(idx), () => setEditingIdx(null))}
                </div>
            ) : (
                <div key={idx} className="flex items-start justify-between p-3 rounded-lg bg-muted/30 border border-border/30 group cursor-pointer hover:border-border/60" onClick={() => startEdit(idx)}>
                    <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{item.title}</span>
                            {item.category && (
                                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                                    {ACTIVITY_CATEGORIES.find(c => c.value === item.category)?.label ?? item.category}
                                </span>
                            )}
                            {item.priority && (
                                <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', PRIORITY_COLORS[item.priority])}>
                                    {item.priority}
                                </span>
                            )}
                        </div>
                        {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
                    </div>
                    <div className="flex items-center gap-1">
                        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-all" />
                        <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(idx); }}
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all p-1"
                        >
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}
            {adding && renderForm(handleAdd, () => setAdding(false))}
        </SectionCard>
    );
}
