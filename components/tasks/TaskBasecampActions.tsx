'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Link2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const ACTION_STYLE = 'inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50';

export function TaskBasecampActions({
    taskId,
    todoId,
    active,
    topLevel,
    hasClient,
    send,
    onSynced,
}: {
    taskId: string;
    todoId: string | undefined;
    active: boolean;
    topLevel: boolean;
    hasClient: boolean;
    send?: { pending: boolean; run: () => void; error?: string; note: string | null };
    onSynced: (link?: { todoId: string; projectId: string }) => Promise<void>;
}) {
    const headingId = useId();
    const inputId = `${headingId}-todo`;
    const [showLink, setShowLink] = useState(false);
    const todoInput = useRef<HTMLInputElement>(null);
    const [pending, setPending] = useState<'link' | 'refresh' | null>(null);
    const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
    const [eligibility, setEligibility] = useState<{ todoId: string; canRefresh: boolean; error?: string } | null>(null);
    const checked = eligibility?.todoId === todoId ? eligibility : null;

    // The same database column stores to-do and step ids, even for a step
    // that has since been moved out from under its parent.
    useEffect(() => {
        if (!active || !topLevel || !todoId || checked) return;
        const controller = new AbortController();
        async function checkLink(id: string) {
            try {
                const response = await fetch(`/api/integrations/basecamp/refresh-steps?taskId=${encodeURIComponent(taskId)}`, {
                    signal: controller.signal,
                });
                const body = await response.json().catch(() => null);
                if (!controller.signal.aborted) {
                    const verified = response.ok && typeof body?.canRefresh === 'boolean';
                    setEligibility({
                        todoId: id,
                        canRefresh: verified && body.canRefresh,
                        error: verified ? undefined : typeof body?.error === 'string' ? body.error : 'Unable to verify this Basecamp link.',
                    });
                }
            } catch {
                if (!controller.signal.aborted) {
                    setEligibility({ todoId: id, canRefresh: false, error: 'Unable to verify this Basecamp link.' });
                }
            }
        }
        void checkLink(todoId);
        return () => controller.abort();
    }, [active, checked, taskId, todoId, topLevel]);

    async function run(action: 'link' | 'refresh') {
        if (pending || send?.pending) return;
        const linking = action === 'link';
        const basecampTodoId = linking ? todoInput.current?.value.trim() : undefined;
        if (linking && !basecampTodoId) {
            setFeedback({ text: 'Enter a Basecamp to-do URL or ID.', error: true });
            return;
        }
        setPending(action);
        setFeedback(null);
        const fallback = linking ? 'Unable to link the Basecamp to-do.' : 'Unable to refresh steps from Basecamp.';
        try {
            const response = await fetch(`/api/integrations/basecamp/${linking ? 'link' : 'refresh-steps'}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId, basecampTodoId }),
            });
            const body = await response.json().catch(() => null);
            if (!response.ok || !body?.todoId || !body?.projectId) {
                setFeedback({ text: typeof body?.error === 'string' ? body.error : fallback, error: true });
                return;
            }
            if (linking) {
                setEligibility({ todoId: body.todoId, canRefresh: true });
                setShowLink(false);
            }
            const imported = body.imported > 0
                ? `Imported ${body.imported} new ${body.imported === 1 ? 'step' : 'steps'}.`
                : 'Steps are up to date.';
            const linked = body.linked > 0
                ? ` Matched ${body.linked} existing ${body.linked === 1 ? 'subtask' : 'subtasks'}.`
                : '';
            setFeedback({ text: `${linking ? 'Basecamp to-do linked. ' : ''}${imported}${linked}` });
            await onSynced(linking ? { todoId: body.todoId, projectId: body.projectId } : undefined);
        } catch {
            setFeedback({ text: fallback, error: true });
        } finally {
            setPending(null);
        }
    }

    const canLink = topLevel && hasClient && !todoId;
    const canRefresh = topLevel && checked?.canRefresh;
    const checkError = topLevel ? checked?.error : null;
    if (!canLink && !canRefresh && !send && !feedback && !checkError) return null;

    return (
        <section aria-labelledby={headingId} className="space-y-2">
            <p id={headingId} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <RefreshCw className="h-3 w-3" /> Basecamp
            </p>
            {(canLink || canRefresh || send) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                    {!todoId && <span className="text-[11px] text-muted-foreground">Not in Basecamp</span>}
                    {send && (
                        <button type="button" onClick={send.run} disabled={send.pending || pending !== null} className={ACTION_STYLE}>
                            <RefreshCw className={cn('h-3 w-3', send.pending && 'animate-spin')} />
                            {send.pending ? 'Sending' : 'Send to Basecamp'}
                        </button>
                    )}
                    {canLink && (
                        <button type="button" disabled={send?.pending || pending !== null} aria-expanded={showLink}
                            onClick={() => { setShowLink(open => !open); setFeedback(null); }} className={ACTION_STYLE}>
                            <Link2 className="h-3 w-3" /> Link existing Basecamp to-do
                        </button>
                    )}
                    {canRefresh && (
                        <button type="button" onClick={() => void run('refresh')} disabled={pending !== null} className={ACTION_STYLE}>
                            <RefreshCw className={cn('h-3 w-3', pending === 'refresh' && 'animate-spin')} />
                            {pending === 'refresh' ? 'Refreshing steps' : 'Refresh steps from Basecamp'}
                        </button>
                    )}
                </div>
            )}
            {canLink && showLink && (
                <form onSubmit={event => { event.preventDefault(); void run('link'); }} className="space-y-2">
                    <label htmlFor={inputId} className="block text-[11px] text-muted-foreground">Basecamp to-do URL or ID</label>
                    <div className="flex flex-wrap items-center gap-2">
                        <input ref={todoInput} id={inputId} type="text" required
                            disabled={pending !== null || send?.pending}
                            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                        <button type="submit" disabled={pending !== null || send?.pending} className={ACTION_STYLE}>
                            {pending === 'link' ? 'Linking' : 'Link to-do'}
                        </button>
                    </div>
                </form>
            )}
            {(send?.error || checkError) && <p role="alert" className="text-[11px] leading-relaxed text-destructive">{send?.error ?? checkError}</p>}
            {send?.note && <p className="text-[11px] leading-relaxed text-muted-foreground">{send.note}</p>}
            {feedback && (
                <p role={feedback.error ? 'alert' : 'status'} className={cn('text-[11px] leading-relaxed', feedback.error ? 'text-destructive' : 'text-muted-foreground')}>
                    {feedback.text}
                </p>
            )}
        </section>
    );
}
