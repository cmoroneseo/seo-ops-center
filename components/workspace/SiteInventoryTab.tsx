'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, CircleGauge, ExternalLink, FileSearch, Loader2, Play, RefreshCw, Search, ShieldCheck } from 'lucide-react';

import type { HealthCategoryKey } from '@/lib/site-inventory/health';
import type { SiteCrawlRun, SiteInventoryPayload, SitePageObservation } from '@/lib/types';

const number = new Intl.NumberFormat('en-US');
const activeStatuses = new Set(['queued', 'running', 'paused']);

async function responseJson<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed');
    return body as T;
}

function statusTone(status: SitePageObservation['fetchStatus']) {
    if (status === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600';
    if (status === 'failed' || status === 'oversized') return 'border-red-500/30 bg-red-500/10 text-red-500';
    if (status === 'blocked') return 'border-amber-500/30 bg-amber-500/10 text-amber-600';
    return 'border-sky-500/30 bg-sky-500/10 text-sky-600';
}

function ScoreRing({ score, provisional }: { score: number; provisional: boolean }) {
    return <div
        className="grid h-36 w-36 shrink-0 place-items-center rounded-full p-3"
        style={{ background: `conic-gradient(var(--primary) ${score * 3.6}deg, var(--muted) 0)` }}
        role="img"
        aria-label={`Crawl Health ${score} out of 100${provisional ? ', provisional' : ''}`}
    >
        <div className="grid h-full w-full place-items-center rounded-full bg-card text-center shadow-inner">
            <div><div className="text-4xl font-semibold tabular-nums">{score}</div><div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{provisional ? 'Provisional' : 'Crawl health'}</div></div>
        </div>
    </div>;
}

function runLabel(run?: SiteCrawlRun) {
    if (!run) return 'Run first crawl';
    if (run.status === 'queued') return 'Begin crawl';
    if (run.status === 'running' || run.status === 'paused') return 'Resume crawl';
    return 'Run new crawl';
}

export function SiteInventoryTab({ clientId, clientName }: { clientId: string; clientName: string }) {
    const [inventory, setInventory] = useState<SiteInventoryPayload>();
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | SitePageObservation['fetchStatus']>('all');
    const [category, setCategory] = useState<HealthCategoryKey>();
    const [selectedId, setSelectedId] = useState<string>();

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await responseJson<SiteInventoryPayload>(await fetch(`/api/site-inventory?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
            setInventory(data);
            setSelectedId(current => current && data.pages.some(page => page.snapshotId === current) ? current : data.pages[0]?.snapshotId);
            setError('');
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to load site inventory');
        } finally { setLoading(false); }
    }, [clientId]);

    useEffect(() => { void load(); }, [load]);

    const continueRun = async (initial: SiteCrawlRun) => {
        let run = initial;
        while (activeStatuses.has(run.status)) {
            const result = await responseJson<{ run: SiteCrawlRun }>(await fetch(`/api/site-crawl/runs/${run.id}/process`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId }),
            }));
            run = result.run;
            await load();
        }
    };

    const handleCrawl = async () => {
        setWorking(true); setError('');
        try {
            const active = inventory?.activeRun;
            const run = active ?? (await responseJson<{ run: SiteCrawlRun }>(await fetch('/api/site-crawl/runs', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, urlLimit: 200 }),
            }))).run;
            await continueRun(run);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Unable to continue site crawl');
        } finally { setWorking(false); await load(); }
    };

    const deductionUrls = useMemo(() => category
        ? new Set(inventory?.health.categories.find(item => item.key === category)?.deductions.map(item => item.url) ?? [])
        : undefined, [category, inventory]);
    const pages = useMemo(() => (inventory?.pages ?? []).filter(page => {
        if (statusFilter !== 'all' && page.fetchStatus !== statusFilter) return false;
        if (deductionUrls && !deductionUrls.has(page.normalizedUrl)) return false;
        const needle = filter.trim().toLowerCase();
        return !needle || `${page.title ?? ''} ${page.normalizedUrl} ${page.h1s.join(' ')}`.toLowerCase().includes(needle);
    }), [inventory, statusFilter, deductionUrls, filter]);
    const selected = pages.find(page => page.snapshotId === selectedId) ?? pages[0];
    const completed = inventory?.latestCompletedRun;
    const score = inventory?.health.score;

    return <section className="space-y-5" aria-label="Site Inventory">
        <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
                <p className="text-xs uppercase tracking-[0.2em] text-primary">First-party crawl evidence</p>
                <h2 className="mt-1 text-2xl font-semibold">Site Inventory</h2>
                <p className="mt-1 text-sm text-muted-foreground">Observed pages and crawl conditions for {clientName}.</p>
            </div>
            <div className="flex gap-2">
                <button onClick={() => void load()} disabled={loading || working} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
                <button onClick={() => void handleCrawl()} disabled={working || loading} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                    {working ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{working ? 'Crawling…' : runLabel(inventory?.activeRun)}
                </button>
            </div>
        </header>

        {error && <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" /><div><p className="font-medium">Site inventory needs attention</p><p className="mt-1 text-muted-foreground">{error}</p></div></div>}
        {inventory?.activeRun && <div role="status" className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
            <div className="flex items-center justify-between gap-4"><span className="font-medium">Crawl {inventory.activeRun.status}</span><span className="tabular-nums text-muted-foreground">{inventory.activeRun.processedCount} / {inventory.activeRun.discoveredCount} observed</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, 100 * inventory.activeRun.processedCount / Math.max(1, inventory.activeRun.discoveredCount))}%` }} /></div>
            <p className="mt-2 text-xs text-muted-foreground">The crawl is resumable. Closing this page does not discard stored observations.</p>
            {inventory.activeRun.errorSummary && <p className="mt-2 text-xs text-amber-600">Evidence limitation: {inventory.activeRun.errorSummary}</p>}
        </div>}

        {!loading && !completed && !inventory?.activeRun && <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center"><FileSearch className="mx-auto h-8 w-8 text-primary" /><h3 className="mt-3 font-semibold">No site crawl yet</h3><p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">Run a bounded crawl to establish observed page identities, metadata, indexability signals, canonical signals, and internal-link evidence.</p></div>}

        {completed && score !== null && score !== undefined && <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
                <ScoreRing score={score} provisional={inventory!.health.provisional} />
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /><h3 className="text-lg font-semibold">Crawl Health overview</h3><span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">Latest completed crawl</span></div>
                    <p className="mt-2 text-sm text-muted-foreground">{completed.processedCount} of {completed.discoveredCount} discovered URLs classified · {new Date(completed.completedAt ?? completed.updatedAt).toLocaleString()}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                        {inventory!.health.categories.map(item => <button key={item.key} onClick={() => setCategory(current => current === item.key ? undefined : item.key)} aria-pressed={category === item.key} className={`rounded-xl border p-3 text-left transition-colors ${category === item.key ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'}`}>
                            <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{item.label}</span><ChevronRight className="h-3.5 w-3.5" /></div>
                            <p className="mt-2 text-lg font-semibold tabular-nums">{item.points === null ? '—' : `${item.points}/${item.maxPoints}`}</p>
                            <p className="text-[11px] text-muted-foreground">{item.deductions.length} affected URL{item.deductions.length === 1 ? '' : 's'}</p>
                        </button>)}
                    </div>
                    {inventory!.health.limitations.length > 0 && <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Evidence limitations</p><ul className="mt-1 list-disc space-y-1 pl-4">{inventory!.health.limitations.map(item => <li key={item}>{item}</li>)}</ul></div>}
                </div>
            </div>
        </div>}

        {completed && <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row">
                    <label className="relative flex-1"><span className="sr-only">Search pages</span><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search URL, title, or H1" className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary" /></label>
                    <select aria-label="Filter by crawl state" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="all">All observations</option><option value="success">Fetched</option><option value="blocked">Blocked</option><option value="failed">Failed</option><option value="unsupported">Unsupported</option><option value="oversized">Oversized</option><option value="js_unresolved">JavaScript unresolved</option>
                    </select>
                </div>
                <div className="max-h-[680px] divide-y divide-border overflow-y-auto" role="list" aria-label={`${pages.length} observed pages`}>
                    {pages.map(page => <button key={page.snapshotId} role="listitem" onClick={() => setSelectedId(page.snapshotId)} className={`grid w-full gap-2 p-4 text-left transition-colors sm:grid-cols-[auto_minmax(0,1fr)_auto] ${selected?.snapshotId === page.snapshotId ? 'bg-primary/5' : 'hover:bg-muted/40'}`}>
                        <span className={`h-fit rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusTone(page.fetchStatus)}`}>{page.fetchStatus.replaceAll('_', ' ')}</span>
                        <span className="min-w-0"><span className="block truncate text-sm font-medium">{page.title || 'No title observed'}</span><span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">{page.normalizedUrl}</span><span className="mt-1 block text-[11px] text-muted-foreground">{page.discoverySources.join(' · ') || 'Source unavailable'}</span></span>
                        <span className="text-right text-xs text-muted-foreground">{page.statusCode ?? '—'}<span className="mt-1 block">{number.format(page.wordCount ?? 0)} words</span></span>
                    </button>)}
                    {pages.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No pages match the current evidence filters.</p>}
                </div>
            </div>

            <aside className="h-fit rounded-2xl border border-border bg-card p-5 xl:sticky xl:top-4">
                {selected ? <>
                    <div className="flex items-center justify-between gap-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${statusTone(selected.fetchStatus)}`}>{selected.fetchStatus.replaceAll('_', ' ')}</span><a href={selected.normalizedUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" aria-label="Open observed URL"><ExternalLink className="h-4 w-4" /></a></div>
                    <h3 className="mt-4 text-lg font-semibold">{selected.title || 'No title observed'}</h3><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.normalizedUrl}</p>
                    <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">HTTP result</dt><dd className="mt-1 font-medium">{selected.statusCode ?? 'Not available'}</dd></div>
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Observed</dt><dd className="mt-1 font-medium">{new Date(selected.observedAt).toLocaleDateString()}</dd></div>
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Canonical signal</dt><dd className="mt-1 font-medium">{selected.canonicalIssue?.replaceAll('_', ' ') ?? 'Not available'}</dd></div>
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Words extracted</dt><dd className="mt-1 font-medium">{selected.wordCount === undefined ? 'Not available' : number.format(selected.wordCount)}</dd></div>
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">Internal links</dt><dd className="mt-1 font-medium">{selected.inboundInternalLinks} in · {selected.outboundInternalLinks} out</dd></div>
                        <div className="rounded-lg bg-muted/40 p-3"><dt className="text-xs text-muted-foreground">H1 observed</dt><dd className="mt-1 truncate font-medium">{selected.h1s[0] || 'None observed'}</dd></div>
                    </dl>
                    {selected.redirectHops.length > 0 && <div className="mt-4 rounded-lg border border-border p-3 text-xs"><p className="font-medium">Redirect observation</p><ol className="mt-2 list-decimal space-y-1 break-all pl-4 text-muted-foreground">{selected.redirectHops.map(url => <li key={url}>{url}</li>)}</ol></div>}
                    {selected.limitationFlags.length > 0 && <div className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /><span>{selected.limitationFlags.map(flag => flag.replaceAll('_', ' ')).join(' · ')}</span></div>}
                    <details className="mt-4 rounded-lg border border-border p-3 text-xs"><summary className="cursor-pointer font-medium">Observation history ({selected.history?.length ?? 1})</summary><ol className="mt-3 space-y-2">{(selected.history ?? [{ snapshotId: selected.snapshotId, observedAt: selected.observedAt, fetchStatus: selected.fetchStatus, statusCode: selected.statusCode }]).map(item => <li key={item.snapshotId} className="flex items-center justify-between gap-3 text-muted-foreground"><span>{new Date(item.observedAt).toLocaleString()}</span><span>{item.fetchStatus.replaceAll('_', ' ')} · {item.statusCode ?? '—'}</span></li>)}</ol></details>
                    <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">This is observed crawl evidence, not a recommendation or proof that a change is warranted.</p>
                </> : <div className="py-10 text-center text-sm text-muted-foreground"><CircleGauge className="mx-auto mb-3 h-6 w-6" />Select a page to inspect its evidence.</div>}
            </aside>
        </div>}
        {loading && !inventory && <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border p-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading site inventory…</div>}
        {completed?.capReached && <p className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />The crawl reached its {completed.urlLimit}-URL cap. The inventory must not be treated as complete.</p>}
        {completed?.errorSummary && <p className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5 text-amber-500" />Evidence limitation: {completed.errorSummary}</p>}
        {completed && !inventory?.health.provisional && <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />Every score category has eligible evidence from the latest completed crawl.</p>}
    </section>;
}
