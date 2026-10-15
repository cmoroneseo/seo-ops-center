'use client';

import React, { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical, Trash2 } from 'lucide-react';

export function DeleteClientDialog({
    open,
    clientName,
    busy,
    error,
    onCancel,
    onConfirm,
}: {
    open: boolean;
    clientName: string;
    busy: boolean;
    error: string | null;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    const headingId = useId();
    const cancelRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (open) cancelRef.current?.focus();
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !busy) onCancel();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [busy, open, onCancel]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget && !busy) onCancel();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={headingId}
                className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-xl"
            >
                <h2 id={headingId} className="text-lg font-semibold">Delete {clientName}?</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                    This archives {clientName} and removes it from the active client list. Related tasks, time, and other records stay on the archived client. They are not wiped.
                </p>
                {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                    <button
                        ref={cancelRef}
                        type="button"
                        onClick={onCancel}
                        disabled={busy}
                        className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={busy}
                        className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
                    >
                        {busy ? 'Deleting…' : 'Delete client'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ClientActionsMenu({
    clientId,
    clientName,
    canDelete,
    onDeleted,
    defaultOpen = false,
}: {
    clientId: string;
    clientName: string;
    canDelete: boolean;
    onDeleted: (clientName: string) => void;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);
    const [confirming, setConfirming] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onPointer = (event: MouseEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    async function confirmDelete() {
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(`/api/clients/${clientId}`, { method: 'DELETE' });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
                setError(typeof body.error === 'string' ? body.error : 'Could not delete this client');
                setBusy(false);
                return;
            }
            const name = typeof body.clientName === 'string' && body.clientName.trim() ? body.clientName : clientName;
            onDeleted(name);
        } catch {
            setError('Could not delete this client');
            setBusy(false);
        }
    }

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                className="rounded-full p-2 transition-colors hover:bg-muted"
                aria-label="Client actions"
                aria-haspopup={canDelete ? 'menu' : undefined}
                aria-expanded={canDelete ? open : undefined}
                onClick={() => {
                    if (canDelete) setOpen((value) => !value);
                }}
            >
                <MoreVertical className="h-5 w-5 text-muted-foreground" />
            </button>
            {open && canDelete && (
                <div
                    role="menu"
                    aria-label="Client actions"
                    className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-border bg-card p-1.5 shadow-xl"
                >
                    <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
                        onClick={() => {
                            setOpen(false);
                            setError(null);
                            setConfirming(true);
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete client
                    </button>
                </div>
            )}
            <DeleteClientDialog
                open={confirming}
                clientName={clientName}
                busy={busy}
                error={error}
                onCancel={() => {
                    if (!busy) setConfirming(false);
                }}
                onConfirm={() => { void confirmDelete(); }}
            />
        </div>
    );
}
