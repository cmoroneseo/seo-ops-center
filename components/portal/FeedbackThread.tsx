'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import type { PortalFeedbackEntry } from '@/lib/portal/progress';
import { usePortalView } from './PortalViewContext';

function when(iso: string) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function FeedbackThread({ subjectType, subjectId, entries }: {
    subjectType: PortalFeedbackEntry['subjectType']; subjectId: string; entries: PortalFeedbackEntry[];
}) {
    const { readOnly } = usePortalView();
    const [items, setItems] = useState(entries);
    const [body, setBody] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [pending, setPending] = useState(false);
    useEffect(() => { setItems(entries); }, [entries]);
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (readOnly || pending || !body.trim()) return;
        setPending(true); setError(null); setSuccess(false);
        try {
            const response = await fetch('/api/client-portal/feedback', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subjectType, subjectId, body }),
            });
            const payload = await response.json().catch(() => null);
            if (response.status === 401) throw new Error('Your sign-in has expired. Sign in again, then resend your message.');
            if (!response.ok) throw new Error(payload?.error ?? 'Could not send your note. Please try again.');
            setItems(current => [...current, { id: `local-${Date.now()}`, subjectType, subjectId, authorLabel: 'You', authorType: 'client', body: body.trim(), createdAt: new Date().toISOString() }]);
            setBody(''); setSuccess(true);
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not send your note. Please try again.'); }
        finally { setPending(false); }
    }
    return (
        <div className="mt-4 space-y-5">
            {items.length > 0 && <ol className="space-y-3" aria-label="Conversation">{items.map(entry => <li key={entry.id} className={`rounded-lg px-4 py-3 text-sm ${entry.authorType === 'team' ? 'border border-border bg-secondary' : 'bg-muted/50'}`}><p className="text-xs text-muted-foreground"><strong className="font-semibold text-foreground">{entry.authorLabel}</strong>{entry.authorType === 'team' ? ' · Your team' : ''} · <time dateTime={entry.createdAt}>{when(entry.createdAt)}</time></p><p className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{entry.body}</p></li>)}</ol>}
            <form id={subjectType === 'general' ? 'message-compose' : undefined} onSubmit={submit} className="space-y-3 scroll-mt-6">
                <label className="block text-sm font-semibold">{subjectType === 'general' ? 'Message your team' : 'Leave a note'}<textarea value={body} onChange={event => { setBody(event.target.value); setSuccess(false); }} rows={4} maxLength={2000} required disabled={readOnly || pending} className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-3 text-sm font-normal leading-relaxed disabled:opacity-60" placeholder="Share a question, an update, or something you’d like us to know." /></label>
                {readOnly && <p className="text-xs text-muted-foreground">Sending messages is disabled in client preview.</p>}
                <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-[11px] text-muted-foreground">{body.length.toLocaleString()}/2,000 characters</p><button type="submit" disabled={readOnly || pending || body.trim().length === 0} className="portal-button"><Send size={14} aria-hidden="true" />{pending ? 'Sending…' : 'Send message'}</button></div>
                {error && <div role="alert" className="text-sm text-destructive"><p>{error}</p>{error.includes('sign-in') && <a href={`/portal/login?next=${subjectType === 'general' ? '/portal/messages' : '/portal/plan'}`} className="mt-1 inline-block font-semibold underline">Sign in again</a>}</div>}
                {success && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">Your message is saved for your account team.</p>}
            </form>
        </div>
    );
}
