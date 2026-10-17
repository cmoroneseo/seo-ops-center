'use client';

import { useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

function linkLabel(url: string): string {
    try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./i, '');
        const path = parsed.pathname.replace(/\/$/, '');
        return `${host}${path}` || host;
    } catch {
        return url;
    }
}

/**
 * A link chip, or a one-line editor.
 * Content rows keep the add control visible. Other rows show it on hover.
 */
export function LiveUrlControl({
    url,
    category,
    prominent = false,
    onSave,
}: {
    url?: string | null;
    category?: string | null;
    /** The open task already has the reader's attention, so the control stays visible. */
    prominent?: boolean;
    onSave?: (raw: string) => Promise<string | null>;
}) {
    const stored = url?.trim() ?? '';
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(stored);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const lock = useRef(false);
    const skipBlur = useRef(false);
    const canEdit = Boolean(onSave);
    const content = category === 'content';

    if (!stored && !canEdit) return null;

    async function commit(next: string) {
        if (!onSave || lock.current) return;
        if (next.trim() === stored) {
            setEditing(false);
            setError(null);
            return;
        }
        lock.current = true;
        setBusy(true);
        setError(null);
        try {
            const problem = await onSave(next);
            if (problem) {
                setError(problem);
                return;
            }
            setEditing(false);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }

    const collapsed = !stored && !prominent && !content;

    return (
        <div
            className={cn(
                'flex min-w-0 flex-wrap items-center gap-1.5',
                collapsed
                    ? 'h-0 overflow-hidden opacity-0 group-hover:mt-1 group-hover:h-auto group-hover:overflow-visible group-hover:opacity-100 group-focus-within:mt-1 group-focus-within:h-auto group-focus-within:overflow-visible group-focus-within:opacity-100'
                    : 'mt-1',
            )}
            data-live-url={stored || undefined}
            onClick={event => event.stopPropagation()}
            onKeyDown={event => event.stopPropagation()}
        >
            {stored && !editing && (
                <a
                    href={stored}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={stored}
                    className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{linkLabel(stored)}</span>
                </a>
            )}
            {canEdit && (editing ? (
                <input
                    autoFocus
                    type="url"
                    inputMode="url"
                    aria-label={stored ? 'Edit live URL' : 'Live URL'}
                    value={draft}
                    disabled={busy}
                    placeholder="https://"
                    onChange={event => {
                        setDraft(event.target.value);
                        if (error) setError(null);
                    }}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            void commit(draft);
                        }
                        if (event.key === 'Escape') {
                            event.preventDefault();
                            skipBlur.current = true;
                            setDraft(stored);
                            setEditing(false);
                            setError(null);
                        }
                    }}
                    onBlur={() => {
                        if (skipBlur.current) {
                            skipBlur.current = false;
                            return;
                        }
                        void commit(draft);
                    }}
                    className="w-56 max-w-full rounded border border-border bg-background px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
            ) : (
                <button
                    type="button"
                    data-add-live-url=""
                    onClick={() => {
                        setDraft(stored);
                        setEditing(true);
                        setError(null);
                    }}
                    className={cn(
                        'text-[11px] text-muted-foreground hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        stored && !prominent && 'w-0 overflow-hidden opacity-0 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100',
                    )}
                >
                    {stored ? 'Edit' : 'Add live URL'}
                </button>
            ))}
            {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
        </div>
    );
}
