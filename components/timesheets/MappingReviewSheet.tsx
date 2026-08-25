'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { getClients } from '@/lib/supabase/clients';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { LedgerException } from '@/lib/timesheets/ledger';
import type { ClientProject } from '@/lib/types';

interface MappingReviewSheetProps {
    organizationId: string;
    exception: LedgerException;
    onClose: () => void;
    onMapped: () => void;
}

interface Option {
    id: string;
    label: string;
}

/**
 * Human resolution of one unmapped imported entry.
 *
 * The server refuses to guess, and so does this sheet: nothing is preselected,
 * and Save stays disabled until a manager has explicitly named both a client
 * and a person. The Basecamp source detail is shown first so the decision is
 * made against real provider context, not a row id.
 */
export function MappingReviewSheet({
    organizationId,
    exception,
    onClose,
    onMapped,
}: MappingReviewSheetProps) {
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [members, setMembers] = useState<Option[]>([]);
    const [clientId, setClientId] = useState('');
    const [userId, setUserId] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        void Promise.all([
            getClients(organizationId),
            getOrganizationMembers(organizationId),
        ]).then(([clientRows, memberRows]) => {
            if (!active) return;
            setClients(clientRows);
            setMembers(memberRows.map(row => ({
                id: row.userId,
                label: row.user.fullName || row.user.email,
            })));
        });
        return () => { active = false; };
    }, [organizationId]);

    const heading = useMemo(() => formatDayHeading(exception.date), [exception.date]);
    const canSave = Boolean(clientId && userId) && !isSaving;

    const save = async () => {
        if (!canSave) return;
        setIsSaving(true);
        setError(null);
        try {
            const response = await fetch('/api/timesheets/mapping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    timeLogId: exception.timeLogId,
                    clientId,
                    userId,
                    taskId: null,
                }),
            });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error ?? 'Unable to save mapping');
            onMapped();
            onClose();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save mapping');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="dialog" aria-modal="true" aria-label="Map imported entry">
            <div
                className="flex h-full w-full max-w-md flex-col bg-card shadow-xl"
                onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
            >
                <header className="flex items-start justify-between gap-3 border-b border-border p-5">
                    <div>
                        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
                            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
                            Map imported entry
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Assign this Basecamp entry to a client and a team member.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <X className="h-5 w-5" aria-hidden />
                    </button>
                </header>

                <div className="flex-1 space-y-5 overflow-y-auto p-5">
                    <section className="rounded-lg border border-border bg-background p-4">
                        <h3 className="text-sm font-medium text-foreground">Basecamp source</h3>
                        <dl className="mt-2 space-y-1 text-sm">
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Date</dt>
                                <dd className="text-foreground">{heading.weekday}, {heading.date}</dd>
                            </div>
                            <div className="flex justify-between">
                                <dt className="text-muted-foreground">Duration</dt>
                                <dd className="tabular-nums text-foreground">
                                    {formatDuration(exception.minutes, { zero: '0m' })}
                                </dd>
                            </div>
                            <div className="pt-1">
                                <dt className="text-muted-foreground">Description</dt>
                                <dd className="mt-1 text-foreground">
                                    {exception.description || 'No description'}
                                </dd>
                            </div>
                        </dl>
                    </section>

                    <div>
                        <label htmlFor="mapping-client" className="block text-sm font-medium text-foreground">
                            Client
                        </label>
                        <select
                            id="mapping-client"
                            value={clientId}
                            onChange={event => setClientId(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            <option value="">Select a client…</option>
                            {clients.map(client => (
                                <option key={client.id} value={client.id}>{client.clientName}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="mapping-member" className="block text-sm font-medium text-foreground">
                            Team member
                        </label>
                        <select
                            id="mapping-member"
                            value={userId}
                            onChange={event => setUserId(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                            <option value="">Select a team member…</option>
                            {members.map(member => (
                                <option key={member.id} value={member.id}>{member.label}</option>
                            ))}
                        </select>
                    </div>

                    {error && (
                        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {error}
                        </p>
                    )}
                </div>

                <footer className="flex items-center justify-end gap-3 border-t border-border p-5">
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={save}
                        disabled={!canSave}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        {isSaving ? 'Saving…' : 'Save mapping'}
                    </button>
                </footer>
            </div>
        </div>
    );
}
