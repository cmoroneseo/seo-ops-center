'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { loadTrackedKeywordGsc, type TrackedKeywordGscRow } from '@/lib/keyword-tracking/gsc-read';
import { splitKeywordPaste } from '@/lib/keyword-tracking/plan';
import {
    loadRankingWindows,
    rankingDistribution,
    rankingsDisplayRows,
    RANKING_POSITION_LABEL,
    type RankingsDisplayRow,
} from '@/lib/keyword-tracking/rankings';
import {
    addTrackedKeywords,
    loadRankings,
    type RankingsKeyword,
    type RankingsNote,
} from '@/lib/keyword-tracking/store';
import { formatSpan } from '@/lib/search-insights/view';

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

const CHANGE_TONE: Record<NonNullable<RankingsDisplayRow['change']>, string> = {
    New: 'text-foreground',
    Lost: 'text-muted-foreground',
    Improved: 'text-green-600',
    Declined: 'text-red-600',
    Unchanged: 'text-muted-foreground',
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
    const [rows, setRows] = useState<RankingsDisplayRow[]>([]);
    const [cap, setCap] = useState(50);
    const [draft, setDraft] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [gscNote, setGscNote] = useState('');
    const [periodLabel, setPeriodLabel] = useState('');
    const [compareLabel, setCompareLabel] = useState('');
    const [loading, setLoading] = useState(enabled);
    const [busy, setBusy] = useState(false);

    const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
        if (!keywordTrackingEnabled()) return;
        setLoading(true);
        setGscNote('');
        const snapshot = await loadRankings({ organizationId, clientId });
        if (isCancelled()) return;
        setKeywords(snapshot.keywords);
        setNotes(snapshot.notes);
        setCap(snapshot.cap);
        setError(snapshot.error ?? '');
        if (snapshot.keywords.length === 0 || snapshot.error) {
            setRows([]);
            setPeriodLabel('');
            setCompareLabel('');
            setLoading(false);
            return;
        }
        const period = await loadRankingWindows({ organizationId, clientId });
        if (isCancelled() || !period.enabled) {
            if (!isCancelled()) setLoading(false);
            return;
        }
        if (!period.ok) {
            setError(period.error);
            setRows(rankingsDisplayRows(snapshot.keywords, []));
            setLoading(false);
            return;
        }
        setPeriodLabel(`Last 28 days · ${formatSpan(period.current.start, period.current.end)}`);
        setCompareLabel(formatSpan(period.compare.start, period.compare.end));
        let gscRows: TrackedKeywordGscRow[] = [];
        if (period.connected) {
            const gsc = await loadTrackedKeywordGsc({
                organizationId,
                clientId,
                keywords: snapshot.keywords.map(keyword => ({ id: keyword.id, keyword: keyword.keyword })),
                current: period.current,
                compare: period.compare,
            });
            if (isCancelled() || !gsc.enabled) {
                if (!isCancelled()) setLoading(false);
                return;
            }
            if (!gsc.ok) {
                setError(gsc.error);
                setRows(rankingsDisplayRows(snapshot.keywords, []));
                setLoading(false);
                return;
            }
            gscRows = gsc.rows;
        } else {
            setGscNote('Search Console is not connected for this client.');
        }
        setRows(rankingsDisplayRows(snapshot.keywords, gscRows));
        setLoading(false);
    }, [organizationId, clientId]);

    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        refresh(() => cancelled);
        return () => {
            cancelled = true;
        };
    }, [enabled, refresh]);

    if (!enabled) return null;

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
            await refresh();
        }
        setMessage(result.message);
        setBusy(false);
    }

    return (
        <RankingsPanel
            keywords={keywords}
            notes={notes}
            rows={rows}
            cap={cap}
            draft={draft}
            message={message}
            error={error}
            gscNote={gscNote}
            periodLabel={periodLabel}
            compareLabel={compareLabel}
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
    rows = [],
    cap,
    draft,
    message,
    error,
    gscNote = '',
    periodLabel = '',
    compareLabel = '',
    loading,
    busy,
    onDraft,
    onSubmit,
}: {
    keywords: RankingsKeyword[];
    notes: RankingsNote[];
    rows?: RankingsDisplayRow[];
    cap: number;
    draft: string;
    message: string;
    error: string;
    gscNote?: string;
    periodLabel?: string;
    compareLabel?: string;
    loading: boolean;
    busy: boolean;
    onDraft: (value: string) => void;
    onSubmit: (event: FormEvent) => void;
}) {
    const fieldId = useId();
    const tableRows = rows.length > 0 || keywords.length === 0 ? rows : rankingsDisplayRows(keywords, []);
    const distribution = rankingDistribution(tableRows.map(row => row.position));
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
                    <>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-sm font-medium text-foreground">Rankings</h3>
                            <p className="text-xs text-muted-foreground">
                                <span>{RANKING_POSITION_LABEL}</span>
                                {periodLabel ? <span> · {periodLabel}</span> : null}
                                {compareLabel ? <span> vs {compareLabel}</span> : null}
                            </p>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Lower is better. Not measurable keywords are not in a band.</p>
                        {gscNote ? <p role="status" className="mt-2 text-sm text-muted-foreground">{gscNote}</p> : null}
                        <ul aria-label="Position distribution" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                            {distribution.map(band => (
                                <li key={band.id} data-distribution={band.id}>
                                    <p className="text-xs text-muted-foreground">{band.label}</p>
                                    <p className="font-semibold tabular-nums text-foreground">{band.count}</p>
                                </li>
                            ))}
                        </ul>
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full min-w-[52rem] border-collapse text-left text-sm" aria-label="Rankings">
                                <thead>
                                    <tr className="border-b border-border text-xs text-muted-foreground">
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Keyword</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Change</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Band</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{RANKING_POSITION_LABEL}</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Clicks</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Impressions</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Best URL</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableRows.map(row => (
                                        <tr key={row.id} className="border-b border-border" data-keyword={row.keyword}>
                                            <th scope="row" className="px-3 py-2 font-medium text-foreground">
                                                {row.keyword}
                                                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{SOURCE_LABEL[row.source]}</span>
                                            </th>
                                            <td className={`whitespace-nowrap px-3 py-2 ${row.change ? CHANGE_TONE[row.change] : 'text-muted-foreground'}`} data-change={row.change ?? 'none'} title={row.changeTitle}>
                                                {row.change ?? '—'}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-2 text-foreground" data-band={row.bandLabel ?? 'none'}>{row.bandLabel ?? '—'}</td>
                                            <td className="px-3 py-2 tabular-nums text-foreground" data-metric="position">{row.positionText}</td>
                                            <td className="px-3 py-2 tabular-nums text-foreground" data-metric="clicks">{row.clicksText}</td>
                                            <td className="px-3 py-2 tabular-nums text-foreground" data-metric="impressions">{row.impressionsText}</td>
                                            <td className="whitespace-nowrap px-3 py-2 text-foreground" data-metric="url">
                                                {row.bestUrl ? (
                                                    <a href={row.bestUrl} className="underline-offset-2 hover:underline" title={row.bestUrl}>{row.bestUrlText}</a>
                                                ) : row.bestUrlText}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
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
