'use client';

import { useEffect, useRef, useState } from 'react';
import { MoreVertical, Plus } from 'lucide-react';

export function TaskToolbar({
    clientName,
    activeCount,
    completedCount,
    overflowImport,
    onImport,
    onCreate,
}: {
    clientName: string;
    activeCount: number;
    completedCount: number;
    overflowImport: boolean;
    onImport: () => void;
    onCreate: () => void;
}) {
    const [open, setOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const close = (event: MouseEvent) => {
            if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
                <h3 className="font-semibold text-foreground">All tasks for {clientName}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{activeCount} active · {completedCount} completed</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {overflowImport ? (
                    <div className="relative" ref={menuRef}>
                        <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            aria-label="Task actions"
                            onClick={() => setOpen(value => !value)}
                            className="rounded-lg border border-border p-2 hover:bg-muted"
                        >
                            <MoreVertical className="h-4 w-4" />
                        </button>
                        {open && (
                            <div role="menu" className="absolute right-0 z-20 mt-1 min-w-52 rounded-lg border border-border bg-card p-1 shadow-lg">
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setOpen(false); onImport(); }}
                                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                                >
                                    Import from Basecamp
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <button type="button" onClick={onImport} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">Import from Basecamp</button>
                )}
                <button
                    type="button"
                    onClick={onCreate}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground shadow-sm transition-colors hover:opacity-90"
                >
                    <Plus className="h-4 w-4" />
                    New Task
                </button>
            </div>
        </div>
    );
}
