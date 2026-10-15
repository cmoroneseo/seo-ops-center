'use client';

import { useState } from 'react';
import { ListTree, X } from 'lucide-react';
import { MarketingPlanItem } from '@/lib/types';
import {
    defaultNestSelection,
    defaultPillarTitle,
    PILLAR_NEST_NOTE,
    SEO_SETUP_PILLAR_TITLE,
} from '@/lib/tasks/pillars';

interface NestUnderPillarPanelProps {
    scopeLabel: string;
    items: MarketingPlanItem[];
    creating: boolean;
    error?: string | null;
    onConfirm: (items: MarketingPlanItem[], pillar: { title: string }) => void;
    onClose: () => void;
}

export function NestUnderPillarPanel({
    scopeLabel, items, creating, error, onConfirm, onClose,
}: NestUnderPillarPanelProps) {
    const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultNestSelection(items)));
    const [pillarTitle, setPillarTitle] = useState(() => defaultPillarTitle(items, SEO_SETUP_PILLAR_TITLE));
    const chosen = items.filter(item => selected.has(item.id));
    const title = pillarTitle.trim();
    const linkedToBasecamp = chosen.filter(item => item.linkedTask?.basecampTodoId != null).length;

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
                    <ListTree className="h-4 w-4 text-primary" />
                    Nest under pillar — {scopeLabel}
                </h4>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted" aria-label="Close">
                    <X className="h-4 w-4" />
                </button>
            </div>
            <p className="text-xs text-muted-foreground">{PILLAR_NEST_NOTE}</p>
            {items.length < 2 ? (
                <p className="text-sm text-muted-foreground">
                    Link at least two checklist items to tasks before nesting them.
                </p>
            ) : (
                <label className="block text-xs text-muted-foreground">
                    Pillar name
                    <input
                        value={pillarTitle}
                        onChange={event => setPillarTitle(event.target.value)}
                        disabled={creating}
                        maxLength={200}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground"
                    />
                </label>
            )}
            {linkedToBasecamp > 0 && (
                <p className="text-xs text-muted-foreground">
                    {linkedToBasecamp} selected {linkedToBasecamp === 1 ? 'task keeps its' : 'tasks keep their'} existing Basecamp to-do.
                </p>
            )}
            <ul className="max-h-64 overflow-y-auto divide-y divide-border/40">
                {items.map(item => (
                    <li key={item.id}>
                        <label className="flex items-start gap-2 py-2 text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                aria-label={`Nest ${item.title}`}
                                checked={selected.has(item.id)}
                                onChange={() => toggle(item.id)}
                                disabled={creating}
                                className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                            />
                            <span>
                                <span className="font-medium">{item.title}</span>
                                <span className="mt-0.5 block text-xs text-muted-foreground">Shared with Tasks</span>
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
                    onClick={() => onConfirm(chosen, { title })}
                    disabled={creating || chosen.length < 2 || !title}
                    className="text-sm font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                    {creating
                        ? 'Nesting…'
                        : title === SEO_SETUP_PILLAR_TITLE
                            ? `Group ${chosen.length} under SEO Setup`
                            : `Nest ${chosen.length} tasks`}
                </button>
            </div>
        </div>
    );
}
