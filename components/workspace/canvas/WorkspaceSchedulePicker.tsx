'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatDayLabel, type WorkCard } from '@/lib/workspace-canvas/project';

export function WorkspaceSchedulePicker({ date, cards, saving, unavailable, error, onClose, onSchedule, onEdit }: {
    date: string;
    cards: WorkCard[];
    saving: boolean;
    unavailable: boolean;
    error: string | null;
    onClose: () => void;
    onSchedule: (cardId: string, date: string) => Promise<boolean>;
    onEdit: (cardId: string) => void;
}) {
    const [dueDate, setDueDate] = useState(date);
    const [query, setQuery] = useState('');
    const candidates = cards.filter(card => card.taskId && !['Done', 'Approved'].includes(card.statusLabel) && card.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(!!a.dueDate) - Number(!!b.dueDate) || a.title.localeCompare(b.title));
    return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
        <DialogContent className="sm:max-w-xl">
            <DialogTitle>Schedule existing task</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">Choose a task and set its due date. Existing start dates are preserved.</DialogDescription>
            <label htmlFor="schedule-existing-date" className="text-sm font-medium">Due date</label>
            <input id="schedule-existing-date" type="date" value={dueDate} disabled={saving} onChange={event => setDueDate(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
            <input aria-label="Search existing client tasks" placeholder="Search client tasks…" value={query} disabled={saving} onChange={event => setQuery(event.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" />
            {unavailable && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Some tasks could not be loaded. This list may be incomplete.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {saving && <p role="status" className="text-sm text-muted-foreground">Saving schedule…</p>}
            <div className="max-h-[45dvh] space-y-2 overflow-y-auto">
                {candidates.length === 0 && <p className="py-6 text-sm text-muted-foreground">{query ? 'No matching tasks.' : unavailable ? 'No tasks available from the loaded sources.' : 'No open tasks to schedule.'}</p>}
                {candidates.map(card => <div key={card.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <button type="button" disabled={saving} onClick={() => onEdit(card.id)} className="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring"><span className="block text-sm font-medium">{card.title}</span><span className="mt-1 block text-xs text-muted-foreground">{card.assigneeLabel} · {card.dueDate ? `Due ${formatDayLabel(card.dueDate)}` : 'Unscheduled'}</span></button>
                    <button type="button" disabled={saving || !dueDate} onClick={async () => { if (await onSchedule(card.id, dueDate)) onClose(); }} aria-label={`Schedule ${card.title}`} className="shrink-0 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">Schedule</button>
                </div>)}
            </div>
        </DialogContent>
    </Dialog>;
}
