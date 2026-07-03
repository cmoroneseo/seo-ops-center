'use client';

import { useState } from 'react';
import { Sparkles, Plus, X } from 'lucide-react';
import { MarketingPlan, MarketingPlanItemPriority } from '@/lib/types';
import { addCustomItem } from '@/lib/supabase/marketing-plans';

interface Suggestion {
    stepKey: string;
    title: string;
    description: string;
    priority: MarketingPlanItemPriority;
}

interface SuggestItemsPanelProps {
    plan: MarketingPlan;
    clientName: string;
    onAdded: () => void;
    onClose: () => void;
}

export function SuggestItemsPanel({ plan, clientName, onAdded, onClose }: SuggestItemsPanelProps) {
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchSuggestions = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/marketing-plan/suggest-items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientName,
                    existingTitles: (plan.items ?? []).map(i => i.title),
                    steps: plan.steps.map(s => ({ key: s.key, name: s.name })),
                }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? 'Request failed');
            setSuggestions(json.items);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const accept = async (s: Suggestion) => {
        const maxSort = Math.max(0, ...(plan.items ?? []).map(i => i.sortOrder));
        await addCustomItem({
            marketingPlanId: plan.id,
            organizationId: plan.organizationId,
            clientId: plan.clientId,
            stepKey: s.stepKey,
            title: s.title,
            description: s.description,
            priority: s.priority,
            sortOrder: maxSort + 1,
        });
        setSuggestions(prev => (prev ?? []).filter(x => x !== s));
        onAdded();
    };

    return (
        <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 font-semibold text-sm">
                    <Sparkles className="h-4 w-4 text-primary" /> AI-Suggested Items
                </h4>
                <button onClick={onClose} className="p-1 rounded hover:bg-muted">
                    <X className="h-4 w-4" />
                </button>
            </div>
            {!suggestions && (
                <button
                    onClick={fetchSuggestions}
                    disabled={loading}
                    className="text-sm font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    {loading ? 'Thinking…' : 'Suggest Items'}
                </button>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {suggestions && suggestions.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No more suggestions — all added or dismissed.</p>
            )}
            {suggestions?.map((s, i) => {
                const step = plan.steps.find(st => st.key === s.stepKey);
                return (
                    <div key={i} className="flex items-start justify-between gap-3 border border-border/50 rounded-lg p-3">
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">{s.title}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">{s.description}</div>
                            <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">
                                {step?.name ?? s.stepKey} · {s.priority}
                            </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                            <button
                                onClick={() => accept(s)}
                                className="p-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700"
                                title="Add to plan"
                            >
                                <Plus className="h-3.5 w-3.5" />
                            </button>
                            <button
                                onClick={() => setSuggestions(prev => (prev ?? []).filter(x => x !== s))}
                                className="p-1.5 rounded-lg border border-border hover:bg-muted"
                                title="Dismiss"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
