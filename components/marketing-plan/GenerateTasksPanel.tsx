'use client';

import { useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import { MarketingPlanItem } from '@/lib/types';

interface GenerateTasksPanelProps {
    scopeLabel: string;
    items: MarketingPlanItem[];
    creating: boolean;
    error?: string | null;
    onConfirm: (items: MarketingPlanItem[]) => void;
    onClose: () => void;
}

export function GenerateTasksPanel({
    scopeLabel, items, creating, error, onConfirm, onClose,
}: GenerateTasksPanelProps) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(items.map(item => item.id)));
    const chosen = items.filter(item => selected.has(item.id));

    const toggle = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    return (
        <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3 print:hidden">
            <div className="flex items-center justify-between gap-3">
                <h4 className="flex items-center gap-2 font-semibold text-sm">
                    <ListChecks className="h-4 w-4 text-primary" />
                    Create tasks — {scopeLabel}
                </h4>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted" aria-label="Close">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <p className="text-xs text-muted-foreground">
                Copies title, description, priority, assignee, and due date onto a real task.
                Done, ignored, and already-linked items are not included.
            </p>
            <ul className="max-h-64 overflow-y-auto divide-y divide-border/40">
                {items.map(item => (
                    <li key={item.id}>
                        <label className="flex items-start gap-2 py-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={selected.has(item.id)}
                                onChange={() => toggle(item.id)}
                                disabled={creating}
                                className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                            />
                            <span>
                                <span className="font-medium">{item.title}</span>
                                {item.priority === 'high' && (
                                    <span className="ml-2 text-[10px] font-semibold uppercase text-red-600">High</span>
                                )}
                            </span>
                        </label>
                    </li>
                ))}
            </ul>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center justify-end gap-2">
                <button
                    onClick={onClose}
                    disabled={creating}
                    className="text-sm font-medium border border-border rounded-lg px-3 py-1.5 hover:bg-muted disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    onClick={() => onConfirm(chosen)}
                    disabled={creating || chosen.length === 0}
                    className="text-sm font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    {creating ? 'Creating…' : `Create ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}
                </button>
            </div>
        </div>
    );
}
