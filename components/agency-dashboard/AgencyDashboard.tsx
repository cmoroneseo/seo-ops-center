'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LayoutGrid, List, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import { useOrganization } from '@/components/providers/organization-provider';
import { SyncBingButton } from '@/components/settings/SyncBingButton';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { Sparkline } from '@/components/agency-dashboard/Sparkline';
import {
    CARD_METRIC_LABEL,
    cardMetricSearch,
    compareGa4Cards,
    formatCardCount,
    formatGa4Metric,
    GA4_CONNECT_LABEL,
    GA4_NOT_CONNECTED,
    GA4_UNAVAILABLE,
    ga4HeroKey,
    type CardMetric,
} from '@/lib/agency-dashboard/ga4';
import { ga4PropertyPickerHref } from '@/lib/agency-dashboard/ga4-link';
import {
    DASHBOARD_RANGES,
    dashboardRangeLabel,
    dashboardRangePhrase,
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
    formatChangeMagnitude,
    formatMetric,
    type MetricKey,
    type SortMode,
    type Tone,
} from '@/lib/agency-dashboard/metrics';
import { bingShareLabel, engineFace, engineHeadline, type EngineFace, type SearchEngine } from '@/lib/agency-dashboard/bing';
import { dashboardPortfolioPath, dashboardQueriesPath } from '@/lib/agency-dashboard/request';
import { activeFilterCount, filterCards, summarizeSelection, type DashboardCard, type DashboardModel } from '@/lib/agency-dashboard/portfolio';
import { cn } from '@/lib/utils';

interface LoadedQueries { queries: Array<{ query: string; clicks: number }>; reason: string | null }

const WASH: Record<'up' | 'down' | 'flat', string[]> = {
    flat: ['#14161b', '#14161b', '#14161b', '#14161b', '#14161b'],
    up: ['#14161b', '#15261e', '#12382a', '#0e4a34', '#0c5c40'],
    down: ['#14161b', '#2a1a1e', '#3d1a20', '#521820', '#67161e'],
};

const TONE_TEXT = {
    up: 'text-emerald-300',
    down: 'text-rose-300',
    flat: 'text-zinc-400',
} as const;

const BAR: Record<Tone, string> = {
    up: 'bg-emerald-400',
    down: 'bg-rose-400',
    flat: 'bg-zinc-500',
};

const KPI_DOT: Record<MetricKey, string> = {
    clicks: 'bg-emerald-400',
    impressions: 'bg-sky-400',
    ctr: 'bg-amber-400',
    position: 'bg-violet-400',
};

const SUPPORTING: MetricKey[] = ['position', 'ctr', 'impressions'];
const SUPPORTING_LABEL: Record<MetricKey, string> = {
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctr: 'CTR',
    position: 'Pos',
};

export function AgencyDashboard({
    ga4Cards = false,
    initialCardMetric = 'clicks',
}: {
    ga4Cards?: boolean;
    initialCardMetric?: CardMetric;
} = {}) {
    const { organization } = useOrganization();
    const { role } = useCurrentMember();
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
            canSyncBing={role === 'owner' || role === 'admin'}
            ga4Cards={ga4Cards}
            initialCardMetric={initialCardMetric}
        />
    );
}

function DashboardHistorySkeleton() {
    return (
        <div className="mt-8 space-y-4" role="status" aria-busy="true">
            <span className="sr-only">Loading Search Console history…</span>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="h-24 animate-pulse rounded-xl border border-white/10 bg-white/5" />
                ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="h-40 animate-pulse rounded-xl border border-white/10 bg-white/5" />
                ))}
            </div>
        </div>
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
    initialOpenClient = null,
    initialFiltersOpen = false,
    canSyncBing = false,
    initialEngine = 'google',
    ga4Cards = false,
    initialCardMetric = 'clicks',
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
    initialOpenClient?: string | null;
    initialFiltersOpen?: boolean;
    canSyncBing?: boolean;
    initialEngine?: SearchEngine;
    ga4Cards?: boolean;
    initialCardMetric?: CardMetric;
}) {
    const activeRange = range ?? model?.range ?? '28d';
    const [metric, setMetric] = useState<MetricKey>('clicks');
    const [cardMetric, setCardMetric] = useState<CardMetric>(initialCardMetric);
    const activeCardMetric: CardMetric = ga4Cards ? cardMetric : 'clicks';
    const [selectedEngine, setSelectedEngine] = useState<SearchEngine>(initialEngine);
    const [signal, setSignal] = useState<MetricKey>('impressions');
    const [sortMode, setSortMode] = useState<SortMode>('declines');
    const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
    const [view, setView] = useState<'grid' | 'list'>(initialView);
    const [query, setQuery] = useState(initialQuery);
    const [coverage, setCoverage] = useState<'all' | 'data' | 'missing'>('all');
    const [filtersOpen, setFiltersOpen] = useState(initialFiltersOpen);
    const [queryCache, setQueryCache] = useState<Record<string, LoadedQueries>>({});
    const filtersRef = useRef<HTMLDivElement>(null);

    const rememberQueries = useCallback((clientId: string, loaded: LoadedQueries) => {
        setQueryCache(cache => ({ ...cache, [clientId]: loaded }));
    }, []);
    useEffect(() => {
        setQuery('');
        setCoverage('all');
    }, [organizationId]);
    useEffect(() => { setQueryCache({}); }, [organizationId, activeRange]);
    useEffect(() => {
        if (!filtersOpen) return;
        function onPointer(event: MouseEvent) {
            if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
        }
        function onKey(event: KeyboardEvent) {
            if (event.key === 'Escape') setFiltersOpen(false);
        }
        document.addEventListener('mousedown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [filtersOpen]);

    const engine: SearchEngine = model?.bingEnabled ? selectedEngine : 'google';
    const cards = useMemo(() => {
        const filtered = filterCards(model?.cards ?? [], { query, coverage: engine === 'bing' ? 'all' : coverage });
        const visible = engine === 'bing'
            ? filtered.filter(card => {
                const gap = engineFace(card, 'bing').reason != null;
                if (coverage === 'data') return !gap;
                if (coverage === 'missing') return gap;
                return true;
            })
            : filtered;
        const heroKey = ga4HeroKey(activeCardMetric);
        return [...visible].sort((left, right) => {
            if (heroKey) return compareGa4Cards(left, right, heroKey, { mode: sortMode, direction });
            return compareCards(
                { name: left.name, reason: engineFace(left, engine).reason, metrics: engineFace(left, engine).metrics },
                { name: right.name, reason: engineFace(right, engine).reason, metrics: engineFace(right, engine).metrics },
                { mode: sortMode, metric, direction },
            );
        });
    }, [model, query, coverage, sortMode, metric, direction, engine, activeCardMetric]);
    const selection = useMemo(() => {
        if (!model) return null;
        const google = summarizeSelection(model, cards);
        return { ...google, ...engineHeadline(google, cards, engine) };
    }, [model, cards, engine]);
    const activeFilters = activeFilterCount({ signal, sortMode, coverage });
    const legend = `Card color: ${METRIC_LABEL[signal].toLowerCase()} vs previous ${dashboardRangePhrase(activeRange)}, deeper = bigger move`;

    function chooseMetric(next: MetricKey) {
        setMetric(next);
        if (sortMode === 'metric') setDirection(next === 'position' ? 'asc' : 'desc');
    }

    function chooseCardMetric(next: CardMetric) {
        setCardMetric(next);
        if (sortMode === 'metric') setDirection('desc');
        if (typeof window === 'undefined') return;
        const nextUrl = `${window.location.pathname}${cardMetricSearch(window.location.search, next)}`;
        window.history.replaceState(null, '', nextUrl);
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
                    <p className="mt-1 text-sm text-zinc-400">
                        {engine === 'bing' ? 'Bing Webmaster across active clients' : engine === 'all' ? 'Google and Bing across active clients' : 'Search Console across active clients'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {model?.bingEnabled && (
                        <div role="group" aria-label="Search engine" className="flex rounded-lg bg-white/5 p-0.5">
                            {(['google', 'bing', 'all'] as const).map(option => (
                                <button
                                    key={option}
                                    type="button"
                                    data-engine-option={option}
                                    aria-pressed={engine === option}
                                    onClick={() => setSelectedEngine(option)}
                                    className={cn('rounded-md px-2.5 py-1.5 text-xs font-medium', engine === option ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-zinc-200')}
                                >
                                    {option === 'google' ? 'Google' : option === 'bing' ? 'Bing' : 'All'}
                                </button>
                            ))}
                        </div>
                    )}
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
                    {!ga4Cards && (
                        <Field label="Metric">
                            <select aria-label="Metric" value={metric} onChange={event => chooseMetric(event.target.value as MetricKey)} className={selectClass}>
                                {METRICS.map(item => <option key={item} value={item}>{METRIC_LABEL[item]}</option>)}
                            </select>
                        </Field>
                    )}
                    {canSyncBing && <SyncBingButton variant="toolbar" onSynced={onRefresh} />}
                    <div className="flex items-center gap-2">
                    {ga4Cards && (
                        <div role="group" aria-label="Card metric" className="flex rounded-lg bg-white/5 p-0.5">
                            {(['clicks', 'organic-sessions', 'key-events'] as const).map(option => (
                                <button
                                    key={option}
                                    type="button"
                                    data-card-metric={option}
                                    aria-pressed={activeCardMetric === option}
                                    onClick={() => chooseCardMetric(option)}
                                    className={cn(
                                        'rounded-md px-3 py-1.5 text-xs font-medium',
                                        activeCardMetric === option ? 'bg-primary text-primary-foreground' : 'text-zinc-400 hover:text-zinc-200',
                                    )}
                                >
                                    {CARD_METRIC_LABEL[option]}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="relative" ref={filtersRef}>
                        <button
                            type="button"
                            aria-expanded={filtersOpen}
                            aria-controls="agency-filters"
                            aria-label={activeFilters > 0 ? `Filters, ${activeFilters} active` : 'Filters'}
                            data-active-filters={activeFilters}
                            onClick={() => setFiltersOpen(open => !open)}
                            className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm', filtersOpen && 'bg-white/10')}
                        >
                            <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                            Filters
                            {activeFilters > 0 && (
                                <span className="rounded-full bg-white/15 px-1.5 text-[11px] font-medium tabular-nums text-white">{activeFilters}</span>
                            )}
                        </button>
                        <div
                            id="agency-filters"
                            role="dialog"
                            aria-label="Filters"
                            hidden={!filtersOpen}
                            className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-white/10 bg-[#16181d] p-3 shadow-2xl"
                        >
                            <div className="space-y-3">
                                <FilterField label="Color">
                                    <select aria-label="Color signal" value={signal} onChange={event => setSignal(event.target.value as MetricKey)} className={cn(selectClass, 'w-full')}>
                                        {METRICS.map(item => <option key={item} value={item}>{METRIC_LABEL[item]}</option>)}
                                    </select>
                                </FilterField>
                                <FilterField label="Sort">
                                    <select
                                        aria-label="Sort"
                                        value={sortMode}
                                        onChange={event => {
                                            const next = event.target.value as SortMode;
                                            setSortMode(next);
                                            if (next === 'metric') setDirection(metric === 'position' ? 'asc' : 'desc');
                                        }}
                                        className={cn(selectClass, 'w-full')}
                                    >
                                        <option value="declines">Biggest declines</option>
                                        <option value="metric">By {(ga4HeroKey(activeCardMetric) ? CARD_METRIC_LABEL[activeCardMetric] : METRIC_LABEL[metric]).toLowerCase()}</option>
                                    </select>
                                </FilterField>
                                <FilterField label="Data">
                                    <select aria-label="Data coverage" value={coverage} onChange={event => setCoverage(event.target.value as 'all' | 'data' | 'missing')} className={cn(selectClass, 'w-full')}>
                                        <option value="all">All clients</option>
                                        <option value="data">With data</option>
                                        <option value="missing">Missing data</option>
                                    </select>
                                </FilterField>
                            </div>
                        </div>
                    </div>
                    </div>
                    <label className="relative">
                        <span className="sr-only">Search clients</span>
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                        <input
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            placeholder="Search"
                            className="h-9 w-40 rounded-lg border border-white/10 bg-white/5 pl-8 pr-2 text-sm text-zinc-100 placeholder:text-zinc-500"
                        />
                    </label>
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
            {loading && !model && !error && <DashboardHistorySkeleton />}
            {model && !error && model.clientsConnected === 0 && (
                <p className="mt-8 text-sm text-zinc-400">No active clients have Google Search Console connected.</p>
            )}
            {model && !error && selection && model.clientsConnected > 0 && (
                cards.length === 0 ? (
                    <p className="mt-8 text-sm text-zinc-400">No clients match.</p>
                ) : (
                <>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {METRICS.map(item => {
                            const tone = changeTone(item, selection.kpis[item].change);
                            return (
                                <section key={item} data-kpi={item} className="rounded-xl border border-white/10 bg-[#16181d] px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span aria-hidden className={cn('h-2 w-2 rounded-full', KPI_DOT[item])} />
                                        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400" title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>{METRIC_LABEL[item]}</p>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-3">
                                        <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatMetric(item, selection.kpis[item].value)}</p>
                                        <Sparkline values={selection.kpiSeries[item]} overlay={selection.overlay?.[item]} tone={tone} label={`${METRIC_LABEL[item]} trend`} className="h-11 w-28 shrink-0" />
                                    </div>
                                    <p data-tone={tone} className={cn('mt-2 text-sm font-medium tabular-nums', TONE_TEXT[tone])} title={selection.comparison ?? undefined}>
                                        <ChangeText metric={item} change={selection.kpis[item].change} />
                                    </p>
                                </section>
                            );
                        })}
                    </div>
                    <p data-meta="summary" className="mt-4 text-xs leading-5 text-zinc-400">
                        {selection.summary}{model.settling ? ' · includes days still settling' : ''}
                        {engine === 'all' ? ' · Dashed line is Bing' : ''}
                        {' · '}{legend}
                        {selection.comparison ? ` · ${selection.comparison}` : ''}
                    </p>
                    {view === 'grid' ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                            {cards.map(card => (
                                <PortfolioCard
                                    key={`${card.clientId}:${activeRange}`}
                                    card={card}
                                    engine={engine}
                                    metric={metric}
                                    signal={signal}
                                    loaded={queryCache[card.clientId]}
                                    initiallyOpen={initialOpenClient === card.clientId}
                                    onLoadQueries={onLoadQueries}
                                    onLoaded={rememberQueries}
                                    ga4Cards={ga4Cards}
                                    cardMetric={activeCardMetric}
                                    rangeLabel={dashboardRangeLabel(activeRange)}
                                />
                            ))}
                        </div>
                    ) : (
                        <PortfolioTable cards={cards} engine={engine} metric={metric} signal={signal} onSort={sortByColumn} queryCache={queryCache} ga4Cards={ga4Cards} cardMetric={activeCardMetric} />
                    )}
                </>
                )
            )}
        </div>
    );
}

function PortfolioCard({
    card,
    engine,
    metric,
    signal,
    loaded,
    initiallyOpen,
    onLoadQueries,
    onLoaded,
    ga4Cards = false,
    cardMetric = 'clicks',
    rangeLabel = '28D',
}: {
    card: DashboardCard;
    engine: SearchEngine;
    metric: MetricKey;
    signal: MetricKey;
    loaded?: LoadedQueries;
    initiallyOpen: boolean;
    onLoadQueries?: (clientId: string) => Promise<LoadedQueries>;
    onLoaded: (clientId: string, loaded: LoadedQueries) => void;
    ga4Cards?: boolean;
    cardMetric?: CardMetric;
    rangeLabel?: string;
}) {
    const [hover, setHover] = useState(false);
    const [pinned, setPinned] = useState(initiallyOpen);
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
    const face = engineFace(card, engine);
    const heroKey = ga4Cards ? ga4HeroKey(cardMetric) : null;
    const ga4Hero = heroKey && card.ga4?.mapped && !card.ga4.unavailable ? card.ga4.metrics[heroKey] : null;
    const tint = heroKey
        ? cardTint('clicks', ga4Hero?.change ?? null)
        : cardTint(signal, face.metrics[signal].change);
    const heroMetric: MetricKey = ga4Cards && cardMetric === 'clicks' ? 'clicks' : metric;
    const heroTone = heroKey ? changeTone('clicks', ga4Hero?.change ?? null) : changeTone(heroMetric, face.metrics[heroMetric].change);
    const share = engine === 'all' ? bingShareLabel(card) : null;
    return (
        <article
            data-client={card.clientId}
            data-tone={tint.tone}
            data-strength={tint.strength}
            className="relative h-[340px] rounded-2xl border border-white/10 [perspective:1200px]"
            style={{ backgroundColor: WASH[tint.tone][tint.strength] }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
        >
            <div className={cn('relative h-full transition-transform duration-500 [transform-style:preserve-3d] motion-reduce:transition-none', open && '[transform:rotateY(180deg)]')}>
                <div data-face="front" className="absolute inset-0 flex flex-col p-4 [backface-visibility:hidden]" style={{ pointerEvents: open ? 'none' : 'auto' }}>
                    {ga4Cards ? (
                        <MetricCardFront
                            card={card}
                            face={face}
                            cardMetric={cardMetric}
                            rangeLabel={rangeLabel}
                            heroTone={heroTone}
                            share={share}
                        />
                    ) : (
                        <>
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="truncate text-lg font-semibold tracking-tight">{card.name}</h2>
                                    <p className="truncate text-xs text-zinc-400">{card.domain}{face.coverageLabel ? ` · ${face.coverageLabel}` : ''}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                    {face.reason ? (
                                        <>
                                            <p className="text-3xl font-semibold leading-none text-zinc-500">—</p>
                                            <p className="mt-1 max-w-48 text-xs text-zinc-400" title={face.reasonTitle ?? undefined}>{face.reasonLabel}</p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-3xl font-semibold leading-none tabular-nums tracking-tight">{formatMetric(metric, face.metrics[metric].value)}</p>
                                            <div className="mt-1.5 flex justify-end">
                                                <ChangePill metric={metric} change={face.metrics[metric].change} note={face.changeNote} />
                                            </div>
                                            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">{METRIC_LABEL[metric]}</p>
                                        </>
                                    )}
                                </div>
                            </div>
                            {share && (
                                <p data-bing-share title={card.bing?.reasonTitle ?? undefined} className="mt-3 inline-flex w-fit rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-200">{share}</p>
                            )}
                            <div className="-mx-4 mt-2 flex min-h-0 flex-1 items-end">
                                <Sparkline values={face.series[metric]} overlay={face.overlay?.[metric]} tone={heroTone} label={`${card.name} ${METRIC_LABEL[metric]} trend`} className="h-20 w-full" stretch />
                            </div>
                            <div className="mt-2 grid grid-cols-3 gap-2">
                                {SUPPORTING.map(item => <Stat key={item} metric={item} view={face.metrics[item]} />)}
                            </div>
                        </>
                    )}
                    <button
                        type="button"
                        aria-expanded={open}
                        tabIndex={open ? -1 : 0}
                        aria-label={`Details for ${card.name}`}
                        onClick={() => setPinned(value => !value)}
                        className="absolute inset-0 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
                    />
                </div>
                <div data-face="back" className="absolute inset-0 flex flex-col overflow-auto rounded-2xl bg-[#0e1014] p-4 [backface-visibility:hidden] [transform:rotateY(180deg)]" style={{ pointerEvents: open ? 'auto' : 'none' }}>
                    <div className="flex items-start justify-between gap-2">
                        <h2 className="truncate text-sm font-semibold">{card.name}</h2>
                        <button type="button" tabIndex={open ? 0 : -1} onClick={() => setPinned(false)} className="text-xs text-zinc-400 hover:text-zinc-200">Close</button>
                    </div>
                    {engine === 'bing' ? (
                        <BingPanel card={card} />
                    ) : (
                        <>
                            {card.syncWarning && <p className="mt-1 text-[11px] text-zinc-400">{card.syncWarning}</p>}
                            {face.reason ? (
                                <p className="mt-4 text-sm text-zinc-300">— {face.reasonLabel}</p>
                            ) : (
                                <>
                                    {face.changeNote && <p className="mt-2 text-[11px] text-zinc-500">{face.changeNote}</p>}
                                    <DeltaList metrics={face.metrics} />
                                </>
                            )}
                            <div className="mt-3">
                                <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Top queries</p>
                                <QueryList card={card} loaded={loaded} loading={queryLoading} error={queryError} />
                            </div>
                            {engine === 'all' && <BingPanel card={card} />}
                        </>
                    )}
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

function MetricCardFront({
    card,
    face,
    cardMetric,
    rangeLabel,
    heroTone,
    share,
}: {
    card: DashboardCard;
    face: EngineFace;
    cardMetric: CardMetric;
    rangeLabel: string;
    heroTone: Tone;
    share: string | null;
}) {
    const heroKey = ga4HeroKey(cardMetric);
    const ga4 = card.ga4;
    const ga4Ready = heroKey && ga4 && ga4.mapped && !ga4.unavailable ? ga4 : null;
    const unmapped = Boolean(heroKey && ga4 && !ga4.unavailable && !ga4.mapped);
    const hero = ga4Ready && heroKey ? ga4Ready.metrics[heroKey] : null;
    const clicksHero = face.metrics.clicks;
    const value = heroKey ? (hero?.value ?? null) : clicksHero.value;
    const change = heroKey ? (hero?.change ?? null) : clicksHero.change;
    const note = heroKey ? (ga4Ready?.changeNote ?? null) : face.changeNote;
    const series = heroKey ? (ga4Ready ? ga4Ready.series[heroKey] : []) : face.series.clicks;
    const label = CARD_METRIC_LABEL[cardMetric];
    const formatted = heroKey ? formatGa4Metric(heroKey, value) : value == null ? '—' : formatCardCount(value);
    return (
        <>
            <h2 className="truncate text-lg font-semibold tracking-tight">{card.name}</h2>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400">{label} · {rangeLabel}</p>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <p data-hero className={cn('text-4xl font-semibold leading-none tracking-tight', value == null ? 'text-zinc-500' : 'tabular-nums')}>
                    {formatted}
                </p>
                {value != null && <ChangePill metric="clicks" change={change} note={note} />}
            </div>
            {!heroKey && share && (
                <p data-bing-share title={card.bing?.reasonTitle ?? undefined} className="mt-2 inline-flex w-fit rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-200">{share}</p>
            )}
            {!heroKey && face.reason ? (
                <p className="mt-4 flex-1 text-xs text-zinc-400" title={face.reasonTitle ?? undefined}>{face.reasonLabel}</p>
            ) : unmapped ? (
                <div data-ga4="unmapped" className="relative z-10 mt-4 flex flex-1 items-center justify-center rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-xs text-zinc-400">
                    {GA4_NOT_CONNECTED}
                    {' · '}
                    <Link href={ga4PropertyPickerHref(card.clientId)} className="text-zinc-300 underline-offset-2 hover:underline">
                        {GA4_CONNECT_LABEL}
                    </Link>
                </div>
            ) : heroKey && ga4?.unavailable ? (
                <p data-ga4="unavailable" className="mt-4 flex-1 text-xs text-zinc-500">{GA4_UNAVAILABLE}</p>
            ) : heroKey && value == null ? (
                <p className="mt-4 flex-1 text-xs text-zinc-500">No data in this range</p>
            ) : (
                <div className="-mx-4 mt-2 flex min-h-0 flex-1 items-end">
                    <Sparkline
                        values={series}
                        overlay={heroKey ? null : face.overlay?.clicks}
                        tone={heroTone}
                        label={`${card.name} ${label} trend`}
                        className="h-full min-h-28 w-full"
                        stretch
                        curve="monotone"
                    />
                </div>
            )}
            {!heroKey && face.coverageLabel && <p className="mt-1 text-xs text-zinc-500">{face.coverageLabel}</p>}
            <div className="mt-3 grid grid-cols-3 gap-2">
                {heroKey ? (
                    <>
                        <Ga4Stat label="Sessions" metric="sessions" value={ga4Ready ? ga4Ready.metrics.sessions.value : null} />
                        <Ga4Stat label="Engagement rate" metric="engagementRate" value={ga4Ready ? ga4Ready.metrics.engagementRate.value : null} />
                        <Ga4Stat label="Key events" metric="keyEvents" value={ga4Ready ? ga4Ready.metrics.keyEvents.value : null} />
                    </>
                ) : (
                    SUPPORTING.map(item => <Stat key={item} metric={item} view={face.metrics[item]} />)
                )}
            </div>
        </>
    );
}

function Ga4Stat({ label, metric, value }: { label: string; metric: 'sessions' | 'engagementRate' | 'keyEvents'; value: number | null }) {
    return (
        <div data-ga4-stat={metric}>
            <p className="text-sm font-semibold tabular-nums text-zinc-100">{formatGa4Metric(metric, value)}</p>
            <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</p>
        </div>
    );
}

function BingPanel({ card }: { card: DashboardCard }) {
    const bing = card.bing;
    if (!bing) return null;
    return (
        <div data-bing="panel" className="mt-3">
            <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">Bing</p>
            {bing.syncWarning && <p className="mt-1 text-[11px] text-zinc-400">{bing.syncWarning}</p>}
            {bing.reason ? (
                <p className="mt-1 text-xs text-zinc-300" title={bing.reasonTitle ?? undefined}>— {bing.reasonLabel}</p>
            ) : (
                <>
                    {bing.changeNote && <p className="mt-1 text-[11px] text-zinc-500">{bing.changeNote}</p>}
                    <BingRows title="Top queries" rows={bing.queries} reason={bing.queriesReason} note={bing.queriesNote} />
                    <BingRows title="Top pages" rows={bing.pages} reason={bing.pagesReason} note={bing.pagesNote} />
                </>
            )}
        </div>
    );
}

function BingRows({ title, rows, reason, note }: { title: string; rows: Array<{ label: string; clicks: number; impressions: number; position: number | null }>; reason: string | null; note: string | null }) {
    return (
        <div className="mt-2">
            <p className="text-[11px] uppercase tracking-[0.14em] text-zinc-500">{title}</p>
            {note && <p className="mt-1 text-[11px] text-zinc-500">{note}</p>}
            {rows.length > 0 ? (
                <ol className="mt-1 space-y-1 text-xs">
                    {rows.map((row, index) => (
                        <li key={`${row.label}:${index}`} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-2">
                            <span className="truncate">{row.label}</span>
                            <span className="tabular-nums text-zinc-300" title="Clicks">{formatMetric('clicks', row.clicks)}</span>
                            <span className="tabular-nums text-zinc-400" title="Impressions">{formatMetric('impressions', row.impressions)}</span>
                            <span className="tabular-nums text-zinc-400" title={row.position == null ? 'No impression position' : POSITION_LABEL_TITLE}>{formatMetric('position', row.position)}</span>
                        </li>
                    ))}
                </ol>
            ) : (
                <p className="mt-1 text-xs text-zinc-500">— {reason ?? 'No data in this range'}</p>
            )}
        </div>
    );
}

function DeltaList({ metrics }: { metrics: DashboardCard['metrics'] }) {
    const max = Math.max(0.02, ...METRICS.map(metric => Math.abs(metrics[metric].change ?? 0)));
    return (
        <dl className="mt-3 space-y-2.5">
            {METRICS.map(metric => {
                const change = metrics[metric].change;
                const tone = changeTone(metric, change);
                const width = change == null || change === 0 ? 0 : Math.max(8, Math.round((Math.abs(change) / max) * 100));
                return (
                    <div key={metric}>
                        <div className="flex items-baseline justify-between gap-2 text-xs">
                            <dt className="text-zinc-400">{METRIC_LABEL[metric]}</dt>
                            <dd className="text-right tabular-nums">
                                <span>{formatMetric(metric, metrics[metric].value)}</span>
                                <span className="ml-2 inline-flex"><ChangePill metric={metric} change={change} size="sm" /></span>
                                <span data-absolute className="ml-2 text-zinc-500">· {formatAbsolute(metric, metrics[metric].absolute)}</span>
                            </dd>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                            <div data-tone={tone} className={cn('h-full rounded-full', BAR[tone])} style={{ width: `${width}%` }} />
                        </div>
                    </div>
                );
            })}
        </dl>
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

function Stat({ metric, view }: { metric: MetricKey; view: DashboardCard['metrics'][MetricKey] }) {
    return (
        <div>
            <p className="text-sm font-semibold tabular-nums text-zinc-100">{formatMetric(metric, view.value)}</p>
            <div className="mt-1">
                <ChangePill metric={metric} change={view.change} size="sm" />
            </div>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500" title={metric === 'position' ? POSITION_LABEL_TITLE : undefined}>{SUPPORTING_LABEL[metric]}</p>
        </div>
    );
}

function ChangeText({ metric, change }: { metric: MetricKey; change: number | null }) {
    if (change == null || !Number.isFinite(change)) return '—';
    const tone = changeTone(metric, change);
    const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : null;
    return <>{arrow ? <span aria-hidden>{arrow} </span> : null}{formatChangeMagnitude(change)}</>;
}

function ChangePill({ metric, change, note, size = 'md' }: { metric: MetricKey; change: number | null; note?: string | null; size?: 'md' | 'sm' }) {
    if (change == null || !Number.isFinite(change)) {
        return (
            <span className={cn('text-zinc-500', size === 'sm' ? 'text-[11px]' : 'text-xs')}>
                —{note ? <span className="ml-1">{note}</span> : null}
            </span>
        );
    }
    const tone = changeTone(metric, change);
    const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : null;
    const direction = tone === 'up' ? 'Up' : tone === 'down' ? 'Down' : 'Flat';
    return (
        <span
            data-tone={tone}
            aria-label={`${direction} ${formatChangeMagnitude(change)}`}
            className={cn(
                'inline-flex items-center gap-1 rounded-full font-medium tabular-nums',
                size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
                tone === 'up' && 'bg-emerald-400/15 text-emerald-300',
                tone === 'down' && 'bg-rose-400/15 text-rose-300',
                tone === 'flat' && 'bg-white/10 text-zinc-300',
            )}
        >
            {arrow ? <span aria-hidden>{arrow}</span> : null}
            {formatChangeMagnitude(change)}
        </span>
    );
}

function PortfolioTable({ cards, engine, metric, signal, onSort, queryCache, ga4Cards = false, cardMetric = 'clicks' }: { cards: DashboardCard[]; engine: SearchEngine; metric: MetricKey; signal: MetricKey; onSort: (metric: MetricKey) => void; queryCache: Record<string, LoadedQueries>; ga4Cards?: boolean; cardMetric?: CardMetric }) {
    return (
        <div className="mt-4 overflow-x-auto rounded-xl border border-white/10">
            <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-white/5 text-xs uppercase tracking-wide text-zinc-500">
                    <tr>
                        <th className="px-3 py-2 font-medium">Client</th>
                        {METRICS.map(item => (
                            <th key={item} className="px-3 py-2 font-medium" title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>
                                <button type="button" onClick={() => onSort(item)} className={cn('hover:text-zinc-200', metric === item && 'text-zinc-100')} title={item === 'position' ? POSITION_LABEL_TITLE : undefined}>
                                    {METRIC_LABEL[item]}
                                </button>
                            </th>
                        ))}
                        <th className="px-3 py-2 font-medium">Change</th>
                    </tr>
                </thead>
                <tbody>
                        {cards.map(card => {
                        const face = engineFace(card, engine);
                        const heroKey = ga4Cards ? ga4HeroKey(cardMetric) : null;
                        const ga4Hero = heroKey && card.ga4?.mapped && !card.ga4.unavailable ? card.ga4.metrics[heroKey] : null;
                        const tint = heroKey
                            ? cardTint('clicks', ga4Hero?.change ?? null)
                            : cardTint(signal, face.metrics[signal].change);
                        const share = engine === 'all' ? bingShareLabel(card) : null;
                        const unmapped = Boolean(heroKey && card.ga4 && !card.ga4.unavailable && !card.ga4.mapped);
                        return (
                            <tr key={card.clientId} data-tone={tint.tone} className="border-t border-white/10" style={{ backgroundColor: WASH[tint.tone][Math.min(tint.strength, 2)] }}>
                                <td className="px-3 py-3">
                                    <div className="font-medium">{card.name}</div>
                                    <div className="text-xs text-zinc-400" title={engine === 'bing' ? face.reasonTitle ?? undefined : undefined}>{card.domain}{face.reasonLabel ? ` · ${face.reasonLabel}` : ''}</div>
                                    {heroKey && (
                                        <div data-ga4-list={unmapped ? 'unmapped' : 'value'} className="mt-1 text-xs text-zinc-300">
                                            {unmapped ? (
                                                <Link href={ga4PropertyPickerHref(card.clientId)} className="text-zinc-400 underline-offset-2 hover:underline">{GA4_CONNECT_LABEL}</Link>
                                            ) : (
                                                <span className="tabular-nums">{formatGa4Metric(heroKey, ga4Hero?.value ?? null)}</span>
                                            )}
                                        </div>
                                    )}
                                    {share && <div data-bing-share title={card.bing?.reasonTitle ?? undefined} className="mt-1 text-xs text-zinc-300">{share}</div>}
                                    <QueryPreview card={card} engine={engine} loaded={queryCache[card.clientId]} />
                                    <div className="mt-1 flex gap-3 text-xs">
                                        <Link href={card.links.insights} className="text-emerald-300 hover:underline">Search Insights</Link>
                                        <Link href={card.links.plan} className="text-emerald-300 hover:underline">SEO Plan</Link>
                                        <a href={card.links.gsc} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">GSC</a>
                                    </div>
                                </td>
                                {METRICS.map(item => (
                                    <td key={item} className="px-3 py-3 tabular-nums">{formatMetric(item, face.metrics[item].value)}</td>
                                ))}
                                <td className="px-3 py-3">
                                    {heroKey ? (
                                        <ChangePill metric="clicks" change={ga4Hero?.change ?? null} note={card.ga4?.changeNote} size="sm" />
                                    ) : (
                                        <ChangePill metric={metric} change={face.metrics[metric].change} note={face.changeNote} size="sm" />
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function QueryPreview({ card, engine, loaded }: { card: DashboardCard; engine: SearchEngine; loaded?: LoadedQueries }) {
    if (engine === 'bing' && card.bing) {
        if (card.bing.queries.length > 0) return <div className="mt-1 text-xs text-zinc-500">{card.bing.queries.map(query => query.label).join(' · ')}</div>;
        const reason = card.bing.queriesReason ?? card.bing.reasonLabel ?? 'No queries with clicks in this range';
        return <div className="mt-1 text-xs text-zinc-500">— {reason}</div>;
    }
    const queries = loaded?.queries ?? card.queries;
    if (queries.length > 0) return <div className="mt-1 text-xs text-zinc-500">{queries.map(query => query.query).join(' · ')}</div>;
    const reason = loaded?.reason ?? card.queriesReason ?? (!card.queriesKnown && !loaded ? 'Open this card to load queries' : 'No queries with clicks in this range');
    return <div className="mt-1 text-xs text-zinc-500">— {reason}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
            {label}
            {children}
        </label>
    );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
            {label}
            <div className="mt-1">{children}</div>
        </label>
    );
}

const selectClass = 'h-9 rounded-lg border border-white/10 bg-[#16181d] px-2 text-sm normal-case tracking-normal text-zinc-100';
