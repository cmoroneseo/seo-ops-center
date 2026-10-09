import type { GscDevice } from '@/lib/gsc/history';
import { resolveFreshness } from '@/lib/reporting/freshness';
import { STATES_COPY } from '@/lib/reporting/states-copy';
import { buildCityRows, type CityQuery } from './cities';
import { dayIndex, sumMetrics } from './metrics';
import { buildMovers } from './movers';
import { buildPageRows } from './pages';
import { GSC_SOURCE, METHODS, blockComparison, distortionComparison, latestSync, receipt } from './provenance';
import { investigationsFor, positionBands } from './queries';
import { comparisonDistortion, coverWindow, finalDates, parseRange, resolveRange } from './range';
import { pointsFor, type DatedMetric } from './summary';
import { DFS_SPOT_CHECK_SLOT, compareAhrefs, normalizeTrackerQuery } from './tracker';
import {
    ALL_GOOGLE_SEARCH_LABEL,
    CLUSTER_IMPRESSION_MINIMUM,
    MAP_LABEL,
    NOT_COLLECTED_DETAIL,
    NOT_COLLECTED_REASON,
    ORGANIC_LABEL,
    type AhrefsReferenceRow,
    type GrainSlot,
    type LabelledMetrics,
    type ReportingSurface,
    type SearchMetrics,
    type SearchReportingResponse,
    type StoredDay,
    type StoredFact,
    type SurfaceFilter,
} from './types';

export interface BuildInput {
    now: Date;
    range: string | null;
    surface: SurfaceFilter;
    device: GscDevice | null;
    cityTokens: string[];
    connected: boolean;
    property: string | null;
    clientName: string;
    days: StoredDay[];
    facts: StoredFact[];
    ahrefsRows: AhrefsReferenceRow[];
    ahrefsSyncedAt: string | null;
    lastSyncAt: string | null;
    lastSyncErrored: boolean;
}

function labelled(metrics: SearchMetrics, label: string): LabelledMetrics {
    return { label, ...metrics };
}

function missingGrain(): GrainSlot {
    return {
        available: false,
        value: null,
        state: 'partial',
        reason: NOT_COLLECTED_REASON,
        detail: NOT_COLLECTED_DETAIL,
    };
}

function presentGrain(metrics: SearchMetrics): GrainSlot {
    const empty = metrics.clicks === 0 && metrics.impressions === 0;
    return { available: true, value: metrics, state: empty ? 'empty' : 'fresh', reason: null, detail: null };
}

function wants(surface: SurfaceFilter, kind: ReportingSurface): boolean {
    if (surface === 'all') return true;
    return surface === 'organic' ? kind === 'organic' : kind === 'gbp_link';
}

export function buildSearchReporting(input: BuildInput): SearchReportingResponse {
    const preset = parseRange(input.range);
    if (!preset) throw new Error('Invalid range');
    const disconnected = resolveFreshness({
        source: 'gsc',
        connected: input.connected && !!input.property,
        notConnectedReason: STATES_COPY.notConnected,
        lastSyncAt: input.lastSyncAt ? new Date(input.lastSyncAt) : null,
        lastSyncErrored: input.lastSyncErrored,
        now: input.now,
        historyCoversWindow: false,
        backfillRunning: false,
        value: null,
    });
    if (!input.connected || !input.property) {
        return {
            view: 'v2',
            connected: false,
            property: input.property,
            surface: input.surface,
            state: disconnected.state,
            freshness: disconnected,
            range: null,
            grains: null,
            summary: null,
            queries: null,
            cities: null,
            movers: null,
            pages: null,
            tracker: null,
        };
    }

    const resolved = resolveRange(preset, input.days, input.now);
    const { byId, byDate } = dayIndex(input.days);
    const currentDates = finalDates(resolved.current, input.days);
    const priorDates = finalDates(resolved.prior, input.days);
    const distortion = comparisonDistortion(
        coverWindow(resolved.current, input.days),
        coverWindow(resolved.prior, input.days),
    );
    const syncedAt = latestSync(
        input.days.filter(day => day.date >= resolved.current.start && day.date <= resolved.current.end).map(day => day.importedAt),
        input.lastSyncAt,
    );
    const sharedReceipt = (method: string) => receipt({
        source: GSC_SOURCE,
        start: resolved.current.start,
        end: resolved.current.end,
        final: resolved.finality.final,
        syncedAt,
        method,
    });

    const dated: DatedMetric[] = [];
    for (const fact of input.facts) {
        const day = byId.get(fact.dayId);
        if (!day) continue;
        if (fact.grain !== 'page' && fact.grain !== 'property' && fact.grain !== 'page_device' && fact.grain !== 'property_device' && fact.grain !== 'page_organic') continue;
        dated.push({
            date: day.date,
            isIncomplete: day.isIncomplete,
            grain: fact.grain,
            surface: fact.grain === 'property' || fact.grain === 'property_device' ? 'property' : fact.surface,
            device: fact.device,
            clicks: fact.clicks,
            impressions: fact.impressions,
            position: fact.position,
        });
    }

    const device = input.device;
    const pageGrain = device ? 'page_device' : 'page';
    const propertyGrain = device ? 'property_device' : 'property';
    const deviceMatch = (row: DatedMetric) => !device || row.device === device;
    const onFinalDevice = (grain: string, requested: string | null) => dated.some(row =>
        row.grain === grain && currentDates.has(row.date) && (requested == null || row.device === requested));
    const pageOrganicTotals = pointsFor(resolved.current, byDate, dated, row => row.grain === 'page_organic').totals;
    const pageOrganic = onFinalDevice('page_organic', null) && pageOrganicTotals
        ? presentGrain(pageOrganicTotals)
        : missingGrain();
    const hasPageDevice = device != null && onFinalDevice('page_device', device);
    const hasPropertyDevice = device != null && onFinalDevice('property_device', device);
    const anyDeviceGrain = dated.some(row => (row.grain === 'page_device' || row.grain === 'property_device') && currentDates.has(row.date));
    let deviceMetrics: GrainSlot;
    if (device == null) deviceMetrics = anyDeviceGrain ? { available: true, value: null, state: 'fresh', reason: null, detail: null } : missingGrain();
    else if (hasPropertyDevice) {
        const totals = pointsFor(resolved.current, byDate, dated, row => row.grain === 'property_device' && row.device === device).totals;
        deviceMetrics = totals ? presentGrain(totals) : missingGrain();
    } else if (hasPageDevice) {
        const totals = pointsFor(resolved.current, byDate, dated, row => row.grain === 'page_device' && row.device === device).totals;
        deviceMetrics = totals ? presentGrain(totals) : missingGrain();
    }
    else deviceMetrics = missingGrain();
    const surfaceReady = device == null || hasPageDevice;
    const propertyReady = device == null || hasPropertyDevice;

    const organicCurrent = surfaceReady && wants(input.surface, 'organic')
        ? pointsFor(resolved.current, byDate, dated, row => row.grain === pageGrain && row.surface === 'organic' && deviceMatch(row))
        : null;
    const mapCurrent = surfaceReady && wants(input.surface, 'gbp_link')
        ? pointsFor(resolved.current, byDate, dated, row => row.grain === pageGrain && row.surface === 'gbp_link' && deviceMatch(row))
        : null;
    const allCurrent = propertyReady && input.surface === 'all'
        ? pointsFor(resolved.current, byDate, dated, row => row.grain === propertyGrain && deviceMatch(row))
        : null;
    const organicPrior = organicCurrent?.totals
        ? pointsFor(resolved.prior, byDate, dated, row => row.grain === pageGrain && row.surface === 'organic' && deviceMatch(row)).totals
        : null;
    const mapPrior = mapCurrent?.totals
        ? pointsFor(resolved.prior, byDate, dated, row => row.grain === pageGrain && row.surface === 'gbp_link' && deviceMatch(row)).totals
        : null;
    const allPrior = allCurrent?.totals
        ? pointsFor(resolved.prior, byDate, dated, row => row.grain === propertyGrain && deviceMatch(row)).totals
        : null;

    const maskSource = allCurrent ?? organicCurrent ?? mapCurrent;
    const mask = maskSource?.mask ?? pointsFor(resolved.current, byDate, dated, () => false).mask;

    const summaryComparison = blockComparison(
        allCurrent?.totals ?? organicCurrent?.totals ?? mapCurrent?.totals ?? null,
        allPrior ?? organicPrior ?? mapPrior,
        distortion,
    );

    const queryFacts = surfaceReady && device == null ? factsFor(input.facts, byId, currentDates, 'query_page') : [];
    const pageFacts = surfaceReady ? factsFor(input.facts, byId, currentDates, pageGrain, device) : [];
    const priorQuery = device == null ? impressionsByQuery(input.facts, byId, priorDates, 'query_page') : new Map<string, number>();
    const currentQuery = device == null ? impressionsByQuery(input.facts, byId, currentDates, 'query_page') : new Map<string, number>();

    const cityQueries: CityQuery[] = [];
    const seenCity = new Set<string>();
    for (const [key, current] of currentQuery) {
        seenCity.add(key);
        const [surface, query] = splitKey(key);
        if (!wants(input.surface, surface)) continue;
        cityQueries.push({ query, surface, current, prior: priorQuery.get(key) ?? 0 });
    }
    for (const [key, prior] of priorQuery) {
        if (seenCity.has(key)) continue;
        const [surface, query] = splitKey(key);
        if (!wants(input.surface, surface)) continue;
        cityQueries.push({ query, surface, current: 0, prior });
    }

    const gscOrganic = organicPositions(queryFacts);
    const ahrefsPairs = compareAhrefs(gscOrganic, input.ahrefsRows);
    const anomalyOpen = ahrefsPairs.some(row => row.anomalyOpen);

    const headline = allCurrent?.totals?.impressions ?? organicCurrent?.totals?.impressions ?? mapCurrent?.totals?.impressions ?? null;
    const freshness = resolveFreshness({
        source: 'gsc',
        connected: true,
        lastSyncAt: syncedAt ? new Date(syncedAt) : null,
        lastSyncErrored: input.lastSyncErrored,
        now: input.now,
        historyCoversWindow: resolved.finality.final,
        backfillRunning: false,
        value: device != null && !hasPageDevice && !hasPropertyDevice ? null : headline,
    });

    const range = {
        preset: resolved.preset.kind,
        key: resolved.preset.key,
        start: resolved.current.start,
        end: resolved.current.end,
        timezone: 'America/Los_Angeles' as const,
        finality: resolved.finality,
        prior: resolved.prior,
        earlier: resolved.earlier,
    };

    return {
        view: 'v2',
        connected: true,
        property: input.property,
        surface: input.surface,
        state: freshness.state,
        freshness,
        range,
        grains: {
            pageOrganic,
            device: { requested: device, ...deviceMetrics },
        },
        summary: {
            series: {
                organic: organicCurrent?.series ?? null,
                map: mapCurrent?.series ?? null,
            },
            mask,
            totals: {
                organic: organicCurrent?.totals ? labelled(organicCurrent.totals, ORGANIC_LABEL) : null,
                map: mapCurrent?.totals ? labelled(mapCurrent.totals, MAP_LABEL) : null,
                allGoogleSearch: allCurrent?.totals ? labelled(allCurrent.totals, ALL_GOOGLE_SEARCH_LABEL) : null,
            },
            receipt: sharedReceipt(
                device && !surfaceReady && !propertyReady
                    ? METHODS.device
                    : input.surface === 'map'
                        ? METHODS.map
                        : input.surface === 'organic'
                            ? METHODS.organic
                            : METHODS.allGoogleSearch,
            ),
            comparison: summaryComparison,
            seriesComparisons: {
                organic: organicCurrent ? blockComparison(organicCurrent.totals, organicPrior, distortion) : null,
                map: mapCurrent ? blockComparison(mapCurrent.totals, mapPrior, distortion) : null,
                allGoogleSearch: allCurrent ? blockComparison(allCurrent.totals, allPrior, distortion) : null,
            },
        },
        queries: device != null ? null : {
            bands: {
                organic: wants(input.surface, 'organic') ? positionBands(queryFacts, 'organic') : null,
                map: wants(input.surface, 'gbp_link') ? positionBands(queryFacts, 'gbp_link') : null,
            },
            investigations: {
                organic: wants(input.surface, 'organic') ? investigationsFor(queryFacts, pageFacts, 'organic', input.clientName) : null,
                map: wants(input.surface, 'gbp_link') ? investigationsFor(queryFacts, pageFacts, 'gbp_link', input.clientName) : null,
            },
            receipt: sharedReceipt(METHODS.queries),
            comparison: distortionComparison(distortion),
        },
        cities: device != null ? null : {
            minimum: CLUSTER_IMPRESSION_MINIMUM,
            tokens: input.cityTokens,
            rows: buildCityRows(cityQueries, input.cityTokens, input.surface),
            receipt: sharedReceipt(METHODS.cities),
            comparison: distortionComparison(distortion),
        },
        movers: device != null ? null : {
            minimum: CLUSTER_IMPRESSION_MINIMUM,
            rows: buildMovers({
                facts: input.facts,
                dayById: byId,
                days: input.days,
                current: resolved.current,
                prior: resolved.prior,
                earlier: resolved.earlier,
                surface: input.surface,
                windowDistorted: distortion.distorted,
            }),
            receipt: sharedReceipt(METHODS.movers),
            comparison: distortionComparison(distortion),
        },
        pages: surfaceReady ? {
            rows: buildPageRows(pageFacts, input.surface),
            receipt: sharedReceipt(METHODS.pages),
            comparison: distortionComparison(distortion),
        } : null,
        tracker: {
            audience: 'staff',
            anomaly_open: anomalyOpen,
            ahrefs: {
                source: 'Ahrefs',
                tag: 'ref',
                rows: ahrefsPairs,
                note: input.ahrefsRows.length === 0 ? 'Stored Ahrefs metrics for this range have no per-query rows.' : null,
                receipt: receipt({
                    source: 'Ahrefs',
                    start: resolved.current.start,
                    end: resolved.current.end,
                    final: resolved.finality.final,
                    syncedAt: input.ahrefsSyncedAt,
                    method: METHODS.ahrefs,
                }),
            },
            dfs: {
                ...DFS_SPOT_CHECK_SLOT,
                receipt: receipt({
                    source: 'DataForSEO',
                    start: resolved.current.start,
                    end: resolved.current.end,
                    final: false,
                    syncedAt: null,
                    method: METHODS.dfs,
                }),
            },
        },
    };
}

function factsFor(
    facts: StoredFact[],
    byId: Map<string, StoredDay>,
    dates: Set<string>,
    grain: StoredFact['grain'],
    device?: string | null,
): { query: string; page: string; surface: ReportingSurface; date: string; clicks: number; impressions: number; position: number }[] {
    const rows = [];
    for (const fact of facts) {
        if (fact.grain !== grain) continue;
        if (device && fact.device !== device) continue;
        const day = byId.get(fact.dayId);
        if (!day || day.isIncomplete || !dates.has(day.date)) continue;
        if (fact.surface !== 'organic' && fact.surface !== 'gbp_link') continue;
        rows.push({
            query: fact.query,
            page: fact.page,
            surface: fact.surface,
            date: day.date,
            clicks: fact.clicks,
            impressions: fact.impressions,
            position: fact.position,
        });
    }
    return rows;
}

function impressionsByQuery(facts: StoredFact[], byId: Map<string, StoredDay>, dates: Set<string>, grain: StoredFact['grain']): Map<string, number> {
    const totals = new Map<string, number>();
    for (const fact of facts) {
        if (fact.grain !== grain) continue;
        const day = byId.get(fact.dayId);
        if (!day || day.isIncomplete || !dates.has(day.date)) continue;
        const key = `${fact.surface}\u0000${normalizeTrackerQuery(fact.query)}`;
        totals.set(key, (totals.get(key) ?? 0) + fact.impressions);
    }
    return totals;
}

function splitKey(key: string): [ReportingSurface, string] {
    const splitAt = key.indexOf('\u0000');
    return [key.slice(0, splitAt) as ReportingSurface, key.slice(splitAt + 1)];
}

function organicPositions(facts: { query: string; surface: ReportingSurface; clicks: number; impressions: number; position: number }[]): { query: string; position: number | null }[] {
    const groups = new Map<string, { query: string; clicks: number; impressions: number; position: number }[]>();
    for (const fact of facts) {
        if (fact.surface !== 'organic' || !fact.query) continue;
        const key = normalizeTrackerQuery(fact.query);
        const list = groups.get(key);
        const row = { query: fact.query, clicks: fact.clicks, impressions: fact.impressions, position: fact.position };
        if (list) list.push(row);
        else groups.set(key, [row]);
    }
    return [...groups.values()].map(rows => {
        const metrics = sumMetrics(rows);
        return { query: rows[0].query, position: metrics.position };
    });
}
