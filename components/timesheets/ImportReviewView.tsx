'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { getClients } from '@/lib/supabase/clients';
import {
    createLatestRequestSequencer,
    planBulkClientEdits,
    settleOperations,
    type ImportEntryEdit,
} from '@/lib/timesheets/import-review-ui';
import type { QueueRow } from '@/lib/timesheets/import-queue-route';
import type { ClientProject } from '@/lib/types';
import { ReconciliationPanel } from './ReconciliationPanel';
import { BackfillControl, type BackfillMember } from './BackfillControl';
import { ImportRow } from './ImportRow';

interface ImportReviewViewProps {
    organizationId: string;
    backfillMembers?: BackfillMember[];
}

export interface QueuePayload {
    isManager: boolean;
    rows: QueueRow[];
    summary: { total: number; ready: number; blocked: number; pendingReview: number };
}

interface ImportReviewQueueProps {
    organizationId: string;
    payload: QueuePayload;
    clients: ClientProject[];
    selected: Set<string>;
    isBusy: boolean;
    error: string | null;
    notice?: string | null;
    backfillMembers: BackfillMember[];
    refreshVersion?: number;
    onReload: () => Promise<void>;
    onBackfillRunningChange?: (running: boolean) => void;
    onToggle: (id: string) => void;
    onClearSelection: () => void;
    onEdit: (id: string, edit: ImportEntryEdit) => void;
    onBulkClient: (clientId: string) => void;
    onApprove: (ids: string[]) => void;
    onBounce: (id: string, note: string) => void;
    onSubmit: (ids: string[]) => void;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
    try {
        return await response.json() as Record<string, unknown>;
    } catch {
        return {};
    }
}

/** Pure queue body, separated so role visibility and empty states are testable. */
export function ImportReviewQueue({
    organizationId,
    payload,
    clients,
    selected,
    isBusy,
    error,
    notice,
    backfillMembers,
    refreshVersion = 0,
    onReload,
    onBackfillRunningChange,
    onToggle,
    onClearSelection,
    onEdit,
    onBulkClient,
    onApprove,
    onBounce,
    onSubmit,
}: ImportReviewQueueProps) {
    const rows = payload.rows;
    const needsContext = rows.filter(row => row.importStatus === 'needs_context');
    const pending = rows.filter(row => row.importStatus === 'pending_review');
    const ready = needsContext.filter(row => row.isReady);
    const bulkClientPlan = planBulkClientEdits(rows, selected, null);
    const canBulkSetClient = bulkClientPlan.missingCount === 0
        && bulkClientPlan.invalidActivityCount === 0
        && bulkClientPlan.affectedCount > 0;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {payload.isManager && (
                <ReconciliationPanel organizationId={organizationId} members={backfillMembers} />
            )}

            {payload.isManager && (
                <BackfillControl
                    organizationId={organizationId}
                    members={backfillMembers}
                    disabled={isBusy}
                    onImported={onReload}
                    onRunningChange={onBackfillRunningChange}
                />
            )}

            {error && (
                <p
                    role="alert"
                    className="mx-6 mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                    {error}
                </p>
            )}

            {notice && (
                <p
                    role="status"
                    className="mx-6 mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
                >
                    {notice}
                </p>
            )}

            {rows.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-10">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
                        Nothing waiting for review.
                    </p>
                </div>
            ) : (
                <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                        {selected.size > 0 && (
                            <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-card p-3 shadow-sm">
                                <span className="text-sm text-foreground">{selected.size} selected</span>
                                <select
                                    aria-label="Set client for selected entries"
                                    value=""
                                    disabled={isBusy || !canBulkSetClient}
                                    onChange={event => {
                                        if (event.target.value) onBulkClient(event.target.value);
                                    }}
                                    className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                    <option value="">Set client…</option>
                                    {clients.map(client => (
                                        <option key={client.id} value={client.id}>{client.clientName}</option>
                                    ))}
                                </select>
                                <span className="text-xs text-muted-foreground">
                                    {bulkClientPlan.affectedCount} will be updated
                                    {bulkClientPlan.excludedInternalCount > 0
                                        ? `; ${bulkClientPlan.excludedInternalCount} internal excluded`
                                        : ''}
                                </span>
                                {bulkClientPlan.invalidActivityCount > 0 && (
                                    <span className="text-xs text-amber-500">
                                        Choose an activity for each selected client entry first.
                                    </span>
                                )}
                                {bulkClientPlan.missingCount > 0 && (
                                    <span className="text-xs text-destructive">
                                        Refresh this selection before applying a bulk change.
                                    </span>
                                )}
                                <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={onClearSelection}
                                    className="rounded text-sm text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                    Clear
                                </button>
                            </div>
                        )}

                        <ul className="space-y-2">
                            {rows.map(row => (
                                <ImportRow
                                    key={`${row.id}:${refreshVersion}`}
                                    row={row}
                                    clients={clients}
                                    organizationId={organizationId}
                                    isSelected={selected.has(row.id)}
                                    isManager={payload.isManager}
                                    isBusy={isBusy}
                                    onToggleSelect={() => onToggle(row.id)}
                                    onEdit={edit => onEdit(row.id, edit)}
                                    onApprove={() => onApprove([row.id])}
                                    onBounce={note => onBounce(row.id, note)}
                                />
                            ))}
                        </ul>
                    </div>

                    <footer className="flex flex-wrap items-center gap-4 border-t border-border px-6 py-4">
                        <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4" aria-hidden />
                            {ready.length} of {needsContext.length} ready
                            {payload.summary.blocked > 0 && (
                                <span className="flex items-center gap-1 text-amber-500">
                                    <AlertTriangle className="h-4 w-4" aria-hidden />
                                    {payload.summary.blocked} need attention
                                </span>
                            )}
                        </span>

                        <div className="ml-auto flex flex-wrap gap-3">
                            {payload.isManager && pending.length > 0 && (
                                <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => onApprove(pending.map(row => row.id))}
                                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                                >
                                    Approve all {pending.length} submitted
                                </button>
                            )}
                            <button
                                type="button"
                                disabled={isBusy || ready.length === 0}
                                onClick={() => onSubmit(ready.map(row => row.id))}
                                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                                Submit {ready.length} for review
                            </button>
                        </div>
                    </footer>
                </>
            )}
        </div>
    );
}

/** Members add context; managers also receive server-authorized review tools. */
export function ImportReviewView({
    organizationId,
    backfillMembers = [],
}: ImportReviewViewProps) {
    const [payload, setPayload] = useState<QueuePayload | null>(null);
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [activeOperations, setActiveOperations] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshVersion, setRefreshVersion] = useState(0);
    const queueSequencer = useRef(createLatestRequestSequencer<QueuePayload>());
    const isBusy = activeOperations > 0;

    const beginOperation = useCallback(() => {
        setActiveOperations(count => count + 1);
    }, []);

    const endOperation = useCallback(() => {
        setActiveOperations(count => Math.max(0, count - 1));
    }, []);

    const requestQueue = useCallback(async (signal?: AbortSignal) => {
        const response = await fetch(
            `/api/timesheets/imports?${new URLSearchParams({ organizationId })}`,
            { signal },
        );
        const body = await responseBody(response);
        if (!response.ok) {
            throw new Error(typeof body.error === 'string'
                ? body.error
                : 'Unable to load the import queue');
        }
        return body as unknown as QueuePayload;
    }, [organizationId]);

    const reloadQueue = useCallback(async (signal?: AbortSignal) => {
        await queueSequencer.current.run(
            () => requestQueue(signal),
            nextPayload => {
                setPayload(nextPayload);
                setRefreshVersion(version => version + 1);
            },
        );
    }, [requestQueue]);

    useEffect(() => {
        if (!organizationId) return;
        let active = true;
        const controller = new AbortController();
        const sequencer = queueSequencer.current;
        setPayload(null);
        setClients([]);
        setSelected(new Set());
        setIsLoading(true);
        setError(null);
        setNotice(null);

        void Promise.all([
            reloadQueue(controller.signal),
            getClients(organizationId),
        ])
            .then(([, nextClients]) => {
                if (!active) return;
                setClients(nextClients);
            })
            .catch(loadError => {
                if (!active || (loadError instanceof Error && loadError.name === 'AbortError')) return;
                setError(loadError instanceof Error
                    ? loadError.message
                    : 'Unable to load the import queue');
            })
            .finally(() => { if (active) setIsLoading(false); });

        return () => {
            active = false;
            sequencer.invalidate();
            controller.abort();
        };
    }, [organizationId, reloadQueue]);

    const sendMutation = useCallback(async (
        action: 'edit' | 'submit' | 'approve' | 'bounce',
        ids: string[],
        extra: Record<string, unknown> = {},
    ) => {
        const response = await fetch('/api/timesheets/imports/entries', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ organizationId, action, ids, ...extra }),
        });
        const body = await responseBody(response);
        if (!response.ok) {
            throw new Error(typeof body.error === 'string' ? body.error : 'Unable to save');
        }
    }, [organizationId]);

    const runMutation = useCallback(async (operation: () => Promise<void>) => {
        beginOperation();
        setError(null);
        setNotice(null);
        try {
            await operation();
            setSelected(new Set());
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save');
        } finally {
            try {
                await reloadQueue();
            } catch (reloadError) {
                // If the authoritative read is unavailable, discard row-local
                // optimistic drafts and fall back to the last server payload.
                setRefreshVersion(version => version + 1);
                setError(current => current ?? (reloadError instanceof Error
                    ? reloadError.message
                    : 'Unable to reload the import queue'));
            }
            endOperation();
        }
    }, [beginOperation, endOperation, reloadQueue]);

    const mutate = useCallback((
        action: 'edit' | 'submit' | 'approve' | 'bounce',
        ids: string[],
        extra: Record<string, unknown> = {},
    ) => {
        void runMutation(() => sendMutation(action, ids, extra));
    }, [runMutation, sendMutation]);

    const toggle = useCallback((id: string) => {
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const bulkSetClient = useCallback((clientId: string) => {
        const plan = planBulkClientEdits(payload?.rows ?? [], selected, clientId);

        void runMutation(async () => {
            if (plan.missingCount > 0) {
                throw new Error('Refresh this selection before setting a client');
            }
            if (plan.invalidActivityCount > 0) {
                throw new Error('Choose an activity for each selected client entry before setting a client');
            }
            if (plan.affectedCount === 0) {
                throw new Error('No selected client entries can be updated');
            }

            const summary = await settleOperations(plan.edits.map(({ id, edit }) => (
                () => sendMutation('edit', [id], { edit })
            )));
            const exclusion = plan.excludedInternalCount > 0
                ? ` ${plan.excludedInternalCount} internal excluded.`
                : '';

            if (summary.failedCount > 0) {
                setNotice(
                    `Updated ${summary.succeededCount} of ${plan.affectedCount} client entries.${exclusion}`,
                );
                const messages = summary.errors.map(item => item.message).join('; ');
                throw new Error(
                    `${summary.failedCount} client ${summary.failedCount === 1 ? 'update' : 'updates'} failed${messages ? `: ${messages}` : ''}`,
                );
            }

            setNotice(
                `Updated ${plan.affectedCount} client ${plan.affectedCount === 1 ? 'entry' : 'entries'}.${exclusion}`,
            );
        });
    }, [payload?.rows, runMutation, selected, sendMutation]);

    const reloadWithError = useCallback(async () => {
        setError(null);
        try {
            await reloadQueue();
        } catch (loadError) {
            const message = loadError instanceof Error
                ? loadError.message
                : 'Unable to load the import queue';
            setError(message);
            throw loadError;
        }
    }, [reloadQueue]);

    const handleBackfillRunningChange = useCallback((running: boolean) => {
        if (running) beginOperation();
        else endOperation();
    }, [beginOperation, endOperation]);

    const retryLoad = useCallback(() => {
        setIsLoading(true);
        setError(null);
        setNotice(null);
        void Promise.all([reloadQueue(), getClients(organizationId)])
            .then(([, nextClients]) => setClients(nextClients))
            .catch(loadError => setError(loadError instanceof Error
                ? loadError.message
                : 'Unable to load the import queue'))
            .finally(() => setIsLoading(false));
    }, [organizationId, reloadQueue]);

    if (!payload) {
        return (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
                <p role={error ? 'alert' : undefined} className={error ? 'text-destructive' : undefined}>
                    {error ?? 'Loading import queue…'}
                </p>
                {error && (
                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={retryLoad}
                        className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Try again
                    </button>
                )}
            </div>
        );
    }

    return (
        <ImportReviewQueue
            organizationId={organizationId}
            payload={payload}
            clients={clients}
            selected={selected}
            isBusy={isBusy}
            error={error}
            notice={notice}
            backfillMembers={backfillMembers}
            refreshVersion={refreshVersion}
            onReload={reloadWithError}
            onBackfillRunningChange={handleBackfillRunningChange}
            onToggle={toggle}
            onClearSelection={() => setSelected(new Set())}
            onEdit={(id, edit) => mutate('edit', [id], { edit })}
            onBulkClient={bulkSetClient}
            onApprove={ids => mutate('approve', ids)}
            onBounce={(id, note) => mutate('bounce', [id], { note })}
            onSubmit={ids => mutate('submit', ids)}
        />
    );
}
