'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';

import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { splitKeywordPaste } from '@/lib/keyword-tracking/plan';
import {
    addTrackedKeywords,
    loadRankings,
    type RankingsKeyword,
    type RankingsNote,
} from '@/lib/keyword-tracking/store';

const SOURCE_LABEL: Record<RankingsKeyword['source'], string> = {
    paste: 'Paste',
    gsc_promote: 'Search Insights',
    ahrefs_import: 'Import',
    research: 'Research',
};

const NOTE_LABEL: Record<RankingsNote['kind'], string> = {
    keywords_changed: 'Keywords changed',
    method_changed: 'Method changed',
    manual: 'Note',
};

export function RankingsTab({
    organizationId,
    clientId,
}: {
    organizationId: string;
    clientId: string;
}) {
    const enabled = keywordTrackingEnabled();
    const [keywords, setKeywords] = useState<RankingsKeyword[]>([]);
    const [notes, setNotes] = useState<RankingsNote[]>([]);
    const [cap, setCap] = useState(50);
    const [draft, setDraft] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(enabled);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        setLoading(true);
        loadRankings({ organizationId, clientId }).then(snapshot => {
            if (cancelled) return;
            setKeywords(snapshot.keywords);
            setNotes(snapshot.notes);
            setCap(snapshot.cap);
            setError(snapshot.error ?? '');
            setLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [enabled, organizationId, clientId]);

    if (!enabled) return null;

    async function reload() {
        const snapshot = await loadRankings({ organizationId, clientId });
        setKeywords(snapshot.keywords);
        setNotes(snapshot.notes);
        setCap(snapshot.cap);
        setError(snapshot.error ?? '');
    }

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        if (!keywordTrackingEnabled() || busy) return;
        setBusy(true);
        setMessage('');
        const result = await addTrackedKeywords({
            organizationId,
            clientId,
            entries: splitKeywordPaste(draft),
            source: 'paste',
        });
        if (result.wrote) {
            setDraft('');
            await reload();
        }
        setMessage(result.message);
        setBusy(false);
    }

    return (
        <RankingsPanel
            keywords={keywords}
            notes={notes}
            cap={cap}
            draft={draft}
            message={message}
            error={error}
            loading={loading}
            busy={busy}
            onDraft={setDraft}
            onSubmit={onSubmit}
        />
    );
}

export function RankingsPanel({
    keywords,
    notes,
    cap,
    draft,
    message,
    error,
    loading,
    busy,
    onDraft,
    onSubmit,
}: {
    keywords: RankingsKeyword[];
    notes: RankingsNote[];
    cap: number;
    draft: string;
    message: string;
    error: string;
    loading: boolean;
    busy: boolean;
    onDraft: (value: string) => void;
    onSubmit: (event: FormEvent) => void;
}) {
    const fieldId = useId();
    return (
        <section aria-label="Rankings" data-keyword-tracking="rankings" className="space-y-4">
            <form onSubmit={onSubmit} className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-medium text-foreground">Tracked keywords</h2>
                        <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                            Paste one keyword per line. Different spacing or capitalization of the same keyword is tracked once.
                        </p>
                    </div>
                    <p className="text-sm tabular-nums text-muted-foreground">{loading ? '…' : `${keywords.length} of ${cap}`}</p>
                </div>
                <label htmlFor={fieldId} className="mt-4 block text-sm font-medium text-foreground">Add keywords</label>
                <textarea
                    id={fieldId}
                    value={draft}
                    onChange={event => onDraft(event.target.value)}
                    rows={5}
                    placeholder="Paste keywords, one per line"
                    className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                        type="submit"
                        disabled={busy || loading || draft.trim().length === 0}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                    >
                        {busy ? 'Adding…' : 'Add keywords'}
                    </button>
                    {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
                </div>
                {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            </form>

            <div className="rounded-xl border border-border bg-card p-5">
                {loading ? <p role="status" className="text-sm text-muted-foreground">Loading tracked keywords…</p> : keywords.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tracked keywords yet</p>
                ) : (
                    <ul aria-label="Tracked keywords" className="divide-y divide-border">
                        {keywords.map(keyword => (
                            <li key={keyword.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                                <span className="text-foreground">{keyword.keyword}</span>
                                <span className="text-xs text-muted-foreground">{SOURCE_LABEL[keyword.source]}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {notes.length > 0 ? (
                <div className="rounded-xl border border-border bg-card p-5">
                    <h3 className="text-sm font-medium text-foreground">Notes</h3>
                    <ul aria-label="Tracking notes" className="mt-3 space-y-3">
                        {notes.map(note => (
                            <li key={note.id} className="text-sm">
                                <p className="text-xs text-muted-foreground">{NOTE_LABEL[note.kind]}</p>
                                <p className="mt-1 text-foreground">{note.body}</p>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </section>
    );
}
