'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/types';

/**
 * The "@@" task picker.
 *
 * Anchored to the field it was typed in, keyboard-first, and never a dead end —
 * when nothing matches it offers to create what you typed instead.
 */

const MAX_ROWS = 6;

export interface TaskMentionPickerProps {
    tasks: Task[];
    query: string;
    /** Narrows to one client when the form already has one chosen. */
    clientId?: string;
    highlight: number;
    onHighlightChange: (index: number) => void;
    onPick: (task: Task) => void;
    /** Offered when nothing matches. Omit to hide the escape hatch. */
    onCreateInstead?: (title: string) => void;
    heading: string;
    hint: string;
}

/** Shared so the parent's key handler and the list agree on what is selectable. */
export function matchTasks(tasks: Task[], query: string, clientId?: string): Task[] {
    const q = query.trim().toLowerCase();
    return tasks
        .filter(t => t.status !== 'done')
        .filter(t => !clientId || t.clientId === clientId)
        .filter(t => !q || t.title.toLowerCase().includes(q))
        .slice(0, MAX_ROWS);
}

export function TaskMentionPicker({
    tasks, query, clientId, highlight, onHighlightChange, onPick, onCreateInstead, heading, hint,
}: TaskMentionPickerProps) {
    const matches = useMemo(() => matchTasks(tasks, query, clientId), [tasks, query, clientId]);
    const [mounted, setMounted] = useState(false);

    // Materialise from the field rather than appearing fully formed.
    useEffect(() => {
        const id = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(id);
    }, []);

    const trimmed = query.trim();
    const showCreate = Boolean(onCreateInstead && trimmed && matches.length === 0);

    return (
        <div
            className={cn(
                'absolute inset-x-0 top-full z-20 mt-1 origin-top overflow-hidden rounded-xl border border-border',
                'bg-popover/95 shadow-xl backdrop-blur-xl',
                'transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-opacity',
                mounted ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-0',
            )}
        >
            <div className="border-b border-border/70 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {heading}
            </div>

            {matches.length === 0 && !showCreate && (
                <div className="px-2.5 py-3 text-xs text-muted-foreground">
                    {tasks.length === 0 ? 'No open work found.' : 'Nothing matches that.'}
                </div>
            )}

            {matches.map((t, i) => (
                <button
                    key={t.id}
                    // Highlight follows the press, not the release.
                    onPointerDown={() => onHighlightChange(i)}
                    onMouseEnter={() => onHighlightChange(i)}
                    onClick={() => onPick(t)}
                    className={cn(
                        'block w-full px-2.5 py-1.5 text-left transition-colors',
                        i === highlight && 'bg-muted',
                    )}
                >
                    <span className="block truncate text-xs font-medium">{t.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                        {[
                            t.clientName,
                            t.status.replace('_', ' '),
                            t.startDate ? 'already scheduled' : null,
                        ].filter(Boolean).join(' · ')}
                    </span>
                </button>
            ))}

            {showCreate && (
                <button
                    onClick={() => onCreateInstead?.(trimmed)}
                    className="block w-full px-2.5 py-2 text-left text-xs hover:bg-muted"
                >
                    Create <span className="font-medium">&ldquo;{trimmed}&rdquo;</span> instead
                </button>
            )}

            <div className="border-t border-border/70 px-2.5 py-1.5 text-[10px] text-muted-foreground">
                {hint}
            </div>
        </div>
    );
}
