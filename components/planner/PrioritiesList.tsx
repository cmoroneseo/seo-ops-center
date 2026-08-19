'use client';

import { useState } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerPriority, Task } from '@/lib/types';

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
                            'group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted',
                            dragId === p.id && 'opacity-50',
                        )}
                    >
                        <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
                        <span className="w-3 shrink-0 text-muted-foreground">{i + 1}</span>
                        <span className="truncate">{labelFor(p)}</span>
                        <button
                            onClick={() => onRemove(p.id)}
                            aria-label="Remove priority"
                            className="ml-auto opacity-0 group-hover:opacity-100"
                        >
                            <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
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
                    onClick={() => setAdding(true)}
                    className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <Plus className="h-3 w-3" /> Add priority
                </button>
            )}
        </div>
    );
}
