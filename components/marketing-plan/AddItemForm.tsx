'use client';

import { useState } from 'react';
import { MarketingPlanStep, MarketingPlanItemPriority } from '@/lib/types';

interface AddItemFormProps {
    steps: MarketingPlanStep[];
    defaultStepKey?: string;
    onSubmit: (fields: {
        stepKey: string; title: string; description?: string;
        priority: MarketingPlanItemPriority;
    }) => Promise<void>;
    onCancel: () => void;
}

export function AddItemForm({ steps, defaultStepKey, onSubmit, onCancel }: AddItemFormProps) {
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [stepKey, setStepKey] = useState(defaultStepKey ?? steps[0]?.key ?? '');
    const [priority, setPriority] = useState<MarketingPlanItemPriority>('medium');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!title.trim()) return;
        setSaving(true);
        setError('');
        try { await onSubmit({ stepKey, title: title.trim(), description: description.trim() || undefined, priority }); }
        catch (e) { setError(e instanceof Error ? e.message : 'Could not save item'); }
        finally { setSaving(false); }
    };

    return (
        <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
            <input
                aria-label="Item title"
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Item title..."
                className="w-full text-sm font-semibold border border-border rounded-lg px-3 py-2 bg-card"
            />
            <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Description (optional)..."
                aria-label="Description"
                rows={2}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-card"
            />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
                <select
                    aria-label="Plan category"
                    value={stepKey}
                    onChange={e => setStepKey(e.target.value)}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                >
                    {steps.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
                </select>
                <select
                    aria-label="Priority"
                    value={priority}
                    onChange={e => setPriority(e.target.value as MarketingPlanItemPriority)}
                    className="text-xs border border-border rounded-lg px-2 py-1.5 bg-card"
                >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                </select>
                <div className="flex-1" />
                <button onClick={onCancel} className="text-xs font-medium border border-border rounded-lg px-3 py-1.5">
                    Cancel
                </button>
                <button
                    onClick={submit}
                    disabled={saving || !title.trim()}
                    className="text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    Add Item
                </button>
            </div>
        </div>
    );
}
