'use client';

import { useCallback, useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';

import {
    BRAND_TERM_KINDS,
    BRAND_TERM_KIND_LABEL,
    splitBrandClicks,
    type BrandClickSplit,
    type BrandTermKind,
} from '@/lib/keyword-tracking/brand';
import { loadBrandClicks, type BrandClickMeasurement } from '@/lib/keyword-tracking/brand-clicks';
import {
    addBrandTerm,
    loadBrandTerms,
    removeBrandTerm,
    updateBrandTerm,
    type BrandTerm,
} from '@/lib/keyword-tracking/brand-store';
import {
    CANNIBAL_DEFINITION,
    formatCannibalHealth,
    unmeasuredCannibalization,
    type CannibalizationReport,
} from '@/lib/keyword-tracking/cannibalization';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import { loadTrackedKeywordGsc, type TrackedKeywordGscRow } from '@/lib/keyword-tracking/gsc-read';
import { splitKeywordPaste } from '@/lib/keyword-tracking/plan';
import {
    formatMeasuredCount,
    formatMeasuredPosition,
    loadRankingWindows,
    rankingDistribution,
    rankingUrlLabel,
    rankingsDisplayRows,
    RANKING_POSITION_DISPLAY,
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

type RankingsSection = 'keywords' | 'cannibalization';

const SECTIONS: { id: RankingsSection; label: string }[] = [
    { id: 'keywords', label: 'Keywords' },
    { id: 'cannibalization', label: 'Competing pages' },
];

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
    const [cannibalization, setCannibalization] = useState<CannibalizationReport | null>(null);
    const [cap, setCap] = useState(50);
    const [draft, setDraft] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [gscNote, setGscNote] = useState('');
    const [periodLabel, setPeriodLabel] = useState('');
    const [compareLabel, setCompareLabel] = useState('');
    const [loading, setLoading] = useState(enabled);
    const [busy, setBusy] = useState(false);
    const [terms, setTerms] = useState<BrandTerm[]>([]);
    const [termMessage, setTermMessage] = useState('');
    const [termError, setTermError] = useState('');
    const [termBusy, setTermBusy] = useState(false);
    const [measured, setMeasured] = useState<BrandClickMeasurement | null>(null);
    const [clickDetail, setClickDetail] = useState('');

    const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
        if (!keywordTrackingEnabled()) return;
        setLoading(true);
        setGscNote('');
        setMeasured(null);
        setClickDetail('');
        const [snapshot, termsResult] = await Promise.all([
            loadRankings({ organizationId, clientId }),
            loadBrandTerms({ organizationId, clientId }),
        ]);
        if (isCancelled()) return;
        setKeywords(snapshot.keywords);
        setNotes(snapshot.notes);
        setCap(snapshot.cap);
        setError(snapshot.error ?? '');
        if (termsResult.ok) {
            setTerms(termsResult.terms);
            setTermError('');
        } else {
            setTerms([]);
            setTermError(termsResult.error);
            setTermMessage('');
        }
        const period = await loadRankingWindows({ organizationId, clientId });
        if (isCancelled() || !period.enabled) {
            if (!isCancelled()) setLoading(false);
            return;
        }
        if (!period.ok) {
            if (!snapshot.error) setError(period.error);
            setRows(snapshot.keywords.length === 0 ? [] : rankingsDisplayRows(snapshot.keywords, []));
            setCannibalization(snapshot.keywords.length === 0 ? null : unmeasuredCannibalization(snapshot.keywords.length));
            setPeriodLabel('');
            setCompareLabel('');
            setLoading(false);
            return;
        }
        setPeriodLabel(`Last 28 days · ${formatSpan(period.current.start, period.current.end)}`);
        setCompareLabel(formatSpan(period.compare.start, period.compare.end));
        if (!termsResult.ok) {
            setMeasured(null);
        } else if (!period.connected) {
            setGscNote('Search Console is not connected for this client.');
            setMeasured(null);
        } else {
            const clicks = await loadBrandClicks({
                organizationId,
                clientId,
                window: period.current,
            });
            if (isCancelled() || !clicks.enabled) {
                if (!isCancelled()) setLoading(false);
                return;
            }
            if (!clicks.ok) {
                if (!snapshot.error) setError(clicks.error);
                setMeasured(null);
            } else if (!clicks.connected) {
                setGscNote('Search Console is not connected for this client.');
                setMeasured(null);
            } else {
                setMeasured(clicks.measurement);
                setClickDetail(clicks.detail);
            }
        }
        if (snapshot.keywords.length === 0 || snapshot.error) {
            setRows([]);
            setCannibalization(null);
            setLoading(false);
            return;
        }
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
                setCannibalization(unmeasuredCannibalization(snapshot.keywords.length));
                setLoading(false);
                return;
            }
            gscRows = gsc.rows;
            setCannibalization(gsc.cannibalization);
        } else {
            setGscNote('Search Console is not connected for this client.');
            setCannibalization(unmeasuredCannibalization(snapshot.keywords.length));
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

    async function onAddTerm(term: string, kind: BrandTermKind) {
        if (!keywordTrackingEnabled() || termBusy) return false;
        setTermBusy(true);
        setTermMessage('');
        const result = await addBrandTerm({ organizationId, clientId, term, kind });
        setTermMessage(result.message);
        if (result.ok) await refresh();
        setTermBusy(false);
        return result.ok;
    }

    async function onUpdateTerm(id: string, term: string, kind: BrandTermKind) {
        if (!keywordTrackingEnabled() || termBusy) return false;
        setTermBusy(true);
        setTermMessage('');
        const result = await updateBrandTerm({ organizationId, clientId, id, term, kind });
        setTermMessage(result.message);
        if (result.ok) await refresh();
        setTermBusy(false);
        return result.ok;
    }

    async function onRemoveTerm(id: string) {
        if (!keywordTrackingEnabled() || termBusy) return false;
        setTermBusy(true);
        setTermMessage('');
        const result = await removeBrandTerm({ organizationId, clientId, id });
        setTermMessage(result.message);
        if (result.ok) await refresh();
        setTermBusy(false);
        return result.ok;
    }

    const clickSplit = measured
        ? splitBrandClicks({
            propertyClicks: measured.propertyClicks,
            queries: measured.queries,
            terms,
            overrides: measured.overrides,
        })
        : null;

    return (
        <RankingsPanel
            keywords={keywords}
            notes={notes}
            rows={rows}
            cannibalization={cannibalization}
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
            terms={terms}
            termMessage={termMessage}
            termError={termError}
            termBusy={termBusy}
            clickSplit={clickSplit}
            clickDetail={clickDetail}
            onAddTerm={onAddTerm}
            onUpdateTerm={onUpdateTerm}
            onRemoveTerm={onRemoveTerm}
        />
    );
}

export function RankingsPanel({
    keywords,
    notes,
    rows = [],
    cannibalization = null,
    initialSection = 'keywords',
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
    terms = [],
    termMessage = '',
    termError = '',
    termBusy = false,
    clickSplit = null,
    clickDetail = '',
    onAddTerm = () => false,
    onUpdateTerm = () => false,
    onRemoveTerm = () => false,
}: {
    keywords: RankingsKeyword[];
    notes: RankingsNote[];
    rows?: RankingsDisplayRow[];
    cannibalization?: CannibalizationReport | null;
    initialSection?: RankingsSection;
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
    terms?: BrandTerm[];
    termMessage?: string;
    termError?: string;
    termBusy?: boolean;
    clickSplit?: BrandClickSplit | null;
    clickDetail?: string;
    onAddTerm?: (term: string, kind: BrandTermKind) => boolean | Promise<boolean>;
    onUpdateTerm?: (id: string, term: string, kind: BrandTermKind) => boolean | Promise<boolean>;
    onRemoveTerm?: (id: string) => boolean | Promise<boolean>;
}) {
    const fieldId = useId();
    const [section, setSection] = useState<RankingsSection>(initialSection);
    const tableRows = rows.length > 0 || keywords.length === 0 ? rows : rankingsDisplayRows(keywords, []);
    const distribution = rankingDistribution(tableRows.map(row => row.position));
    const report = cannibalization ?? unmeasuredCannibalization(keywords.length);
    function onSectionKey(event: KeyboardEvent<HTMLDivElement>) {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const next: RankingsSection = section === 'keywords' ? 'cannibalization' : 'keywords';
        setSection(next);
        document.getElementById(`rankings-section-${next}`)?.focus();
    }
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

            <BrandTermsCard
                terms={terms}
                loading={loading}
                busy={termBusy}
                message={termMessage}
                error={termError}
                onAdd={onAddTerm}
                onUpdate={onUpdateTerm}
                onRemove={onRemoveTerm}
            />

            <BrandClickSummary
                loading={loading}
                split={clickSplit}
                periodLabel={periodLabel}
                detail={clickDetail}
                note={gscNote}
            />

            <div className="rounded-xl border border-border bg-card p-5">
                {loading ? <p role="status" className="text-sm text-muted-foreground">Loading tracked keywords…</p> : keywords.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tracked keywords yet</p>
                ) : (
                    <>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <h3 className="text-sm font-medium text-foreground">Rankings</h3>
                            <p className="text-xs text-muted-foreground">
                                {section === 'keywords' ? <span>{RANKING_POSITION_DISPLAY}</span> : null}
                                {periodLabel ? <span>{section === 'keywords' ? ' · ' : ''}{periodLabel}</span> : null}
                                {section === 'keywords' && compareLabel ? <span> vs {compareLabel}</span> : null}
                            </p>
                        </div>
                        <div role="tablist" aria-label="Rankings views" className="mt-4 flex gap-1 border-b border-border" onKeyDown={onSectionKey}>
                            {SECTIONS.map(item => (
                                <button
                                    key={item.id}
                                    id={`rankings-section-${item.id}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={section === item.id}
                                    aria-controls={`rankings-panel-${item.id}`}
                                    tabIndex={section === item.id ? 0 : -1}
                                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${section === item.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                                    onClick={() => setSection(item.id)}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                        {section === 'cannibalization' ? (
                            <div id="rankings-panel-cannibalization" role="tabpanel" aria-labelledby="rankings-section-cannibalization" className="mt-4">
                                <CannibalizationView report={report} />
                            </div>
                        ) : (
                        <div id="rankings-panel-keywords" role="tabpanel" aria-labelledby="rankings-section-keywords">
                        <p className="mt-3 text-xs text-muted-foreground">Lower is better. Not measurable keywords are not in a band.</p>
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
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{RANKING_POSITION_DISPLAY}</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Clicks</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Times shown</th>
                                        <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Best page</th>
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
                        </div>
                        )}
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

export function BrandClickSummary({
    loading,
    split,
    periodLabel,
    detail,
    note,
}: {
    loading: boolean;
    split: BrandClickSplit | null;
    periodLabel: string;
    detail: string;
    note: string;
}) {
    const cells = [
        { id: 'branded', label: 'Branded', value: split?.branded },
        { id: 'non-branded', label: 'Non-branded', value: split?.nonBranded },
        { id: 'unattributed', label: 'Unattributed', value: split?.unattributed },
    ] as const;
    return (
        <section aria-label="Search Console clicks" data-brand-clicks="panel" className="rounded-xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-medium text-foreground">Search Console clicks</h2>
                {periodLabel ? <p className="text-xs text-muted-foreground">{periodLabel}</p> : null}
            </div>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                Branded queries contain a brand term. Unattributed is property clicks minus visible query clicks.
            </p>
            {note ? <p role="status" className="mt-2 text-sm text-muted-foreground">{note}</p> : null}
            {detail ? <p className="mt-2 text-sm text-muted-foreground">{detail}</p> : null}
            <ul aria-label="Branded and unattributed clicks" className="mt-3 grid grid-cols-3 gap-2">
                {cells.map(cell => (
                    <li key={cell.id} data-split={cell.id}>
                        <p className="text-xs text-muted-foreground">{cell.label}</p>
                        <p
                            className="font-semibold tabular-nums text-foreground"
                            data-metric={cell.id}
                            title={cell.id === 'unattributed' ? 'Property clicks minus visible query clicks' : undefined}
                        >
                            {loading ? '…' : formatMeasuredCount(cell.value ?? null)}
                        </p>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function BrandTermsCard({
    terms,
    loading,
    busy,
    message,
    error,
    onAdd,
    onUpdate,
    onRemove,
}: {
    terms: BrandTerm[];
    loading: boolean;
    busy: boolean;
    message: string;
    error: string;
    onAdd: (term: string, kind: BrandTermKind) => boolean | Promise<boolean>;
    onUpdate: (id: string, term: string, kind: BrandTermKind) => boolean | Promise<boolean>;
    onRemove: (id: string) => boolean | Promise<boolean>;
}) {
    const fieldId = useId();
    const kindId = useId();
    const [draft, setDraft] = useState('');
    const [kind, setKind] = useState<BrandTermKind>('brand');

    async function onSubmit(event: FormEvent) {
        event.preventDefault();
        if (busy) return;
        const saved = await onAdd(draft, kind);
        if (saved) setDraft('');
    }

    return (
        <section aria-label="Brand terms" data-brand-terms="panel" className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-medium text-foreground">Brand terms</h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                A query is branded when it contains one of these terms. Misspellings, owner names, and product names count the same way.
            </p>
            <form onSubmit={onSubmit} className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                    <label htmlFor={fieldId} className="text-sm font-medium text-foreground">Term</label>
                    <input
                        id={fieldId}
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        placeholder="Add a term"
                        className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    />
                </div>
                <div>
                    <label htmlFor={kindId} className="text-sm font-medium text-foreground">Type</label>
                    <select
                        id={kindId}
                        value={kind}
                        onChange={event => { if (isKind(event.target.value)) setKind(event.target.value); }}
                        className="mt-2 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    >
                        {BRAND_TERM_KINDS.map(item => <option key={item} value={item}>{BRAND_TERM_KIND_LABEL[item]}</option>)}
                    </select>
                </div>
                <button
                    type="submit"
                    disabled={busy || draft.trim().length === 0}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Add term'}
                </button>
            </form>
            {message ? <p role="status" className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
            {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            {loading && terms.length === 0 ? <p role="status" className="mt-4 text-sm text-muted-foreground">Loading brand terms…</p> : terms.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">No brand terms yet.</p>
            ) : (
                <ul aria-label="Saved brand terms" className="mt-4 space-y-3">
                    {terms.map(term => (
                        <BrandTermRow key={`${term.id}:${term.term}:${term.kind}`} term={term} busy={busy} onUpdate={onUpdate} onRemove={onRemove} />
                    ))}
                </ul>
            )}
        </section>
    );
}

function isKind(value: string): value is BrandTermKind {
    return (BRAND_TERM_KINDS as readonly string[]).includes(value);
}

function BrandTermRow({
    term,
    busy,
    onUpdate,
    onRemove,
}: {
    term: BrandTerm;
    busy: boolean;
    onUpdate: (id: string, term: string, kind: BrandTermKind) => boolean | Promise<boolean>;
    onRemove: (id: string) => boolean | Promise<boolean>;
}) {
    const fieldId = useId();
    const [text, setText] = useState(term.term);
    const [kind, setKind] = useState<BrandTermKind>(term.kind);
    const dirty = text !== term.term || kind !== term.kind;

    async function save(event?: FormEvent) {
        event?.preventDefault();
        if (busy || !dirty) return;
        await onUpdate(term.id, text, kind);
    }

    function onKey(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === 'Escape') {
            setText(term.term);
            setKind(term.kind);
        }
    }

    return (
        <li data-brand-term={term.term} data-brand-kind={term.kind} className="flex flex-wrap items-end gap-2">
            <form onSubmit={save} className="flex min-w-0 flex-1 flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                    <label htmlFor={fieldId} className="sr-only">Edit {term.term}</label>
                    <input
                        id={fieldId}
                        value={text}
                        onChange={event => setText(event.target.value)}
                        onKeyDown={onKey}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    />
                </div>
                <select
                    aria-label={`Type for ${term.term}`}
                    value={kind}
                    onChange={event => { if (isKind(event.target.value)) setKind(event.target.value); }}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                    {BRAND_TERM_KINDS.map(item => <option key={item} value={item}>{BRAND_TERM_KIND_LABEL[item]}</option>)}
                </select>
                <button
                    type="submit"
                    disabled={busy || !dirty}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground disabled:opacity-50"
                >
                    Save
                </button>
            </form>
            <button
                type="button"
                disabled={busy}
                onClick={() => { void onRemove(term.id); }}
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground disabled:opacity-50"
            >
                Remove
            </button>
        </li>
    );
}

export function CannibalizationView({ report }: { report: CannibalizationReport }) {
    const health = formatCannibalHealth(report.health);
    const showAffected = report.health != null && report.affected != null && report.affected > 0;
    return (
        <div data-cannibalization="panel">
            <p className="text-sm text-foreground">
                <span className="text-muted-foreground">Keywords with one main page: </span>
                <span className="font-semibold tabular-nums" data-metric="health">{health}</span>
            </p>
            {showAffected ? (
                <p className="mt-1 text-xs text-muted-foreground" data-metric="affected">
                    {report.affected} of {report.tracked} tracked keywords show on more than one page
                </p>
            ) : null}
            {report.health != null && report.keywords.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No pages are competing for the same search.</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">{CANNIBAL_DEFINITION}</p>
            {report.keywords.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[52rem] border-collapse text-left text-sm" aria-label="Competing pages">
                        <thead>
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Keyword</th>
                                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Page</th>
                                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Times shown</th>
                                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">Clicks</th>
                                <th scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{RANKING_POSITION_DISPLAY}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.keywords.flatMap(keyword => keyword.urls.map(url => (
                                <tr key={`${keyword.id}:${url.url}`} className="border-b border-border" data-keyword={keyword.keyword} data-url={url.url}>
                                    <th scope="row" className="px-3 py-2 font-medium text-foreground">{keyword.keyword}</th>
                                    <td className="whitespace-nowrap px-3 py-2 text-foreground" data-metric="url">
                                        <a href={url.url} className="underline-offset-2 hover:underline" title={url.url}>{rankingUrlLabel(url.url)}</a>
                                    </td>
                                    <td className="px-3 py-2 tabular-nums text-foreground" data-metric="impressions">{formatMeasuredCount(url.impressions)}</td>
                                    <td className="px-3 py-2 tabular-nums text-foreground" data-metric="clicks">{formatMeasuredCount(url.clicks)}</td>
                                    <td className="px-3 py-2 tabular-nums text-foreground" data-metric="position">{formatMeasuredPosition(url.avgPosition)}</td>
                                </tr>
                            )))}
                        </tbody>
                    </table>
                </div>
            ) : null}
        </div>
    );
}
