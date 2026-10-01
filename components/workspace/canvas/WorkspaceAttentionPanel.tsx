'use client';

import type { AttentionModel } from '@/lib/workspace-canvas/project';

export function WorkspaceAttentionPanel({
    model,
    onReview,
    onOpenDeliverables,
    onOpenTask,
}: {
    model: AttentionModel;
    onReview: (batchId: string) => void;
    onOpenDeliverables: () => void;
    onOpenTask: (taskId: string) => void;
}) {
    const warnings = [
        model.approvalsUnavailable ? 'Approvals could not be loaded.' : '',
        model.deliverablesUnavailable ? 'Deliverables could not be loaded.' : '',
        model.tasksUnavailable ? 'Blocked tasks could not be loaded.' : '',
    ].filter(Boolean);
    const countLabel = model.approvalDocuments == null
        ? `${model.items.length} shown`
        : `${model.items.length} item${model.items.length === 1 ? '' : 's'}`;

    return (
        <section aria-labelledby="workspace-attention-heading" className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
                <h2 id="workspace-attention-heading" className="text-sm font-medium">Needs your attention</h2>
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300" aria-label={model.approvalDocuments == null ? 'Attention count is incomplete because a source failed' : `${model.items.length} attention items, including ${model.approvalDocuments} approval documents`}>
                    {countLabel}
                </span>
            </div>
            {warnings.map(warning => <p key={warning} role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-400">{warning}</p>)}
            {model.items.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">{warnings.length ? 'Nothing verified is waiting. Failed sources are not counted as zero.' : 'Nothing is waiting on approvals, overdue deliverables, or blocked tasks.'}</p>
            ) : (
                <ul className="mt-3 space-y-2">
                    {model.items.slice(0, 5).map(item => (
                        <li key={item.id} className="rounded-lg border border-border/80 bg-background px-3 py-2">
                            <p className="text-sm font-medium leading-snug">{item.title}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                            {item.action === 'review' && item.batchId && (
                                <button type="button" onClick={() => onReview(item.batchId!)} className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Review</button>
                            )}
                            {item.action === 'deliverables' && (
                                <button type="button" onClick={onOpenDeliverables} className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">View deliverable</button>
                            )}
                            {item.action === 'task' && item.taskId && (
                                <button type="button" onClick={() => onOpenTask(item.taskId!)} className="mt-2 text-sm font-medium text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open task</button>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {model.items.length > 5 && <p className="mt-2 text-xs text-muted-foreground">{model.items.length - 5} more in the lists below and on the Approvals tab.</p>}
        </section>
    );
}
