'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    ArrowLeft, Check, Copy, ExternalLink, FileText, Loader2, Lock,
    Plus, Send, Unlock, Upload,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { countWords, type TiptapNode } from '@/lib/approvals/gdocs-to-tiptap';
import { rollUpBatch } from '@/lib/approvals/batch-status';
import {
    createBatch, listBatchesForClient, listDocsForBatch, publishVersion, setReviewLock,
} from '@/lib/supabase/content-approvals';
import { getDeliverables } from '@/lib/supabase/deliverables';
import type { ContentApprovalBatch, ContentApprovalDoc, Deliverable } from '@/lib/types';

interface Props {
    clientId: string;
    organizationId: string;
}

export function ClientApprovalsTab({ clientId, organizationId }: Props) {
    const [batches, setBatches] = useState<ContentApprovalBatch[]>([]);
    const [openBatch, setOpenBatch] = useState<ContentApprovalBatch | null>(null);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setBatches(await listBatchesForClient(clientId));
        setLoading(false);
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading approvals…
        </div>;
    }

    if (openBatch) {
        return <BatchDetail
            batch={openBatch}
            clientId={clientId}
            organizationId={organizationId}
            onBack={() => { setOpenBatch(null); void load(); }}
        />;
    }

    return <BatchList
        batches={batches}
        clientId={clientId}
        organizationId={organizationId}
        onOpen={setOpenBatch}
        onCreated={load}
    />;
}

// ─── Batch list ─────────────────────────────────────────────────────────────

function BatchList({ batches, clientId, organizationId, onOpen, onCreated }: {
    batches: ContentApprovalBatch[];
    clientId: string;
    organizationId: string;
    onOpen: (b: ContentApprovalBatch) => void;
    onCreated: () => void;
}) {
    const [name, setName] = useState('');
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);

    const create = async () => {
        if (!name.trim()) return;
        setBusy(true);
        const { data } = await createBatch({ organizationId, clientId, name: name.trim() });
        setBusy(false);
        if (data) { setName(''); setCreating(false); onCreated(); }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-semibold">Content approvals</h2>
                    <p className="text-xs text-muted-foreground">
                        Import finished content from Google Docs, then send one link for the client to review.
                    </p>
                </div>
                <button type="button" onClick={() => setCreating(true)}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                    <Plus className="h-3.5 w-3.5" /> New batch
                </button>
            </div>

            {creating && (
                <div className="flex gap-2 rounded-lg border border-border bg-card p-3">
                    <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') setCreating(false); }}
                        placeholder="e.g. October Content"
                        className="flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm" />
                    <button type="button" onClick={create} disabled={busy || !name.trim()}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                        {busy ? 'Creating…' : 'Create'}
                    </button>
                    <button type="button" onClick={() => setCreating(false)}
                        className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                </div>
            )}

            {batches.length === 0 && !creating && (
                <div className="rounded-lg border border-dashed border-border p-8 text-center">
                    <FileText className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-sm font-medium">No approval batches yet</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                        A batch groups the month’s content into one client-facing review link.
                    </p>
                </div>
            )}

            <ul className="space-y-2">
                {batches.map((batch) => (
                    <li key={batch.id}>
                        <button type="button" onClick={() => onOpen(batch)}
                            className="flex w-full items-center justify-between rounded-lg border border-border bg-card p-3 text-left hover:border-foreground/30">
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{batch.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {batch.sentAt ? `Sent ${new Date(batch.sentAt).toLocaleDateString()}` : 'Not sent yet'}
                                </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] capitalize text-muted-foreground">
                                {batch.status.replace('_', ' ')}
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ─── Batch detail ───────────────────────────────────────────────────────────

function BatchDetail({ batch, clientId, organizationId, onBack }: {
    batch: ContentApprovalBatch;
    clientId: string;
    organizationId: string;
    onBack: () => void;
}) {
    const [docs, setDocs] = useState<ContentApprovalDoc[]>([]);
    const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
    const [url, setUrl] = useState('');
    const [deliverableId, setDeliverableId] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hint, setHint] = useState<string | null>(null);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const load = useCallback(async () => {
        const [d, dl] = await Promise.all([
            listDocsForBatch(batch.id),
            getDeliverables(organizationId, { clientId }),
        ]);
        setDocs(d);
        setDeliverables(dl);
    }, [batch.id, organizationId, clientId]);

    useEffect(() => { void load(); }, [load]);

    const importDoc = async () => {
        setBusy(true); setError(null); setHint(null);
        try {
            const response = await fetch('/api/approvals/import-doc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, batchId: batch.id, deliverableId }),
            });
            const data = await response.json();
            if (!response.ok) { setError(data.error); setHint(data.hint ?? null); return; }
            setUrl(''); setDeliverableId('');
            await load();
        } catch {
            setError('Import failed. Check the link and try again.');
        } finally {
            setBusy(false);
        }
    };

    // Snapshot the working draft as the next immutable version. Clients only ever read
    // a published version, so nothing reaches them until this runs.
    const publish = async (doc: ContentApprovalDoc) => {
        setBusy(true);
        await publishVersion({
            docId: doc.id,
            organizationId,
            contentJson: doc.workingJson,
            wordCount: countWords(doc.workingJson as unknown as TiptapNode),
        });
        await load();
        setBusy(false);
    };

    const send = async () => {
        setBusy(true); setError(null); setHint(null);
        try {
            const response = await fetch('/api/approvals/share-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batchId: batch.id }),
            });
            const data = await response.json();
            if (!response.ok) {
                setError(data.error);
                setHint(Array.isArray(data.reasons) ? data.reasons.join(' ') : null);
                return;
            }
            setShareUrl(data.url);
            await load();
        } finally {
            setBusy(false);
        }
    };

    const unlock = async (doc: ContentApprovalDoc) => {
        setBusy(true);
        await setReviewLock(doc.id, false);
        await load();
        setBusy(false);
    };

    const rollup = rollUpBatch(docs.map((d) => ({ id: d.id, status: d.status, archivedAt: d.archivedAt })));
    const unpublished = docs.filter((d) => !d.archivedAt && !d.currentVersionId);

    return (
        <div className="space-y-4">
            <button type="button" onClick={onBack}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3.5 w-3.5" /> All batches
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-sm font-semibold">{batch.name}</h2>
                    <p className="text-xs text-muted-foreground">
                        {rollup.total} document{rollup.total === 1 ? '' : 's'} · {rollup.approved} approved
                        {rollup.changesRequested > 0 && ` · ${rollup.changesRequested} needing changes`}
                    </p>
                </div>
                <button type="button" onClick={send} disabled={busy || docs.length === 0}
                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                    <Send className="h-3.5 w-3.5" /> {batch.sentAt ? 'New link' : 'Send for review'}
                </button>
            </div>

            {shareUrl && (
                <div className="rounded-lg border border-primary/40 bg-card p-3">
                    <p className="mb-2 text-xs font-medium">
                        Review link — copy it now, it is not shown again.
                    </p>
                    <div className="flex gap-2">
                        <input readOnly value={shareUrl}
                            onFocus={(e) => e.currentTarget.select()}
                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs" />
                        <button type="button"
                            onClick={() => {
                                void navigator.clipboard.writeText(shareUrl);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            }}
                            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                        Paste it into the client’s Basecamp project. Every document is now locked for editing.
                    </p>
                </div>
            )}

            {/* Import */}
            <div className="rounded-lg border border-border bg-card p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                    <Upload className="h-3.5 w-3.5" /> Import from Google Docs
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input value={url} onChange={(e) => setUrl(e.target.value)}
                        placeholder="https://docs.google.com/document/d/…"
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
                    <select value={deliverableId} onChange={(e) => setDeliverableId(e.target.value)}
                        className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs">
                        <option value="">Link a deliverable…</option>
                        {deliverables.map((d) => (
                            <option key={d.id} value={d.id}>{d.title}{d.month ? ` (${d.month})` : ''}</option>
                        ))}
                    </select>
                    <button type="button" onClick={importDoc} disabled={busy || !url.trim() || !deliverableId}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                        {busy ? 'Importing…' : 'Import'}
                    </button>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                    A deliverable is required — without one, approving this content would not close a commitment.
                </p>
                {error && (
                    <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 p-2">
                        <p className="text-xs font-medium text-destructive">{error}</p>
                        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
                    </div>
                )}
            </div>

            {unpublished.length > 0 && (
                <p className="rounded-md border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                    {unpublished.length} document{unpublished.length === 1 ? '' : 's'} not published yet — publish before sending,
                    since clients only ever see a published version.
                </p>
            )}

            <ul className="space-y-2">
                {docs.filter((d) => !d.archivedAt).map((doc) => (
                    <li key={doc.id} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                                    {doc.reviewLocked && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                                    {doc.title}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {doc.currentVersionId ? 'Published' : 'Draft — not visible to the client'}
                                    {' · '}{doc.status.replace(/_/g, ' ')}
                                    {doc.decidedByLabel && ` by ${doc.decidedByLabel}`}
                                </p>
                            </div>
                            <div className="flex shrink-0 gap-1.5">
                                {doc.gdocDocumentId && (
                                    <a href={`https://docs.google.com/document/d/${doc.gdocDocumentId}/edit`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted">
                                        <ExternalLink className="h-3 w-3" /> Source
                                    </a>
                                )}
                                {!doc.currentVersionId && (
                                    <button type="button" onClick={() => publish(doc)} disabled={busy}
                                        className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                                        Publish
                                    </button>
                                )}
                                {doc.reviewLocked && (
                                    <button type="button" onClick={() => unlock(doc)} disabled={busy}
                                        className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
                                        <Unlock className="h-3 w-3" /> Unlock to edit
                                    </button>
                                )}
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
