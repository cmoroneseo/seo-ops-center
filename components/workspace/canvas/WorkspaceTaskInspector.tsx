'use client';

import type { WorkCard } from '@/lib/workspace-canvas/project';
import { formatDayLabel } from '@/lib/workspace-canvas/project';

export function WorkspaceTaskInspector({
    card,
    actionClass,
    onClose,
    onOpenTask,
    onOpenPlan,
}: {
    card: WorkCard;
    actionClass: string;
    onClose: () => void;
    onOpenTask: (taskId: string) => void;
    onOpenPlan: () => void;
}) {
    return (
        <aside aria-labelledby="workspace-inspector-title" className="min-w-0 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.source === 'task' ? 'Task' : 'Plan item'}</p>
                <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Close</button>
            </div>
            <h2 id="workspace-inspector-title" className="mt-2 text-lg font-semibold leading-snug">{card.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{card.description?.trim() || 'No description'}</p>
            <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Status</dt><dd>{card.statusLabel}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Assignees</dt><dd className="text-right">{card.assigneeLabel}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Due</dt><dd>{card.dueDate ? formatDayLabel(card.dueDate) : 'No due date'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Estimate</dt><dd>{card.estimateLabel}</dd></div>
            </dl>
            {card.badges.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{card.badges.join(' · ')}</p>}
            <div className="mt-4">
                <h3 className="text-sm font-medium">Subtasks <span className="font-normal text-muted-foreground">({card.subtaskProgress})</span></h3>
                {card.subtasks.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">No subtasks</p> : (
                    <ul className="mt-2 space-y-1">
                        {card.subtasks.map(subtask => (
                            <li key={subtask.id} className="flex items-start gap-2 text-sm">
                                <span className="mt-0.5 text-xs text-muted-foreground">{subtask.completed ? 'Done' : 'Open'}</span>
                                <span>{subtask.title}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
            {card.taskId ? (
                <button type="button" onClick={() => onOpenTask(card.taskId!)} className={`mt-4 w-full rounded-lg px-3 py-2 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${actionClass}`}>Open task</button>
            ) : (
                <button type="button" onClick={onOpenPlan} className={`mt-4 w-full rounded-lg px-3 py-2 text-base font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${actionClass}`}>Open SEO Plan</button>
            )}
        </aside>
    );
}
