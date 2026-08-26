'use client';

import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface BackfillMember {
    userId: string;
    label: string;
    hasBasecampPerson: boolean;
}

interface BackfillControlProps {
    organizationId: string;
    members: BackfillMember[];
    onImported: () => void | Promise<void>;
}

interface RunStatus {
    kind: 'success' | 'error';
    message: string;
}

/** Manager-only historical import. The server rechecks every permission. */
export function BackfillControl({ organizationId, members, onImported }: BackfillControlProps) {
    const availableMembers = members.filter(member => member.hasBasecampPerson);
    const [userId, setUserId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [status, setStatus] = useState<RunStatus | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const hasInvalidRange = Boolean(from && to && from > to);

    const run = async () => {
        setIsRunning(true);
        setStatus(null);
        try {
            const response = await fetch('/api/timesheets/import/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, userId, from, to }),
            });
            const body = await response.json() as Record<string, unknown>;
            if (!response.ok) {
                throw new Error(typeof body.error === 'string' ? body.error : 'Import failed');
            }
            setStatus({
                kind: 'success',
                message: `Scanned ${body.scanned ?? 0}, imported ${body.imported ?? 0}, skipped ${body.skipped ?? 0}.`,
            });
            await onImported();
        } catch (runError) {
            setStatus({
                kind: 'error',
                message: runError instanceof Error ? runError.message : 'Import failed',
            });
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <section aria-label="Import Basecamp history" className="border-b border-border bg-card/40 px-6 py-4">
            <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm text-foreground">
                    <span className="block text-xs text-muted-foreground">Member</span>
                    <select
                        value={userId}
                        disabled={isRunning || availableMembers.length === 0}
                        onChange={event => setUserId(event.target.value)}
                        className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <option value="">Choose…</option>
                        {availableMembers.map(member => (
                            <option key={member.userId} value={member.userId}>{member.label}</option>
                        ))}
                    </select>
                </label>

                <label className="text-sm text-foreground">
                    <span className="block text-xs text-muted-foreground">From</span>
                    <input
                        type="date"
                        value={from}
                        disabled={isRunning}
                        onChange={event => setFrom(event.target.value)}
                        className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                </label>

                <label className="text-sm text-foreground">
                    <span className="block text-xs text-muted-foreground">To</span>
                    <input
                        type="date"
                        value={to}
                        disabled={isRunning}
                        onChange={event => setTo(event.target.value)}
                        className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    />
                </label>

                <button
                    type="button"
                    disabled={isRunning || !userId || !from || !to || hasInvalidRange}
                    onClick={() => { void run(); }}
                    className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                    <Download className="h-4 w-4" aria-hidden />
                    {isRunning ? 'Importing…' : 'Import from Basecamp'}
                </button>

                {status && (
                    <span
                        role={status.kind === 'error' ? 'alert' : 'status'}
                        className={cn(
                            'text-sm',
                            status.kind === 'error' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                    >
                        {status.message}
                    </span>
                )}
            </div>

            {availableMembers.length === 0 && (
                <p className="mt-2 text-xs text-amber-500">
                    Link a member to Basecamp in Settings before importing history.
                </p>
            )}
            {hasInvalidRange && (
                <p role="alert" className="mt-2 text-xs text-amber-500">
                    The start date must be on or before the end date.
                </p>
            )}
        </section>
    );
}
