'use client';

import { useState } from 'react';
import { AlertTriangle, FileCheck2, OctagonAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { AttentionItem, AttentionModel } from '@/lib/workspace-canvas/project';

const labels = { approval: 'Approval needed', blocked: 'Blocked', deliverable: 'Overdue' };
const icons = { approval: FileCheck2, blocked: OctagonAlert, deliverable: AlertTriangle };

export function WorkspaceAttentionPanel({ model, onReview, onOpenDeliverables, onOpenTask }: {
    model: AttentionModel;
    onReview: (batchId: string) => void;
    onOpenDeliverables: (deliverableId?: string) => void;
    onOpenTask: (taskId: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const warnings = [
        model.approvalsUnavailable ? 'Approvals could not be loaded.' : '',
        model.deliverablesUnavailable ? 'Deliverables could not be loaded.' : '',
        model.tasksUnavailable ? 'Blocked tasks could not be loaded.' : '',
    ].filter(Boolean);
    const current = model.items.filter(item => !item.older);
    const older = model.items.filter(item => item.older);
    const act = (item: AttentionItem) => {
        setExpanded(false);
        if (item.action === 'review' && item.batchId) onReview(item.batchId);
        else if (item.action === 'task' && item.taskId) onOpenTask(item.taskId);
        else if (item.action === 'deliverables' && item.deliverableId) onOpenDeliverables(item.deliverableId);
    };
    const renderItems = (items: AttentionItem[]) => <ul className="space-y-2">{items.map(item => {
        const Icon = icons[item.kind];
        return <li key={item.id} className="rounded-lg border border-border/80 bg-background px-3 py-3">
            <div className={`mb-2 flex items-center gap-1.5 text-xs font-medium ${item.kind === 'blocked' ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                <Icon aria-hidden="true" className="h-3.5 w-3.5" />{labels[item.kind]}
            </div>
            <p className="text-sm font-medium leading-snug">{item.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
            <button type="button" onClick={() => act(item)} aria-label={`${item.action === 'review' ? 'Review approval' : item.action === 'task' ? 'Open task' : 'View deliverable'}: ${item.title}`} className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {item.action === 'review' ? 'Review' : item.action === 'task' ? 'Open task' : 'View deliverable'}
            </button>
        </li>;
    })}</ul>;
    return <>
        <section aria-labelledby="workspace-attention-heading" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
                <h2 id="workspace-attention-heading" className="text-sm font-medium">Needs your attention</h2>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300" aria-label={warnings.length ? 'Attention count is incomplete because a source failed' : `${current.length} current attention items`}>
                    {current.length === 0 && !warnings.length ? 'No recent items' : `${current.length}${warnings.length ? '+' : ''} current`}
                </span>
            </div>
            {warnings.map(warning => <p key={warning} role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{warning}</p>)}
            <div className="mt-3">{current.length ? renderItems(current.slice(0, 3)) : <p className="text-sm text-muted-foreground">{warnings.length ? 'No current items from the available sources.' : 'No current approvals, blocked work, or overdue deliverables.'}</p>}</div>
            {older.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{older.length} older overdue item{older.length === 1 ? '' : 's'}</p>}
            {(current.length > 3 || older.length > 0) && <button type="button" onClick={() => setExpanded(true)} className="mt-3 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View all ({model.items.length})</button>}
        </section>
        <Dialog open={expanded} onOpenChange={setExpanded}>
            <DialogContent className="sm:max-w-xl">
                <DialogTitle>Needs your attention</DialogTitle>
                <DialogDescription>Approvals and blocked work appear first. Older overdue deliverables remain available below.</DialogDescription>
                {warnings.map(warning => <p key={warning} role="status" className="text-xs text-amber-700 dark:text-amber-400">{warning}</p>)}
                <div className="max-h-[65dvh] space-y-5 overflow-y-auto pr-1">
                    {current.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Current ({current.length})</h3>{renderItems(current)}</div>}
                    {older.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Older overdue work ({older.length})</h3><p className="mb-3 text-xs text-muted-foreground">Due more than 30 days ago.</p>{renderItems(older)}</div>}
                </div>
            </DialogContent>
        </Dialog>
    </>;
}
