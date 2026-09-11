'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { filterRankingCandidates, insightsRange, loadHistory, loadSearchInsights, safePageUrl, summarizePerformance } from '@/lib/gsc/insights';
import { historyDates } from '@/lib/gsc/history';

type LoadedHistory = Awaited<ReturnType<typeof loadHistory>>;
type LoadedInsights = Awaited<ReturnType<typeof loadSearchInsights>>;
const number = new Intl.NumberFormat('en-US');
const percent = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(2)}%`;

export function SearchInsightsTab({ clientId, clientName, onConnections }: { clientId: string; clientName: string; onConnections: () => void }) {
    const [period, setPeriod] = useState<7 | 28>(28);
    const [revision, setRevision] = useState(0);
    const [property, setProperty] = useState<LoadedHistory | null>(null);
    const [queries, setQueries] = useState<LoadedInsights | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [queryError, setQueryError] = useState('');
    const [filter, setFilter] = useState('');
    const [copied, setCopied] = useState('');
    const [copyError, setCopyError] = useState('');

    useEffect(() => {
        const controller = new AbortController();
        const range = insightsRange(period);
        setLoading(true); setProperty(null); setQueries(null); setError(''); setQueryError(''); setCopied('');
        // Property totals stay useful even if query evidence cannot be loaded.
        Promise.all([
            loadHistory(clientId, range, 'property', controller.signal).then(data => { if (!controller.signal.aborted) setProperty(data); }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }),
            loadSearchInsights(clientId, range, controller.signal).then(data => { if (!controller.signal.aborted) setQueries(data); }).catch(reason => { if (!controller.signal.aborted) setQueryError(reason.message); }),
        ]).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [clientId, period, revision]);

    const totals = useMemo(() => summarizePerformance(property?.rows ?? []), [property]);
    const complete = !!property && !!queries && !property.missingDates.length && !queries.missingDates.length && !queries.days.some(day => day.queryLimited) && property.property === queries.property && JSON.stringify(property.days) === JSON.stringify(queries.days);
    const candidates = useMemo(() => complete ? filterRankingCandidates(queries!.queryPageRollups, clientName) : [], [complete, queries, clientName]);
    const filtered = candidates.filter(item => `${item.query} ${item.page}`.toLowerCase().includes(filter.toLowerCase()));
    const chart = useMemo(() => {
        if (!property) return [];
        return historyDates(property.start, property.end).map(date => {
            const day = property.days.find(item => item.date === date);
            const rows = property.rows.filter(row => row.dayId === day?.id);
            return { date, clicks: day ? summarizePerformance(rows).clicks : null };
        });
    }, [property]);
    const lastImport = property?.days.map(day => day.importedAt).sort().at(-1);

    return <section className="space-y-6" aria-label="Search Insights">
        <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs uppercase tracking-widest text-primary">Search performance</p><h2 className="mt-1 text-2xl font-semibold">Search Insights</h2><p className="mt-1 text-sm text-muted-foreground">Find work worth investigating for {clientName}.</p></div>
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-lg border border-border p-1" aria-label="Reporting period">{([7, 28] as const).map(days => <button key={days} aria-pressed={period === days} onClick={() => setPeriod(days)} className={`rounded-md px-3 py-1.5 text-sm ${period === days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{days} days</button>)}</div>
                <button onClick={() => setRevision(value => value + 1)} disabled={loading} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Reload saved data</button>
            </div>
        </div>
        {error && <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-5"><p>{error}</p><button className="mt-3 text-sm text-primary underline" onClick={onConnections}>Manage Google Search Console connection</button></div>}
        {loading && !property && !error && <p role="status" className="rounded-xl border border-border bg-card p-8 text-muted-foreground">Loading saved search performance…</p>}
        {property && <>
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" />Selected Search Console property</p><p className="mt-2 break-all font-mono text-sm">{property.property}</p></div><button onClick={onConnections} className="text-sm text-primary underline">Manage connection</button></div>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>{property.start} – {property.end} · Pacific dates</span><span>{property.days.length}/{period} days saved</span><span>{lastImport ? `Latest import ${new Date(lastImport).toLocaleString()}` : 'Waiting for the first import'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Daily imports use finalized web-search data ending at least three days ago. Reload reads saved data.</p>
                {property.missingDates.length > 0 && <p role="status" className="mt-3 text-sm text-amber-600 dark:text-amber-400">{property.missingDates.length} days are missing. Totals cover saved days only; opportunity suggestions are paused until coverage is complete.</p>}
            </div>
            {property.days.length > 0 ? <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
                    ['Clicks', number.format(totals.clicks), 'Visits from Google Search'],
                    ['Impressions', number.format(totals.impressions), 'Search result appearances'],
                    ['CTR', percent(totals.ctr), 'Clicks divided by impressions'],
                    ['Average position', totals.position?.toFixed(1) ?? '—', 'Weighted by impressions'],
                ].map(([label, value, hint]) => <div key={label} className="rounded-xl border border-border bg-card p-5"><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-muted-foreground">{hint}</p></div>)}</div>
                <div className="rounded-xl border border-border bg-card p-5"><h3 className="font-medium">Daily clicks</h3><p className="mt-1 text-xs text-muted-foreground">Gaps indicate missing imports, not zero clicks.</p><div className="mt-4 h-56" role="img" aria-label={`Daily clicks from ${property.start} to ${property.end}. ${totals.clicks} total clicks across ${property.days.length} saved days. Daily values are available below.`}><ResponsiveContainer width="100%" height="100%"><LineChart data={chart}><CartesianGrid strokeDasharray="3 3" opacity={0.15} /><XAxis dataKey="date" tickFormatter={value => value.slice(5)} stroke="var(--muted-foreground)" fontSize={11} minTickGap={35} /><YAxis allowDecimals={false} width={35} stroke="var(--muted-foreground)" fontSize={11} /><Tooltip /><Line type="linear" dataKey="clicks" stroke="var(--primary)" strokeWidth={2} dot={false} connectNulls={false} /></LineChart></ResponsiveContainer></div><details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">View daily values</summary><div className="mt-2 max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th scope="col">Date</th><th scope="col">Clicks</th></tr></thead><tbody>{chart.map(row => <tr key={row.date}><td>{row.date}</td><td>{row.clicks ?? 'Missing'}</td></tr>)}</tbody></table></div></details></div>
            </> : <div className="rounded-xl border border-border bg-card p-8"><h3 className="font-medium">History is getting started</h3><p className="mt-2 text-sm text-muted-foreground">The daily import will collect history for this property. Performance and opportunities will appear as data arrives.</p></div>}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Ranking opportunities to review</h3><p className="mt-1 max-w-2xl text-sm text-muted-foreground">Queries with at least 100 impressions across 3 saved days and average positions 4–20. Ordered by observed impressions.</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">{complete ? `${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'}` : 'Awaiting evidence'}</span></div>
                <p className="mt-3 text-xs text-muted-foreground">Exact client-name brand matches and common utility pages are excluded. Brand variants may remain. These are research candidates; content gaps and ranking gains have not been established.</p>
                {queryError ? <p role="alert" className="mt-5 text-sm text-destructive">Query evidence unavailable: {queryError}</p> : loading ? <p role="status" className="mt-5 text-sm text-muted-foreground">Loading query evidence…</p> : !complete ? <p className="mt-5 text-sm text-muted-foreground">Suggestions are paused because history is incomplete, capped, or changed during loading. Reload after the next import.</p> : candidates.length === 0 ? <p className="mt-5 text-sm text-muted-foreground">No queries meet these evidence thresholds yet. This does not mean the site has no SEO opportunities.</p> : <>
                    <label className="mt-5 flex items-center gap-2 rounded-lg border border-border px-3 py-2"><Search className="h-4 w-4 text-muted-foreground" /><span className="sr-only">Filter by query or page</span><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter queries or pages" className="w-full bg-transparent text-sm outline-none" /></label>
                    <div className="mt-4 space-y-3">{filtered.slice(0, 50).map(item => <details key={JSON.stringify([item.query, item.page])} className="rounded-lg border border-border p-4"><summary className="cursor-pointer"><span className="font-medium">{item.query}</span><span className="mt-2 block break-all text-xs text-muted-foreground">{item.page}</span><span className="mt-2 block text-sm text-muted-foreground">{number.format(item.impressions)} impressions · Position {item.position.toFixed(1)} · {item.clicks} clicks · {percent(item.ctr)} CTR</span></summary><div className="mt-4 space-y-3 border-t border-border pt-4 text-sm"><p><strong>What we observed:</strong> This query appeared for this URL on {item.observedDays} saved days in the selected period.</p><p><strong>Next action:</strong> Inspect the current search results and landing page. Confirm the intended destination, search intent, and business value before deciding whether to improve this page.</p><p><strong>Evidence still needed:</strong> Current page content, competing results, and any other client pages targeting the same intent.</p><p><strong>Done when:</strong> The intended landing page and a specific change are documented with evidence, or the candidate is rejected with a reason.</p><div className="flex flex-wrap gap-4"><a href={safePageUrl(item.page)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary underline">Inspect page<ArrowUpRight className="h-4 w-4" /></a><button className="text-primary underline" onClick={async () => { try { await navigator.clipboard.writeText(`Investigate ranking opportunity: ${item.query}\nClient: ${clientName}\nProperty: ${property.property}\nPage: ${item.page}\nPeriod: ${property.start} to ${property.end}\nEvidence: ${item.impressions} impressions, ${item.clicks} clicks, average position ${item.position.toFixed(1)}, ${item.observedDays} observed days.\nReview current SERP, page content, intended destination, business value and overlapping pages. Document a specific evidence-backed change or reason to reject. No ranking gain is predicted.`); setCopied(JSON.stringify([item.query, item.page])); setCopyError(''); } catch { setCopyError('Clipboard unavailable. Select and copy the evidence above.'); } }}>{copied === JSON.stringify([item.query, item.page]) ? 'Brief copied' : 'Copy investigation brief'}</button></div></div></details>)}</div>
                    {!filtered.length && <p className="mt-4 text-sm text-muted-foreground">No candidates match your filter.</p>}
                    {filtered.length > 50 && <p className="mt-4 text-xs text-muted-foreground">Showing the first 50 of {filtered.length}. Refine your filter to find more.</p>}
                </>}
                {copyError && <p role="alert" className="mt-3 text-sm text-destructive">{copyError}</p>}
                <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">Google omits some queries. Query/page counts do not equal property totals. This view does not yet include crawl findings, task status, or AI-generated recommendations.</p>
            </div>
        </>}
    </section>;
}
