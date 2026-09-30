'use client';

import { FormEvent, useState } from 'react';
import type { PortalFeedbackEntry } from '@/lib/portal/progress';

function when(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function FeedbackThread({
    subjectType,
    subjectId,
    entries,
}: {
    subjectType: 'plan' | 'waiting_item';
    subjectId: string;
    entries: PortalFeedbackEntry[];
}) {
    const [items, setItems] = useState(entries);
    const [body, setBody] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);

    async function submit(event: FormEvent) {
        event.preventDefault();
        setPending(true);
        setError(null);
        const response = await fetch('/api/client-portal/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subjectType, subjectId, body }),
        });
        const payload = await response.json().catch(() => null);
        setPending(false);
        if (!response.ok) {
            setError(payload?.error ?? 'Could not save the note');
            return;
        }
        setItems(current => [...current, {
            id: `local-${Date.now()}`,
            subjectType,
            subjectId,
            authorLabel: 'You',
            body: body.trim(),
            createdAt: new Date().toISOString(),
        }]);
        setBody('');
    }

    return (
        <div className="mt-4 space-y-3">
            {items.length > 0 && (
                <ul className="space-y-2">
                    {items.map(entry => (
                        <li key={entry.id} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                            <p className="text-xs text-muted-foreground">{entry.authorLabel} · {when(entry.createdAt)}</p>
                            <p className="mt-1 whitespace-pre-wrap">{entry.body}</p>
                        </li>
                    ))}
                </ul>
            )}
            <form onSubmit={submit} className="space-y-2">
                <label className="block text-sm font-medium">
                    Leave a note
                    <textarea
                        value={body}
                        onChange={event => setBody(event.target.value)}
                        rows={3}
                        maxLength={2000}
                        className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                        placeholder="A question or a detail the team should see"
                    />
                </label>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                    type="submit"
                    disabled={pending || body.trim().length === 0}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                    {pending ? 'Saving…' : 'Send note'}
                </button>
            </form>
        </div>
    );
}
