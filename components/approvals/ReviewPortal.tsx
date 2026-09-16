'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Check, CheckCheck, FileText, Loader2, MessageSquare, PenLine, Send, X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ContentDocView } from '@/components/approvals/ContentDocView';
import type { AnchoredItem } from '@/lib/approvals/comment-highlight';
import type { PortalComment, PortalDocument, PortalPayload } from '@/lib/approvals/portal-data';
import type { ApprovalDocStatus, ContentAnchor } from '@/lib/types';

const NAME_STORAGE_KEY = 'approval-reviewer-name';

/** localStorage throws in private windows and returns null with site data cleared. */
function readStoredName(): string {
    try {
        return window.localStorage.getItem(NAME_STORAGE_KEY) ?? '';
    } catch {
        return '';
    }
}

function storeName(name: string): void {
    try {
        window.localStorage.setItem(NAME_STORAGE_KEY, name);
    } catch {
        /* a reviewer in a private window just gets asked again — not worth failing over */
    }
}

const STATUS_LABEL: Record<ApprovalDocStatus, string> = {
    pending: 'Awaiting your review',
    approved: 'Approved',
    approved_with_edits: 'Approved with edits',
    changes_requested: 'Changes requested',
};

interface Draft {
    anchor: ContentAnchor;
    mode: 'comment' | 'suggest';
    text: string;
}

export function ReviewPortal({ payload, token }: { payload: PortalPayload; token: string }) {
    const [documents, setDocuments] = useState<PortalDocument[]>(payload.documents);
    const [activeDocId, setActiveDocId] = useState(payload.documents[0]?.id ?? '');
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [reviewerName, setReviewerName] = useState('');
    const [nameInput, setNameInput] = useState('');
    const [needsName, setNeedsName] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [replyText, setReplyText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const stored = readStoredName();
        if (stored) setReviewerName(stored);
        else setNeedsName(true);
    }, []);

    const activeDoc = useMemo(
        () => documents.find((d) => d.id === activeDocId) ?? documents[0],
        [documents, activeDocId],
    );

    const post = useCallback(async (body: Record<string, unknown>) => {
        const response = await fetch(`/api/portal/${token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
        return data;
    }, [token]);

    const submitName = async () => {
        const name = nameInput.trim();
        if (!name) return;
        setBusy(true);
        try {
            await post({ action: 'identify', name });
            storeName(name);
            setReviewerName(name);
            setNeedsName(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save your name.');
        } finally {
            setBusy(false);
        }
    };

    // Highlights come from thread roots only — replies inherit the root's anchor, and
    // rendering one highlight per reply would stack the same span N times.
    const items: AnchoredItem[] = useMemo(() => {
        if (!activeDoc) return [];
        const comments = activeDoc.comments
            .filter((c) => !c.parentId && c.anchor)
            .map<AnchoredItem>((c) => ({
                id: c.id,
                anchor: c.anchor as ContentAnchor,
                kind: 'comment',
                resolved: c.status === 'resolved',
            }));
        const suggestions = activeDoc.suggestions
            .filter((s) => s.status === 'pending')
            .map<AnchoredItem>((s) => ({ id: s.id, anchor: s.anchor, kind: 'suggestion' }));
        return [...comments, ...suggestions];
    }, [activeDoc]);

    const threads = useMemo(() => {
        if (!activeDoc) return [];
        const roots = activeDoc.comments.filter((c) => !c.parentId);
        return roots
            .map((root) => ({
                root,
                replies: activeDoc.comments.filter((c) => c.parentId && c.threadRootId === root.id),
            }))
            // Sidebar order follows the document, not the clock — a reviewer reads top to
            // bottom, so a thread on paragraph 2 belongs above one on paragraph 9.
            .sort((a, b) => (a.root.anchor?.from ?? 0) - (b.root.anchor?.from ?? 0));
    }, [activeDoc]);

    const submitDraft = async () => {
        if (!draft || !activeDoc || !draft.text.trim()) return;
        setBusy(true);
        setError(null);
        try {
            if (draft.mode === 'suggest') {
                const data = await post({
                    action: 'suggest',
                    docId: activeDoc.id,
                    anchor: draft.anchor,
                    kind: 'replace',
                    payload: draft.text,
                    authorLabel: reviewerName,
                });
                setDocuments((prev) => prev.map((d) => d.id !== activeDoc.id ? d : {
                    ...d,
                    suggestions: [...d.suggestions, {
                        id: data.suggestionId, kind: 'replace', anchor: draft.anchor,
                        payload: draft.text, authorLabel: reviewerName, status: 'pending',
                        createdAt: new Date().toISOString(),
                    }],
                }));
            } else {
                const data = await post({
                    action: 'comment',
                    docId: activeDoc.id,
                    anchor: draft.anchor,
                    body: draft.text,
                    authorLabel: reviewerName,
                });
                const comment: PortalComment = {
                    id: data.commentId, authorType: 'client', authorLabel: reviewerName,
                    body: draft.text, anchor: draft.anchor, status: 'open',
                    threadRootId: data.commentId, createdAt: new Date().toISOString(),
                };
                setDocuments((prev) => prev.map((d) => d.id !== activeDoc.id ? d : {
                    ...d, comments: [...d.comments, comment],
                }));
                setActiveThreadId(data.commentId);
            }
            setDraft(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save.');
        } finally {
            setBusy(false);
        }
    };

    const submitReply = async (rootId: string) => {
        if (!activeDoc || !replyText.trim()) return;
        setBusy(true);
        try {
            const data = await post({
                action: 'comment', docId: activeDoc.id, parentId: rootId,
                threadRootId: rootId, body: replyText, authorLabel: reviewerName,
            });
            const reply: PortalComment = {
                id: data.commentId, parentId: rootId, threadRootId: rootId,
                authorType: 'client', authorLabel: reviewerName, body: replyText,
                status: 'open', createdAt: new Date().toISOString(),
            };
            setDocuments((prev) => prev.map((d) => d.id !== activeDoc.id ? d : {
                ...d, comments: [...d.comments, reply],
            }));
            setReplyText('');
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not reply.');
        } finally {
            setBusy(false);
        }
    };

    const decide = async (status: ApprovalDocStatus) => {
        if (!activeDoc) return;
        setBusy(true);
        setError(null);
        try {
            await post({ action: 'decide', docId: activeDoc.id, status, authorLabel: reviewerName });
            setDocuments((prev) => prev.map((d) => d.id !== activeDoc.id ? d : {
                ...d, status, decidedByLabel: reviewerName, decidedAt: new Date().toISOString(),
            }));
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not record your decision.');
        } finally {
            setBusy(false);
        }
    };

    const decidedCount = documents.filter(
        (d) => d.status === 'approved' || d.status === 'approved_with_edits',
    ).length;

    if (documents.length === 0) {
        return (
            <main className="flex min-h-screen items-center justify-center bg-background px-6">
                <div className="max-w-md rounded-xl border border-border bg-card p-8 text-center">
                    <FileText className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
                    <h1 className="mb-2 text-lg font-semibold">Nothing to review yet</h1>
                    <p className="text-sm text-muted-foreground">
                        Your account manager is still preparing this content. Check back shortly.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen bg-background">
            {needsName && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
                    <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6">
                        <h2 className="mb-1 text-base font-semibold">Before you start</h2>
                        <p className="mb-4 text-sm text-muted-foreground">
                            Your name is shown alongside your comments so the team knows who asked for what.
                        </p>
                        <input
                            autoFocus
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitName(); }}
                            placeholder="Your name"
                            className="mb-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                        <button
                            type="button"
                            onClick={submitName}
                            disabled={busy || !nameInput.trim()}
                            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                        >
                            {busy ? 'Saving…' : 'Start reviewing'}
                        </button>
                    </div>
                </div>
            )}

            <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
                <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
                    <div className="min-w-0">
                        <h1 className="truncate text-sm font-semibold sm:text-base">{payload.batch.name}</h1>
                        <p className="truncate text-xs text-muted-foreground">
                            {payload.clientName}
                            {payload.batch.dueDate && ` · due ${new Date(payload.batch.dueDate).toLocaleDateString()}`}
                        </p>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                        {decidedCount} of {documents.length} approved
                    </div>
                </div>
            </header>

            <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)_320px]">
                {/* Document rail */}
                <nav className="lg:sticky lg:top-20 lg:self-start">
                    <ul className="flex gap-2 overflow-x-auto lg:block lg:space-y-1 lg:overflow-visible">
                        {documents.map((doc) => (
                            <li key={doc.id} className="shrink-0 lg:shrink">
                                <button
                                    type="button"
                                    onClick={() => { setActiveDocId(doc.id); setActiveThreadId(null); setDraft(null); }}
                                    className={cn(
                                        'w-full rounded-md px-3 py-2 text-left text-xs transition-colors',
                                        doc.id === activeDoc?.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                                    )}
                                >
                                    <span className="block truncate font-medium">{doc.title}</span>
                                    <span className={cn(
                                        'mt-0.5 block truncate',
                                        doc.status === 'pending' ? 'text-muted-foreground' : 'text-foreground/70',
                                    )}>
                                        {STATUS_LABEL[doc.status]}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </nav>

                {/* Document */}
                <section className="min-w-0">
                    {activeDoc && (
                        <>
                            <ContentDocView
                                content={activeDoc.content}
                                editable={false}
                                items={items}
                                activeId={activeThreadId}
                                onActivate={setActiveThreadId}
                                onRequestComment={payload.allowComments && activeDoc.status === 'pending'
                                    ? (anchor) => { setDraft({ anchor, mode: 'comment', text: '' }); setActiveThreadId(null); }
                                    : undefined}
                            />

                            <div className="mt-8 rounded-xl border border-border bg-card p-4 sm:p-6">
                                {activeDoc.status === 'pending' ? (
                                    <>
                                        <h2 className="mb-1 text-sm font-semibold">Ready to sign off on “{activeDoc.title}”?</h2>
                                        <p className="mb-4 text-xs text-muted-foreground">
                                            Each piece is approved on its own — approving this one won’t affect the others.
                                        </p>
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <button type="button" disabled={busy} onClick={() => decide('approved')}
                                                className="flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
                                                <Check className="h-4 w-4" /> Approve
                                            </button>
                                            <button type="button" disabled={busy} onClick={() => decide('approved_with_edits')}
                                                className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                                                <CheckCheck className="h-4 w-4" /> Approve with my edits
                                            </button>
                                            <button type="button" disabled={busy} onClick={() => decide('changes_requested')}
                                                className="flex items-center justify-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
                                                <PenLine className="h-4 w-4" /> Request changes
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm">
                                        <span className="font-medium">{STATUS_LABEL[activeDoc.status]}</span>
                                        {activeDoc.decidedByLabel && (
                                            <span className="text-muted-foreground"> by {activeDoc.decidedByLabel}</span>
                                        )}
                                    </p>
                                )}
                                {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
                            </div>
                        </>
                    )}
                </section>

                {/* Threads — a bottom sheet on phones, a rail on desktop */}
                <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
                    {draft && (
                        <div className="mb-3 rounded-lg border border-primary/40 bg-card p-3">
                            <div className="mb-2 flex gap-1">
                                {(['comment', 'suggest'] as const).map((mode) => (
                                    <button key={mode} type="button"
                                        onClick={() => setDraft({ ...draft, mode })}
                                        className={cn('rounded px-2 py-1 text-xs font-medium',
                                            draft.mode === mode ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted')}>
                                        {mode === 'comment' ? 'Comment' : 'Suggest edit'}
                                    </button>
                                ))}
                                <button type="button" onClick={() => setDraft(null)}
                                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Cancel">
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </div>
                            <blockquote className="mb-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground line-clamp-3">
                                {draft.anchor.quotedText}
                            </blockquote>
                            <textarea
                                autoFocus rows={3} value={draft.text}
                                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                                placeholder={draft.mode === 'suggest' ? 'Replace it with…' : 'What should change?'}
                                className="mb-2 w-full resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                            />
                            <button type="button" onClick={submitDraft} disabled={busy || !draft.text.trim()}
                                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                {draft.mode === 'suggest' ? 'Suggest' : 'Comment'}
                            </button>
                        </div>
                    )}

                    {threads.length === 0 && !draft && (
                        <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                            <MessageSquare className="mb-2 h-4 w-4" />
                            Select any text in the document to leave a comment or suggest a change.
                        </p>
                    )}

                    <ul className="space-y-2">
                        {threads.map(({ root, replies }) => (
                            <li key={root.id}>
                                <button type="button" onClick={() => setActiveThreadId(root.id)}
                                    className={cn('w-full rounded-lg border bg-card p-3 text-left transition-colors',
                                        activeThreadId === root.id ? 'border-primary' : 'border-border hover:border-foreground/30')}>
                                    {root.anchor && (
                                        <blockquote className="mb-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground line-clamp-2">
                                            {root.anchor.quotedText}
                                        </blockquote>
                                    )}
                                    <p className="text-xs font-medium">{root.authorLabel}</p>
                                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground/80">{root.body}</p>
                                    {replies.map((reply) => (
                                        <div key={reply.id} className="mt-2 border-l-2 border-border pl-2">
                                            <p className="text-xs font-medium">{reply.authorLabel}</p>
                                            <p className="whitespace-pre-wrap text-xs text-foreground/80">{reply.body}</p>
                                        </div>
                                    ))}
                                </button>

                                {activeThreadId === root.id && payload.allowComments && (
                                    <div className="mt-1.5 flex gap-1.5">
                                        <input
                                            value={replyText}
                                            onChange={(e) => setReplyText(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter') submitReply(root.id); }}
                                            placeholder="Reply…"
                                            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                                        />
                                        <button type="button" onClick={() => submitReply(root.id)} disabled={busy || !replyText.trim()}
                                            className="rounded-md bg-primary px-2.5 text-primary-foreground disabled:opacity-50" aria-label="Send reply">
                                            <Send className="h-3 w-3" />
                                        </button>
                                    </div>
                                )}
                            </li>
                        ))}
                    </ul>
                </aside>
            </div>
        </main>
    );
}
