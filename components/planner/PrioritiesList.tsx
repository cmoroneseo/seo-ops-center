'use client';

import { useState } from 'react';
import { Plus, X, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerPriority, Task } from '@/lib/types';
import { movePriorityId } from '@/lib/planner/responsive';

interface PrioritiesListProps {
    priorities: PlannerPriority[];
    tasks: Task[];
    onAdd: (label: string) => void;
    onRemove: (id: string) => void;
    onReorder: (orderedIds: string[]) => void;
}

export function PrioritiesList({ priorities, tasks, onAdd, onRemove, onReorder }: PrioritiesListProps) {
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const [dragId, setDragId] = useState<string | null>(null);

    const labelFor = (p: PlannerPriority) =>
        p.label ?? tasks.find(t => t.id === p.taskId)?.title ?? 'Untitled priority';

    const handleDrop = (targetId: string) => {
        if (!dragId || dragId === targetId) { setDragId(null); return; }
        const ids = priorities.map(p => p.id);
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) { setDragId(null); return; }
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        onReorder(ids);
        setDragId(null);
    };

    const movePriority = (id: string, direction: -1 | 1) => {
        onReorder(movePriorityId(priorities.map(priority => priority.id), id, direction));
    };

    const submit = () => {
        const trimmed = draft.trim();
        if (trimmed) onAdd(trimmed);
        setDraft('');
        setAdding(false);
    };

    return (
        <div className="border-b border-border/60 px-3 py-3">
            <div className="mb-2 text-sm font-medium">Priorities</div>

            <div className="space-y-1">
                {priorities.map((p, i) => (
                    <div
                        key={p.id}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDrop(p.id)}
                        className={cn(
                            'group flex min-h-9 items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-muted focus-within:bg-muted',
                            dragId === p.id && 'opacity-50',
                        )}
                    >
                        <GripVertical aria-hidden="true" className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" />
                        <span className="w-3 shrink-0 text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{labelFor(p)}</span>
                        <div className="ml-auto flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                            <button
                                type="button"
                                onClick={() => movePriority(p.id, -1)}
                                disabled={i === 0}
                                aria-label={`Move ${labelFor(p)} up`}
                                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
                            >
                                <ChevronUp className="h-3 w-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => movePriority(p.id, 1)}
                                disabled={i === priorities.length - 1}
                                aria-label={`Move ${labelFor(p)} down`}
                                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
                            >
                                <ChevronDown className="h-3 w-3" />
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={() => onRemove(p.id)}
                            aria-label={`Remove ${labelFor(p)} from priorities`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100 group-focus-within:opacity-100"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                ))}
            </div>

            {adding ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={submit}
                    onKeyDown={e => {
                        if (e.key === 'Enter') submit();
                        if (e.key === 'Escape') { setDraft(''); setAdding(false); }
                    }}
                    placeholder="What matters most?"
                    className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
                />
            ) : (
                <button
                    type="button"
                    onClick={() => setAdding(true)}
                    className="mt-1 flex min-h-9 items-center gap-1 rounded px-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    <Plus className="h-3 w-3" /> Add priority
                </button>
            )}
        </div>
    );
}
