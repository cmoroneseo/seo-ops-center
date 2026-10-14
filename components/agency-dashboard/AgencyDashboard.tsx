'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LayoutGrid, List, RefreshCw, Search } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { Sparkline } from '@/components/agency-dashboard/Sparkline';
import {
    DASHBOARD_RANGES,
    dashboardRangeLabel,
    type DashboardRange,
} from '@/lib/agency-dashboard/range';
import {
    METRICS,
    METRIC_LABEL,
    POSITION_LABEL_TITLE,
    cardTint,
    changeTone,
    compareCards,
    formatAbsolute,
    formatChange,
    formatMetric,
    type MetricKey,
    type SortMode,
} from '@/lib/agency-dashboard/metrics';
import { dashboardPortfolioPath, dashboardQueriesPath } from '@/lib/agency-dashboard/request';
import { filterCards, summarizeSelection, type DashboardCard, type DashboardModel } from '@/lib/agency-dashboard/portfolio';
import { cn } from '@/lib/utils';

interface LoadedQueries { queries: Array<{ query: string; clicks: number }>; reason: string | null }

const WASH: Record<'up' | 'down' | 'flat', string[]> = {
    flat: ['#16181d', '#16181d', '#16181d', '#16181d', '#16181d'],
    up: ['#16181d', '#15211c', '#123028', '#0e3a2c', '#0a4632'],
    down: ['#16181d', '#24181b', '#34191d', '#45181c', '#56151a'],
};

const TONE_TEXT = {
    up: 'text-emerald-300',
    down: 'text-rose-300',
    flat: 'text-zinc-400',
} as const;

export function AgencyDashboard() {
    const { organization } = useOrganization();
    const organizationId = organization?.id ?? null;
    const [range, setRange] = useState<DashboardRange>('28d');
    const [model, setModel] = useState<DashboardModel | null>(null);
    const shownKey = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refresh, setRefresh] = useState(0);

    useEffect(() => {
        if (!organizationId) return;
        const requestKey = `${organizationId}:${range}`;
        const controller = new AbortController();
        setLoading(true);
        setError(null);
        if (shownKey.current !== requestKey) setModel(null);
        fetch(dashboardPortfolioPath(range, organizationId), { cache: 'no-store', signal: controller.signal })
            .then(async response => {
                const body = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load the dashboard.');
                return body as DashboardModel;
            })
            .then(body => {
                if (controller.signal.aborted) return;
                shownKey.current = requestKey;
                setModel(body);
                setError(null);
            })
            .catch(reason => {
                if (controller.signal.aborted) return;
                shownKey.current = requestKey;
                setModel(null);
                setError(reason instanceof Error ? reason.message : 'Could not load the dashboard.');
            })
            .finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [range, refresh, organizationId]);

    const loadQueries = useCallback((clientId: string): Promise<LoadedQueries> => {
        if (!organizationId) return Promise.reject(new Error('Could not load queries.'));
        return fetch(dashboardQueriesPath(range, organizationId, clientId), { cache: 'no-store' }).then(async response => {
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Could not load queries.');
            const queries = Array.isArray(body.queries) ? body.queries.flatMap((item: { query?: unknown; clicks?: unknown }) => {
                if (typeof item?.query !== 'string' || typeof item.clicks !== 'number') return [];
                return [{ query: item.query, clicks: item.clicks }];
            }) : [];
            return { queries, reason: typeof body.reason === 'string' ? body.reason : null };
        });
    }, [organizationId, range]);

    return (
        <AgencyDashboardView
            model={model}
            loading={loading}
            error={error}
            range={range}
            organizationId={organizationId}
            onRange={setRange}
            onRefresh={() => setRefresh(value => value + 1)}
            onLoadQueries={loadQueries}
        />
    );
}

export function AgencyDashboardView({
    model,
    loading = false,
    error = null,
    range,
    onRange,
    onRefresh,
    organizationId = null,
    onLoadQueries,
    initialView = 'grid',
    initialQuery = '',
}: {
    model: DashboardModel | null;
    loading?: boolean;
    error?: string | null;
    range?: DashboardRange;
    onRange?: (range: DashboardRange) => void;
    onRefresh?: () => void;
    organizationId?: string | null;
    onLoadQueries?: (clientId: string) => Promise<LoadedQueries>;
    initialView?: 'grid' | 'list';
    initialQuery?: string;
}) {
    const activeRange = range ?? model?.range ?? '28d';
    const [metric, setMetric] = useState<MetricKey>('clicks');
    const [signal, setSignal] = useState<MetricKey>('impressions');
    const [sortMode, setSortMode] = useState<SortMode>('declines');
    const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
    const [view, setView] = useState<'grid' | 'list'>(initialView);
    const [query, setQuery] = useState(initialQuery);
    const [manager, setManager] = useState('');
    const [coverage, setCoverage] = useState<'all' | 'data' | 'missing'>('all');
    const [queryCache, setQueryCache] = useState<Record<string, LoadedQueries>>({});

    const rememberQueries = useCallback((clientId: string, loaded: LoadedQueries) => {
        setQueryCache(cache => ({ ...cache, [clientId]: loaded }));
    }, []);
    useEffect(() => {
        setQuery('');
        setManager('');
        setCoverage('all');
    }, [organizationId]);
    useEffect(() => { setQueryCache({}); }, [organizationId, activeRange]);

    const cards = useMemo(() => {
        const filtered = filterCards(model?.cards ?? [], { query, manager: manager || null, coverage });
        return [...filtered].sort((left, right) => compareCards(left, right, { mode: sortMode, metric, direction }));
    }, [model, query, manager, coverage, sortMode, metric, direction]);
    const selection = useMemo(() => model ? summarizeSelection(model, cards) : null, [model, cards]);

    function chooseMetric(next: MetricKey) {
        setMetric(next);
        if (sortMode === 'metric') setDirection(next === 'position' ? 'asc' : 'desc');
    }

    function sortByColumn(next: MetricKey) {
        if (metric === next && sortMode === 'metric') {
            setDirection(value => value === 'asc' ? 'desc' : 'asc');
            return;
        }
        setMetric(next);
        setSortMode('metric');
        setDirection(next === 'position' ? 'asc' : 'desc');
    }

    return (
        <div data-dashboard="agency" className="min-h-full rounded-2xl bg-[#0c0e12] p-4 text-zinc-100 sm:p-6" aria-busy={loading}>
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
                    <p className="mt-1 text-sm text-zinc-400">Search Console across active clients</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Date range" className="flex rounded-lg bg-white/5 p-0.5">
                        {DASHBOARD_RANGES.map(item => (
                            <button
                                key={item}
                                type="button"
                                aria-pressed={activeRange === item}
                                onClick={() => onRange?.(item)}
                                className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium', activeRange === item ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-zinc-200')}
                            >
                                {dashboardRangeLabel(item)}
                            </button>
                        ))}
                    </div>
                    <Field label="Metric">
                        <select aria-label="Metric" value={metric} onChange={event => chooseMetric(event.target.value as MetricKey)} className={selectClass}>
                            {METRICS.map(item => <option key={item} value={item}>{METRIC_LABEL[item]}</option>)}
                        </select>
                    </Field>
                    <Field label="Color">
                        <select aria-label="Color signal" value={signal} onChange={event => setSignal(event.target.value as MetricKey)} className={selectClass}>
                            {METRICS.map(item => <option key={item} value={item}>{METRIC_LABEL[item]}</option>)}
                        </select>
                    </Field>
                    <Field label="Sort">
                        <select
                            aria-label="Sort"
                            value={sortMode}
                            onChange={event => {
                                const next = event.target.value as SortMode;
                                setSortMode(next);
                                if (next === 'metric') setDirection(metric === 'position' ? 'asc' : 'desc');
                            }}
                            className={selectClass}
                        >
                            <option value="declines">Biggest declines</option>
                            <option value="metric">By {METRIC_LABEL[metric].toLowerCase()}</option>
                        </select>
                    </Field>
                    <label className="relative">
                        <span className="sr-only">Search clients</span>
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="Search"
                            className="h-9 w-36 rounded-lg border border-white/10 bg-white/5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                        />
                    </label>
                    <Field label="Manager">
                        <select aria-label="Account manager" value={manager} onChange={event => setManager(event.target.value)} className={selectClass}>
                            <option value="">All managers</option>
                            {(model?.managers ?? []).map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                    </Field>
                    <Field label="Data">
                        <select aria-label="Data coverage" value={coverage} onChange={event => setCoverage(event.target.value as 'all' | 'data' | 'missing')} className={selectClass}>
                            <option value="all">All clients</option>
                            <option value="data">With data</option>
                            <option value="missing">Missing data</option>
                        </select>
                    </Field>
                    <div role="group" aria-label="Layout" className="flex rounded-lg bg-white/5 p-0.5">
                        <button type="button" aria-pressed={view === 'grid'} aria-label="Grid" onClick={() => setView('grid')} className={cn('rounded-md p-1.5', view === 'grid' ? 'bg-white/15 text-white' : 'text-zinc-400')}>
                            <LayoutGrid className="h-4 w-4" />
                        </button>
                        <button type="button" aria-pressed={view === 'list'} aria-label="List" onClick={() => setView('list')} className={cn('rounded-md p-1.5', view === 'list' ? 'bg-white/15 text-white' : 'text-zinc-400')}>
                            <List className="h-4 w-4" />
                        </button>
                    </div>
                    <button type="button" aria-label="Refresh" onClick={onRefresh} className="rounded-lg border border-white/10 p-2 text-zinc-300 hover:bg-white/5">
                        <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                    </button>
                </div>
            </div>

            {error && <p role="alert" className="mt-4 rounded-lg border border-rose-400/30 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">{error}</p>}
            {loading && !model && !error && <p className="mt-8 text-sm text-zinc-400">Loading Search Console history…</p>}
            {model && !error && model.clientsConnected === 0 && (
                <p className="mt-8 text-sm text-zinc-400">No active clients have Google Search Console connected.</p>
            )}
            {model && !error && selection && model.clientsConnected > 0 && (
                cards.length === 0 ? (
                    <p className="mt-8 text-sm text-zinc-400">No clients match.</p>
                ) : (
                <>
                    <p className="mt-4 text-xs text-zinc-400">{selection.summary}{model.settling ? ' · includes days still settling' : ''}</p>
                    {selection.comparison && (
                        <p className="mt-1 text-xs text-zinc-500">{selection.comparison}</p>
                    )}
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {METRICS.map(item => {
                            const tone = changeTone(item, selection.kpis[item].change);
                            return (
                                <section key={item} className="rounded-xl border border-white/10 bg-[#16181d] p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-[11px] uppercase tracking-wide text-zinc-500" title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>{METRIC_LABEL[item]}</p>
                                            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMetric(item, selection.kpis[item].value)}</p>
                                            <p data-tone={tone} className={cn('mt-1 text-xs tabular-nums', TONE_TEXT[tone])} title={selection.comparison ?? undefined}>
                                                {formatChange(selection.kpis[item].change)}
                                                {selection.comparison && <span className="ml-1 text-zinc-400">{selection.pairedClients} of {selection.clientsWithData}</span>}
                                            </p>
                                        </div>
                                        <Sparkline values={selection.kpiSeries[item]} tone={tone} label={`${METRIC_LABEL[item]} trend`} />
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                    {view === 'grid' ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {cards.map((card, index) => (
                                <PortfolioCard key={`${card.clientId}:${activeRange}`} card={card} rank={index + 1} metric={metric} signal={signal} loaded={queryCache[card.clientId]} onLoadQueries={onLoadQueries} onLoaded={rememberQueries} />
                            ))}
                        </div>
                    ) : (
                        <PortfolioTable cards={cards} metric={metric} signal={signal} onSort={sortByColumn} queryCache={queryCache} />
                    )}
                </>
                )
            )}
        </div>
    );
}

function PortfolioCard({ card, rank, metric, signal, loaded, onLoadQueries, onLoaded }: { card: DashboardCard; rank: number; metric: MetricKey; signal: MetricKey; loaded?: LoadedQueries; onLoadQueries?: (clientId: string) => Promise<LoadedQueries>; onLoaded: (clientId: string, loaded: LoadedQueries) => void }) {
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [queryError, setQueryError] = useState<string | null>(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const open = hover || pinned;
    useEffect(() => {
        if (!open || card.queriesKnown || loaded || queryError || !onLoadQueries) return;
        let cancelled = false;
        setQueryLoading(true);
        onLoadQueries(card.clientId)
            .then(result => { if (!cancelled) onLoaded(card.clientId, result); })
            .catch(reason => { if (!cancelled) setQueryError(reason instanceof Error ? reason.message : 'Could not load queries.'); })
            .finally(() => { if (!cancelled) setQueryLoading(false); });
        return () => { cancelled = true; };
    }, [open, card.clientId, card.queriesKnown, loaded, queryError, onLoadQueries, onLoaded]);
    const tint = cardTint(signal, card.metrics[signal].change);
    const heroTone = changeTone(metric, card.metrics[metric].change);
    return (
        <article
            data-tone={tint.tone}
            data-strength={tint.strength}
            className="relative h-[292px] rounded-xl border border-white/10 [perspective:1200px]"
            style={{ backgroundColor: WASH[tint.tone][tint.strength] }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <div className={cn('relative h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none', open && '[transform:rotateY(180deg)]')}>
                <div className="absolute inset-0 flex flex-col p-4 [backface-visibility:hidden]" style={{ pointerEvents: open ? 'none' : 'auto' }}>
                    <div className="flex items-start justify-between gap-3">
                        <p className="text-xs tabular-nums text-zinc-500">{rank}</p>
                        <Sparkline values={card.series[metric]} tone={heroTone} label={`${card.name} ${METRIC_LABEL[metric]} trend`} />
                    </div>
                    <h2 className="mt-2 truncate text-base font-semibold">{card.name}</h2>
                    <p className="truncate text-xs text-zinc-400">{card.domain}{card.coverageLabel ? ` · ${card.coverageLabel}` : ''}</p>
                    {card.reason ? (
                        <p className="mt-4 text-3xl font-semibold text-zinc-500">— <span className="text-sm font-normal text-zinc-400">{card.reasonLabel}</span></p>
                    ) : (
                        <>
                            <p className="mt-3 text-3xl font-semibold tabular-nums tracking-tight">{formatMetric(metric, card.metrics[metric].value)}</p>
                            <p data-tone={heroTone} className={cn('text-sm tabular-nums', TONE_TEXT[heroTone])}>{formatChange(card.metrics[metric].change)}</p>
                        </>
                    )}
                    <div className="mt-auto grid grid-cols-3 gap-2 pt-3 text-xs">
                        <Stat label="Avg. position" metric="position" card={card} />
                        <Stat label="CTR" metric="ctr" card={card} />
                        <Stat label="Impressions" metric="impressions" card={card} />
                    </div>
                    <p className="mt-3 truncate text-[11px] text-zinc-400">{contextLine(card)}{card.syncWarning ? ` · ${card.syncWarning}` : ''}</p>
                    <button
                        type="button"
                        aria-expanded={open}
                        tabIndex={open ? -1 : 0}
                        aria-label={`Details for ${card.name}`}
                        onClick={() => setPinned(value => !value)}
                        className="absolute inset-0 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                    />
                </div>
                <div className="absolute inset-0 flex flex-col overflow-auto p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]" style={{ pointerEvents: open ? 'auto' : 'none' }}>
                    <div className="flex items-start justify-between gap-2">
                        <h2 className="truncate text-sm font-semibold">{card.name}</h2>
                        <button type="button" tabIndex={open ? 0 : -1} onClick={() => setPinned(false)} className="text-xs text-zinc-400 hover:text-zinc-200">Close</button>
                    </div>
                    {card.reason ? (
                        <p className="mt-4 text-sm text-zinc-300">— {card.reasonLabel}</p>
                    ) : (
                        <dl className="mt-3 space-y-1.5 text-xs">
                            {METRICS.map(item => {
                                const tone = changeTone(item, card.metrics[item].change);
                                return (
                                    <div key={item} className="flex items-baseline justify-between gap-2">
                                        <dt className="text-zinc-400">{METRIC_LABEL[item]}</dt>
                                        <dd className="text-right tabular-nums">
                                            <span>{formatMetric(item, card.metrics[item].value)}</span>
                                            <span data-tone={tone} className={cn('ml-2', TONE_TEXT[tone])}>{formatChange(card.metrics[item].change)}</span>
                                            <span className="ml-2 text-zinc-500">· {formatAbsolute(item, card.metrics[item].absolute)}</span>
                                        </dd>
                                    </div>
                                );
                            })}
                        </dl>
                    )}
                    <div className="mt-3">
                        <p className="text-[11px] uppercase tracking-wide text-zinc-500">Top queries</p>
                        <QueryList card={card} loaded={loaded} loading={queryLoading} error={queryError} />
                    </div>
                    <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 pt-3 text-xs">
                        <Link href={card.links.insights} tabIndex={open ? 0 : -1} className="text-emerald-300 underline-offset-2 hover:underline">Search Insights</Link>
                        <Link href={card.links.plan} tabIndex={open ? 0 : -1} className="text-emerald-300 underline-offset-2 hover:underline">SEO Plan</Link>
                        <a href={card.links.gsc} tabIndex={open ? 0 : -1} target="_blank" rel="noreferrer" className="text-emerald-300 underline-offset-2 hover:underline">Open in GSC</a>
                    </div>
                </div>
            </div>
        </article>
    );
}

function QueryList({ card, loaded, loading, error }: { card: DashboardCard; loaded?: LoadedQueries; loading: boolean; error: string | null }) {
    const queries = loaded?.queries ?? card.queries;
    const reason = error ?? loaded?.reason ?? card.queriesReason;
    if (queries.length > 0) {
        return (
            <ol className="mt-1 space-y-1 text-xs">
                {queries.map(query => (
                    <li key={query.query} className="flex justify-between gap-2">
                        <span className="truncate">{query.query}</span>
                        <span className="tabular-nums text-zinc-300">{formatMetric('clicks', query.clicks)}</span>
                    </li>
                ))}
            </ol>
        );
    }
    if (!card.queriesKnown && !loaded && !error) {
        return <p className="mt-1 text-xs text-zinc-500">{loading ? 'Loading queries…' : '— Open this card to load queries'}</p>;
    }
    return <p className="mt-1 text-xs text-zinc-500">— {reason ?? 'No queries with clicks in this range'}</p>;
}

function Stat({ label, metric, card }: { label: string; metric: MetricKey; card: DashboardCard }) {
    const tone = changeTone(metric, card.metrics[metric].change);
    return (
        <div>
            <p className="text-zinc-500" title={metric === 'position' ? POSITION_LABEL_TITLE : undefined}>{label}</p>
            <p className="mt-0.5 tabular-nums text-zinc-100">{formatMetric(metric, card.metrics[metric].value)}</p>
            <p data-tone={tone} className={cn('tabular-nums', TONE_TEXT[tone])}>{formatChange(card.metrics[metric].change)}</p>
        </div>
    );
}

function PortfolioTable({ cards, metric, signal, onSort, queryCache }: { cards: DashboardCard[]; metric: MetricKey; signal: MetricKey; onSort: (metric: MetricKey) => void; queryCache: Record<string, LoadedQueries> }) {
    return (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Client</th>
                        {METRICS.map(item => (
                            <th key={item} className="px-3 py-2 font-medium" title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>
                                <button type="button" onClick={() => onSort(item)} className={cn('hover:text-zinc-200', metric === item && 'text-zinc-100')} title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>
                                    {METRIC_LABEL[item]}
                                </button>
                            </th>
                        ))}
                        <th className="px-3 py-2 font-medium">Change</th>
                        <th className="px-3 py-2 font-medium">Manager</th>
                        <th className="px-3 py-2 font-medium">Hours</th>
                                <th className="px-3 py-2 font-medium">Phase</th>
                    </tr>
                </thead>
                <tbody>
                    {cards.map((card, index) => {
                        const tint = cardTint(signal, card.metrics[signal].change);
                        const tone = changeTone(metric, card.metrics[metric].change);
                        return (
                            <tr key={card.clientId} data-tone={tint.tone} className="border-t border-white/10" style={{ backgroundColor: WASH[tint.tone][Math.min(tint.strength, 2)] }}>
                                <td className="px-3 py-3 tabular-nums text-zinc-500">{index + 1}</td>
                                <td className="px-3 py-3">
                                    <div className="font-medium">{card.name}</div>
                                    <div className="text-xs text-zinc-400">{card.domain}{card.reasonLabel ? ` · ${card.reasonLabel}` : ''}</div>
                                    <QueryPreview card={card} loaded={queryCache[card.clientId]} />
                                    <div className="mt-1 flex gap-3 text-xs">
                                        <Link href={card.links.insights} className="text-emerald-300 hover:underline">Search Insights</Link>
                                        <Link href={card.links.plan} className="text-emerald-300 hover:underline">SEO Plan</Link>
                                        <a href={card.links.gsc} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">GSC</a>
                                    </div>
                                </td>
                                {METRICS.map(item => (
                                    <td key={item} className="px-3 py-3 tabular-nums">{formatMetric(item, card.metrics[item].value)}</td>
                                ))}
                                <td data-tone={tone} className={cn('px-3 py-3 tabular-nums', TONE_TEXT[tone])}>{formatChange(card.metrics[metric].change)}</td>
                                <td className="px-3 py-3 text-zinc-300">{card.accountManager ?? '—'}</td>
                                <td className="px-3 py-3 tabular-nums text-zinc-300">{card.hoursLabel}</td>
                                <td className="px-3 py-3 text-zinc-300">{card.phaseLabel ?? '—'}{!card.phaseLabel && card.phaseReason ? <div className="text-xs text-zinc-500">{card.phaseReason}</div> : null}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function QueryPreview({ card, loaded }: { card: DashboardCard; loaded?: LoadedQueries }) {
    const queries = loaded?.queries ?? card.queries;
    if (queries.length > 0) return <div className="mt-1 text-xs text-zinc-500">{queries.map(query => query.query).join(' · ')}</div>;
    const reason = loaded?.reason ?? card.queriesReason ?? (!card.queriesKnown && !loaded ? 'Open this card to load queries' : 'No queries with clicks in this range');
    return <div className="mt-1 text-xs text-zinc-500">— {reason}</div>;
}

function contextLine(card: DashboardCard): string {
    const phase = card.phaseLabel ?? (card.phaseReason ? `— ${card.phaseReason}` : null);
    return [card.accountManager ?? 'Unassigned', card.hoursLabel, phase].filter(Boolean).join(' · ');
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
            {label}
            {children}
        </label>
    );
}

const selectClass = 'h-9 rounded-lg border border-white/10 bg-[#16181d] px-2 text-sm normal-case tracking-normal text-zinc-100';
