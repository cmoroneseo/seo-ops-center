'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ArrowLeft, Check, CheckCircle2, ExternalLink, ListTodo, Loader2, Lock,
    MessageSquare, Unlock, UploadCloud, X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { ContentDocView } from '@/components/approvals/ContentDocView';
import type { AnchoredItem } from '@/lib/approvals/comment-highlight';
import { countWords, type TiptapNode } from '@/lib/approvals/gdocs-to-tiptap';
import {
    listComments, listSuggestions, publishVersion, saveWorkingDraft, setCommentStatus, setReviewLock,
} from '@/lib/supabase/content-approvals';
import { createTask } from '@/lib/supabase/tasks';
import type { ContentApprovalDoc, ContentComment, ContentSuggestion } from '@/lib/types';

interface Props {
    doc: ContentApprovalDoc;
    clientId: string;
    organizationId: string;
    onBack: () => void;
    onChanged: () => void;
}

export function DocReviewPanel({ doc, clientId, organizationId, onBack, onChanged }: Props) {
    const [comments, setComments] = useState<ContentComment[]>([]);
    const [suggestions, setSuggestions] = useState<ContentSuggestion[]>([]);
    const [content, setContent] = useState<Record<string, unknown>>(doc.workingJson);
    const [locked, setLocked] = useState(doc.reviewLocked);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);

    const load = useCallback(async () => {
        const [c, s] = await Promise.all([listComments(doc.id), listSuggestions(doc.id)]);
        setComments(c);
        setSuggestions(s);
    }, [doc.id]);

    useEffect(() => { void load(); }, [load]);

    const pending = useMemo(() => suggestions.filter((s) => s.status === 'pending'), [suggestions]);
    const openThreads = useMemo(
        () => comments.filter((c) => !c.parentId && c.status !== 'resolved'), [comments],
    );

    const items: AnchoredItem[] = useMemo(() => [
        ...comments.filter((c) => !c.parentId && c.anchor).map<AnchoredItem>((c) => ({
            id: c.id, anchor: c.anchor!, kind: 'comment', resolved: c.status === 'resolved',
        })),
        ...pending.map<AnchoredItem>((s) => ({ id: s.id, anchor: s.anchor, kind: 'suggestion' })),
    ], [comments, pending]);

    const decide = async (ids: string[], action: 'accept' | 'reject') => {
        setBusy(true); setNotice(null);
        try {
            const response = await fetch('/api/approvals/suggestions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ docId: doc.id, suggestionIds: ids, action }),
            });
            const data = await response.json();
            if (!response.ok) { setNotice(data.hint ? `${data.error} ${data.hint}` : data.error); return; }

            if (action === 'accept') {
                // Skipped suggestions stay pending — a stale one needs a human to look at
                // what actually changed rather than being quietly marked done.
                if (data.skipped?.length) {
                    setNotice(`${data.applied} applied. ${data.skipped.length} could not be: ${data.skipped[0].reason}`);
                } else {
                    setNotice(`${data.applied} applied to the draft.`);
                }
                const fresh = await import('@/lib/supabase/content-approvals')
                    .then((m) => m.listDocsForBatch(doc.batchId));
                const updated = fresh.find((d) => d.id === doc.id);
                if (updated) setContent(updated.workingJson);
            }
            await load();
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    const toggleLock = async () => {
        setBusy(true);
        await setReviewLock(doc.id, !locked);
        setLocked(!locked);
        setBusy(false);
        onChanged();
    };

    const publish = async () => {
        setBusy(true);
        if (dirty) await saveWorkingDraft(doc.id, content);
        await publishVersion({
            docId: doc.id,
            organizationId,
            contentJson: content,
            wordCount: countWords(content as unknown as TiptapNode),
        });
        setDirty(false);
        setNotice('Published. The client now sees this version.');
        setBusy(false);
        onChanged();
    };

    const promoteToTask = async (comment: ContentComment) => {
        setBusy(true);
        const result = await createTask({
            organizationId,
            clientId,
            title: `Content edit: ${comment.anchor?.quotedText?.slice(0, 60) ?? doc.title}`,
            description: `${comment.authorLabel} on “${doc.title}”:\n\n${comment.body}`,
            category: 'Content',
            deliverableId: doc.deliverableId,
        });
        if (result.success) {
            await setCommentStatus(comment.id, 'resolved');
            await load();
            setNotice('Task created and the thread resolved.');
        } else {
            setNotice(result.error ?? 'Could not create the task.');
        }
        setBusy(false);
    };

    return (
        <div className="space-y-4">
            <button type="button" onClick={onBack}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-3.5 w-3.5" /> Back to batch
            </button>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                    <h2 className="flex items-center gap-1.5 truncate text-sm font-semibold">
                        {locked && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        {doc.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                        {openThreads.length} open thread{openThreads.length === 1 ? '' : 's'} · {pending.length} pending suggestion{pending.length === 1 ? '' : 's'}
                        {locked && ' · locked while the client reviews'}
                    </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                    {doc.gdocDocumentId && (
                        <a href={`https://docs.google.com/document/d/${doc.gdocDocumentId}/edit`}
                            target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted">
                            <ExternalLink className="h-3.5 w-3.5" /> Source doc
                        </a>
                    )}
                    <button type="button" onClick={toggleLock} disabled={busy}
                        className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50">
                        {locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                        {locked ? 'Unlock to edit' : 'Lock for review'}
                    </button>
                    <button type="button" onClick={publish} disabled={busy || locked}
                        className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
                        <UploadCloud className="h-3.5 w-3.5" /> Publish version
                    </button>
                </div>
            </div>

            {notice && (
                <p className="rounded-md border border-border bg-muted/40 p-2 text-xs">{notice}</p>
            )}

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-6">
                    <ContentDocView
                        content={content}
                        editable={!locked}
                        items={items}
                        activeId={activeId}
                        onActivate={setActiveId}
                        onChange={(json) => { setContent(json); setDirty(true); }}
                    />
                </section>

                <aside className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto">
                    {pending.length > 0 && (
                        <div>
                            <div className="mb-2 flex items-center justify-between">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                    Suggested edits
                                </h3>
                                <button type="button" disabled={busy || locked}
                                    onClick={() => decide(pending.map((s) => s.id), 'accept')}
                                    className="text-[11px] font-medium text-primary hover:underline disabled:opacity-50">
                                    Accept all
                                </button>
                            </div>
                            <ul className="space-y-2">
                                {pending.map((s) => (
                                    <li key={s.id}
                                        className={cn('rounded-lg border bg-card p-3',
                                            activeId === s.id ? 'border-primary' : 'border-border')}
                                        onMouseEnter={() => setActiveId(s.id)}>
                                        <p className="mb-1 text-[11px] font-medium">{s.authorLabel}</p>
                                        <p className="text-xs leading-relaxed">
                                            <span className="text-muted-foreground line-through">{s.anchor.quotedText}</span>
                                            {s.payload && <span className="ml-1 text-foreground">{s.payload}</span>}
                                        </p>
                                        <div className="mt-2 flex gap-1.5">
                                            <button type="button" disabled={busy || locked} onClick={() => decide([s.id], 'accept')}
                                                className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                                                <Check className="h-3 w-3" /> Accept
                                            </button>
                                            <button type="button" disabled={busy} onClick={() => decide([s.id], 'reject')}
                                                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
                                                <X className="h-3 w-3" /> Reject
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                            {locked && (
                                <p className="mt-2 text-[11px] text-muted-foreground">
                                    Unlock the document to accept edits — it is currently open for client review.
                                </p>
                            )}
                        </div>
                    )}

                    <div>
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Client comments
                        </h3>
                        {openThreads.length === 0 && (
                            <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                                <MessageSquare className="mb-1.5 h-4 w-4" />
                                No open threads.
                            </p>
                        )}
                        <ul className="space-y-2">
                            {openThreads.map((thread) => (
                                <li key={thread.id}
                                    className={cn('rounded-lg border bg-card p-3',
                                        activeId === thread.id ? 'border-primary' : 'border-border')}
                                    onMouseEnter={() => setActiveId(thread.id)}>
                                    {thread.anchor && (
                                        <blockquote className="mb-1.5 border-l-2 border-border pl-2 text-[11px] italic text-muted-foreground line-clamp-2">
                                            {thread.anchor.quotedText}
                                        </blockquote>
                                    )}
                                    <p className="text-[11px] font-medium">{thread.authorLabel}</p>
                                    <p className="whitespace-pre-wrap text-xs text-foreground/80">{thread.body}</p>
                                    {comments.filter((c) => c.threadRootId === thread.id && c.parentId).map((reply) => (
                                        <div key={reply.id} className="mt-1.5 border-l-2 border-border pl-2">
                                            <p className="text-[11px] font-medium">{reply.authorLabel}</p>
                                            <p className="text-xs text-foreground/80">{reply.body}</p>
                                        </div>
                                    ))}
                                    <div className="mt-2 flex gap-1.5">
                                        <button type="button" disabled={busy}
                                            onClick={async () => { await setCommentStatus(thread.id, 'resolved'); await load(); }}
                                            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
                                            <CheckCircle2 className="h-3 w-3" /> Resolve
                                        </button>
                                        <button type="button" disabled={busy || !!thread.taskId}
                                            onClick={() => promoteToTask(thread)}
                                            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-50">
                                            <ListTodo className="h-3 w-3" /> {thread.taskId ? 'Task created' : 'Make a task'}
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {busy && (
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Working…
                        </p>
                    )}
                </aside>
            </div>
        </div>
    );
}
