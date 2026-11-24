import { dateOffset } from '@/lib/gsc/history';
import { chunkList } from '@/lib/search-reporting/fact-read';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';
import { createAdminClient } from '@/lib/supabase/admin';

import { impactsFromRows } from './assemble';
import { addDetailContext } from './detail-context';
import {
    isMissingColumn,
    isMissingRelation,
    type Ga4PageRow,
    type Ga4SiteRow,
    type GscFactRow,
    type HistoryDayRow,
} from './facts';
import { ga4PathFor, gscPageCandidates } from './match';
import { afterWindow, baselineWindow, finalThrough, ptDate, ptLocalToIso, shiftWindowLastYear } from './time';
import { GSC_LAG_DAYS } from './thresholds';
import { samePageMarkers, type ChartMarker } from './chart';
import { findConfounders, timelineItem } from './impact';
import { TREATMENTS, type SeoChange, type Treatment } from './types';
import type { Confounder, DayPoint, ImpactModel, TimelineItem } from './types';
import { normalizeControlUrls, type NormalizedChange } from './validate';

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
const CHANGE_LIST_LIMIT = 100;

export interface ChangeListResult {
    setup: 'ready' | 'missing';
    items: TimelineItem[];
    changes: SeoChange[];
    impacts: Record<string, ImpactModel>;
}

export interface ChangeDetailResult {
    setup: 'ready' | 'missing';
    change: SeoChange | null;
    impact: ImpactModel | null;
    confounders: Confounder[];
    baselineNote: string | null;
    pageMarkers: ChartMarker[];
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function treatmentOf(value: unknown): Treatment | '' {
    const slug = text(value);
    return (TREATMENTS as readonly string[]).includes(slug) ? slug as Treatment : '';
}

function nullableNum(value: unknown): number | null {
    if (value == null) return null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapChange(row: Row, pages: Row[], queries: Row[]): SeoChange | null {
    const liveAt = text(row.live_at);
    const liveOn = ptDate(liveAt);
    const id = text(row.id);
    const changeType = text(row.change_type);
    const kpi = text(row.kpi);
    if (!id || !liveOn || !changeType || !kpi) return null;
    return {
        id,
        clientId: text(row.client_id),
        changeType: changeType as SeoChange['changeType'],
        title: text(row.title),
        beforeText: text(row.before_text),
        afterText: text(row.after_text),
        liveAt,
        liveOn,
        approvedByName: text(row.approved_by_name),
        approvedAt: text(row.approved_at) || null,
        backupReference: text(row.backup_reference),
        revertInstructions: text(row.revert_instructions),
        kpi: kpi as SeoChange['kpi'],
        compareLastYear: row.compare_last_year === true,
        testKind: text(row.test_kind) === 'group' ? 'group' : 'single',
        treatment: treatmentOf(row.treatment),
        controlUrls: Array.isArray(row.control_urls) ? row.control_urls.filter(url => typeof url === 'string') : [],
        pages: pages.filter(page => text(page.change_id) === id).map(page => ({
            url: text(page.url),
            urlKey: text(page.url_key),
            label: text(page.label),
            cmsPageId: text(page.cms_page_id) || null,
            cmsWidgetId: text(page.cms_widget_id) || null,
        })),
        queries: queries.filter(query => text(query.change_id) === id).map(query => ({
            query: text(query.query),
            normalized: text(query.normalized_query),
        })),
    };
}

async function rows(query: PromiseLike<{ data: Row[] | null; error: { code?: string; message?: string } | null }>): Promise<Row[]> {
    const { data, error } = await query;
    if (error) {
        if (isMissingRelation(error)) throw new MissingTable();
        throw new Error('Unable to read the change log');
    }
    return data ?? [];
}

async function* rowPages(read: (start: number, end: number) => Parameters<typeof rows>[0]) {
    const pageSize = 1000;
    for (let start = 0; ;) {
        const page = await rows(read(start, start + pageSize - 1));
        if (page.length === 0) break;
        yield page;
        start += page.length;
    }
}

class MissingTable extends Error {
    constructor() {
        super('missing');
    }
}

export function readSpan(changes: readonly SeoChange[], now: Date): { start: string; end: string } | null {
    if (changes.length === 0) return null;
    let start = finalThrough(now);
    let end = start;
    for (const change of changes) {
        const baseline = baselineWindow(change.liveOn);
        const after = afterWindow(change.liveOn, 56);
        if (baseline.start < start) start = baseline.start;
        if (change.compareLastYear) {
            const yoy = shiftWindowLastYear(baseline);
            if (yoy.start < start) start = yoy.start;
        }
        const cap = after.end < finalThrough(now) ? after.end : finalThrough(now);
        if (cap > end) end = cap;
    }
    if (end < start) return null;
    return { start, end };
}

async function propertyFor(db: Admin, organizationId: string, clientId: string, service: 'gsc' | 'ga4'): Promise<string | null> {
    const column = service === 'gsc' ? 'site_url' : 'property_id';
    const { data, error } = await db.from('client_integrations')
        .select(`${column}:credentials->>${column}`)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('service', service)
        .maybeSingle();
    if (error || !data) return null;
    const value = text((data as Row)[column]);
    if (!value) return null;
    if (service === 'ga4' && !/^properties\/[0-9]+$/.test(value)) return null;
    return value;
}

async function history(db: Admin, organizationId: string, clientId: string, property: string, span: { start: string; end: string }): Promise<HistoryDayRow[]> {
    const data = await rows(db.from('gsc_history_days')
        .select('id, data_date, is_incomplete, page_limited')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('property', property)
        .eq('search_type', 'web')
        .gte('data_date', span.start)
        .lte('data_date', span.end)
        .order('data_date', { ascending: true })
        .limit(800));
    return data.flatMap(row => {
        const id = text(row.id);
        const date = text(row.data_date).slice(0, 10);
        if (!id || !date) return [];
        return [{ id, date, preliminary: row.is_incomplete === true, pageLimited: row.page_limited !== false }];
    });
}

async function facts(
    db: Admin,
    dayIds: string[],
    grain: 'property' | 'page' | 'query_page',
    filter?: { pages?: string[]; queries?: string[]; taggedPages?: boolean },
): Promise<GscFactRow[]> {
    const out: GscFactRow[] = [];
    const pageGroups = filter?.pages?.length ? chunkList(filter.pages, 40) : [[]];
    const queryGroups = filter?.queries?.length ? chunkList(filter.queries, 30) : [[]];
    for (const chunk of chunkList(dayIds, grain === 'property' ? 14 : 7)) {
        for (const pages of pageGroups) {
            for (const queries of queryGroups) {
                const batch = rowPages((start, end) => {
                    const query = db.from('gsc_history_facts')
                        .select('day_id, grain, page, query, clicks, impressions, position, surface')
                        .in('day_id', chunk).eq('grain', grain);
                    if (pages.length) query.in('page', pages);
                    if (queries.length) query.in('query', queries);
                    if (filter?.taggedPages) query.ilike('page', '%?%utm%');
                    // Within a grain, (day_id, row_key) is unique and indexed.
                    return query.order('day_id').order('row_key').range(start, end);
                });
                for await (const page of batch) {
                    for (const row of page) {
                        const dayId = text(row.day_id);
                        if (!dayId) continue;
                        out.push({
                            dayId,
                            grain: text(row.grain),
                            page: text(row.page),
                            query: text(row.query),
                            clicks: num(row.clicks),
                            impressions: num(row.impressions),
                            position: num(row.position),
                            surface: text(row.surface) || null,
                        });
                    }
                }
            }
        }
    }
    return out;
}

async function readRestPositions(
    db: Admin,
    scope: { organizationId: string; clientId: string; property: string },
    changes: readonly SeoChange[],
    days: readonly HistoryDayRow[],
): Promise<Map<string, DayPoint[]>> {
    const result = new Map<string, DayPoint[]>();
    const requests = changes.flatMap(change => {
        const start = baselineWindow(change.liveOn).start;
        const end = afterWindow(change.liveOn, 56).end;
        const dayIds = days.filter(day => !day.preliminary && day.date >= start && day.date <= end && day.date !== change.liveOn)
            .map(day => day.id);
        const excludedKeys = [...new Set(change.pages.flatMap(page => normalizeResultUrl(page.url) ?? []))];
        return dayIds.length && excludedKeys.length ? [{ id: change.id, dayIds, excludedKeys }] : [];
    });
    // Lists can have multiple position verdicts. Limit simultaneous site scans.
    for (const batch of chunkList(requests, 4)) {
        const entries = await Promise.all(batch.map(async ({ id, dayIds, excludedKeys }) => {
            const { data, error } = await db.rpc('seo_change_rest_position', {
                p_organization_id: scope.organizationId,
                p_client_id: scope.clientId,
                p_property: scope.property,
                p_day_ids: dayIds,
                p_excluded_page_keys: excludedKeys,
            });
            if (error) {
                // Migration 140 enables position for the default control. Leave it
                // unavailable while the RPC is missing, without loading raw page facts.
                if (error.code === 'PGRST202' || error.code === '42883'
                    || /could not find the function|function not found|function .+ does not exist/i.test(error.message)) return null;
                throw new Error('Unable to read rest-of-site position', { cause: error });
            }
            const points: DayPoint[] = ((data ?? []) as Row[]).map(row => {
                const impressions = num(row.impressions);
                return {
                    date: text(row.data_date),
                    clicks: num(row.clicks),
                    impressions,
                    position: impressions > 0 ? num(row.position_weight) / impressions : 0,
                    organicSessions: null,
                    keyEvents: null,
                    preliminary: false,
                };
            });
            return { id, points };
        }));
        for (const entry of entries) if (entry) result.set(entry.id, entry.points);
        if (entries.some(entry => entry === null)) break;
    }
    return result;
}

async function ga4Rows(db: Admin, organizationId: string, clientId: string, property: string, span: { start: string; end: string }, paths: string[]): Promise<{ pages: Ga4PageRow[]; site: Ga4SiteRow[] }> {
    const days = await rows(db.from('ga4_history_days')
        .select('id, day, is_final')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('property', property)
        .gte('day', span.start)
        .lte('day', span.end)
        .limit(800));
    const dayMeta = new Map<string, { date: string; preliminary: boolean }>();
    for (const row of days) {
        const id = text(row.id);
        const date = text(row.day).slice(0, 10);
        if (!id || !date) continue;
        dayMeta.set(id, { date, preliminary: row.is_final === false });
    }
    const pages: Ga4PageRow[] = [];
    if (dayMeta.size > 0) {
        for (const group of chunkList(paths, 40)) {
            const batches = rowPages((start, end) => db.from('ga4_landing_page_days')
                .select('day_id, landing_page_norm, organic_sessions, key_events')
                .eq('organization_id', organizationId).eq('client_id', clientId)
                .in('landing_page_norm', group).gte('day', span.start).lte('day', span.end)
                .order('id').range(start, end));
            for await (const batch of batches) {
                for (const row of batch) {
                    const meta = dayMeta.get(text(row.day_id));
                    const path = text(row.landing_page_norm);
                    if (!meta || !path) continue;
                    pages.push({
                        date: meta.date,
                        path,
                        organicSessions: nullableNum(row.organic_sessions),
                        keyEvents: nullableNum(row.key_events),
                        preliminary: meta.preliminary,
                    });
                }
            }
        }
    }
    const siteRows = dayMeta.size === 0 ? [] : await rows(db.from('ga4_daily')
        .select('day_id, organic_sessions, key_events')
        .in('day_id', [...dayMeta.keys()])
        .limit(800));
    return {
        pages,
        site: siteRows.flatMap(row => {
            const meta = dayMeta.get(text(row.day_id));
            if (!meta) return [];
            return [{
                date: meta.date,
                organicSessions: nullableNum(row.organic_sessions),
                keyEvents: nullableNum(row.key_events),
                preliminary: meta.preliminary,
            }];
        }),
    };
}

async function loadImpacts(db: Admin, organizationId: string, clientId: string, changes: SeoChange[], now: Date, view: 'list' | 'baseline' | SeoChange): Promise<{ impacts: Record<string, ImpactModel>; gsc: boolean; ga4: boolean }> {
    const detail = typeof view === 'object' ? view : undefined;
    const gscProperty = await propertyFor(db, organizationId, clientId, 'gsc');
    const ga4Property = await propertyFor(db, organizationId, clientId, 'ga4');
    const span = readSpan(changes, now);
    if (!span || (!gscProperty && !ga4Property)) {
        return {
            gsc: Boolean(gscProperty),
            ga4: Boolean(ga4Property),
            impacts: Object.fromEntries(changes.map(change => [change.id, impactsFromRows({
                changes: [change],
                now,
                gscConnected: Boolean(gscProperty),
                ga4Connected: Boolean(ga4Property),
                historyDays: [],
                pageFacts: [],
                propertyFacts: [],
                queryFacts: [],
                ga4Pages: [],
                ga4Site: [],
            })[change.id]])),
        };
    }
    const historyDays = gscProperty ? await history(db, organizationId, clientId, gscProperty, span) : [];
    const dayIds = historyDays.map(day => day.id);
    const candidates = [...new Set(changes.flatMap(change => change.pages.flatMap(page => gscPageCandidates(page.url))))];
    const controlCandidates = [...new Set(changes.flatMap(change => change.controlUrls ?? []).flatMap(gscPageCandidates))];
    const pageCandidates = [...new Set([...candidates, ...controlCandidates])];
    const queryNeedles = [...new Set(changes.flatMap(change => change.queries.map(query => query.normalized)))];
    const detailBaseline = detail ? baselineWindow(detail.liveOn) : null;
    const detailAfter = detail ? afterWindow(detail.liveOn, 56) : null;
    const baselineDayIds = detailBaseline ? historyDays.filter(day => !day.preliminary
        && day.date >= detailBaseline.start && day.date <= detailBaseline.end).map(day => day.id) : [];
    const afterDayIds = detailAfter ? historyDays.filter(day => !day.preliminary
        && day.date >= detailAfter.start && day.date <= detailAfter.end).map(day => day.id) : [];
    const detailDayIds = [...baselineDayIds, ...afterDayIds];
    // Detail lets users switch the comparison chart to position for any KPI.
    const positionChanges = changes.filter(change => !change.controlUrls?.length
        && (detail || (view === 'list' && change.kpi === 'avg_position')));
    const paths = [...new Set(changes.flatMap(change => [
        ...change.pages.map(page => page.url), ...(change.controlUrls ?? []),
    ]).flatMap(url => ga4PathFor(url) ?? []))];
    const [pageFacts, propertyFacts, baselineQueryFacts, trackedQueryFacts, ga, siteQueryFacts, taggedPageFacts, restPositionDays] = await Promise.all([
        dayIds.length && pageCandidates.length
            ? facts(db, dayIds, 'page', { pages: pageCandidates })
            : Promise.resolve([]),
        dayIds.length ? facts(db, dayIds, 'property') : Promise.resolve([]),
        baselineDayIds.length && candidates.length && queryNeedles.length
            ? facts(db, baselineDayIds, 'query_page', { pages: candidates })
            : Promise.resolve([]),
        candidates.length && queryNeedles.length
            ? facts(db, detail ? afterDayIds : dayIds, 'query_page', { pages: candidates, queries: queryNeedles })
            : Promise.resolve([]),
        ga4Property ? ga4Rows(db, organizationId, clientId, ga4Property, span, paths) : Promise.resolve({ pages: [], site: [] }),
        detailDayIds.length && queryNeedles.length
            ? facts(db, detailDayIds, 'query_page', { queries: queryNeedles })
            : Promise.resolve([]),
        detailDayIds.length && candidates.length
            ? facts(db, detailDayIds, 'page', { taggedPages: true })
            : Promise.resolve([]),
        gscProperty && positionChanges.length
            ? readRestPositions(db, { organizationId, clientId, property: gscProperty }, positionChanges, historyDays)
            : undefined,
    ]);
    const impacts = impactsFromRows({
        changes,
        now,
        gscConnected: Boolean(gscProperty),
        ga4Connected: Boolean(ga4Property),
        historyDays,
        pageFacts,
        restPositionDays,
        propertyFacts,
        queryFacts: [...baselineQueryFacts, ...trackedQueryFacts],
        ga4Pages: ga.pages,
        ga4Site: ga.site,
    });
    if (detail && detailDayIds.length > 0) addDetailContext({
        change: detail,
        impact: impacts[detail.id],
        days: historyDays,
        pageQueryFacts: baselineQueryFacts,
        siteQueryFacts,
        taggedPageFacts,
    });
    return {
        gsc: Boolean(gscProperty),
        ga4: Boolean(ga4Property),
        impacts,
    };
}

async function loadChanges(
    db: Admin,
    organizationId: string,
    clientId: string,
    scope?: { id: string } | { start: string; end: string },
): Promise<SeoChange[]> {
    // Selecting the row lets older databases omit optional group and control columns.
    const query = () => db.from('seo_changes').select('*').eq('organization_id', organizationId).eq('client_id', clientId);
    const changeRows: Row[] = [];
    if (scope && 'id' in scope) {
        changeRows.push(...await rows(query().eq('id', scope.id)));
    } else if (scope) {
        const start = ptLocalToIso(`${scope.start}T00:00`)!;
        const end = ptLocalToIso(`${dateOffset(scope.end, 1)}T00:00`)!;
        for await (const batch of rowPages((from, to) => query().gte('live_at', start).lt('live_at', end)
            .order('live_at').order('id').range(from, to))) {
            changeRows.push(...batch);
        }
    } else {
        changeRows.push(...await rows(query().order('live_at', { ascending: false }).order('id').limit(CHANGE_LIST_LIMIT)));
    }
    const ids = changeRows.map(row => text(row.id)).filter(Boolean);
    if (ids.length === 0) return [];
    const pageRows: Row[] = [];
    const queryRows: Row[] = [];
    for (const group of chunkList(ids, 40)) {
        for await (const batch of rowPages((from, to) => db.from('seo_change_pages')
            .select('change_id, url, url_key, label, cms_page_id, cms_widget_id').in('change_id', group).order('id').range(from, to))) {
            pageRows.push(...batch);
        }
        if (scope && 'start' in scope) continue;
        queryRows.push(...await rows(db.from('seo_change_queries').select('change_id, query, normalized_query').in('change_id', group)));
    }
    return changeRows.flatMap(row => {
        const change = mapChange(row, pageRows, queryRows);
        return change ? [change] : [];
    });
}

export async function listChanges(organizationId: string, clientId: string, now = new Date(), db = createAdminClient()): Promise<ChangeListResult> {
    try {
        const changes = await loadChanges(db, organizationId, clientId);
        if (changes.length === 0) return { setup: 'ready', items: [], changes, impacts: {} };
        const oldest = changes.at(-1);
        const [loaded, older] = await Promise.all([
            loadImpacts(db, organizationId, clientId, changes, now, 'list'),
            oldest && changes.length === CHANGE_LIST_LIMIT
                ? loadChanges(db, organizationId, clientId, { start: baselineWindow(oldest.liveOn).start, end: oldest.liveOn })
                : [],
        ]);
        const nearby = [...changes, ...older];
        const items = changes.map(change => ({
            ...timelineItem(change, loaded.impacts[change.id]),
            hasOverlap: findConfounders(nearby, change).length > 0,
        }));
        return { setup: 'ready', items, changes, impacts: loaded.impacts };
    } catch (error) {
        if (error instanceof MissingTable) return { setup: 'missing', items: [], changes: [], impacts: {} };
        throw error;
    }
}

/** Known system sentences, rewritten at display time. Anything else is shown as stored. */
export function plainStartingPointNote(note: string, status: string): string | null {
    const trimmed = note.trim();
    if (!trimmed) return status === 'missing' ? 'The starting point was not saved.' : null;
    return trimmed
        .replaceAll('Baseline was not stored.', 'The starting point was not saved.')
        .replaceAll('No stored days in the 28 days before this change.', 'No saved days in the 28 days before this change.')
        .replaceAll('Baseline saved from stored Search Console and Analytics history.', 'Starting point saved from stored Google Search Console and Analytics history.')
        .replaceAll('Baseline saved with', 'Starting point saved with')
        .replaceAll('Search Console is about', 'Google Search Console is about');
}

type BaselineStatus = 'captured' | 'partial' | 'missing';

function baselineSnapshot(change: SeoChange, loaded: Awaited<ReturnType<typeof loadImpacts>>, now: Date) {
    const impact = loaded.impacts[change.id];
    const baseline = impact?.baseline;
    const end = baselineWindow(change.liveOn).end;
    // The measured-day count excludes both missing and preliminary days.
    const status: BaselineStatus = !baseline?.measured
        ? 'missing'
        : baseline.daysPresent < baseline.daysExpected || impact.finalThrough < end
            ? 'partial'
            : 'captured';
    const note = status === 'missing'
        ? 'No saved days in the 28 days before this change.'
        : status === 'partial'
            ? `Starting point saved with ${baseline?.daysPresent} of ${baseline?.daysExpected} days. Google Search Console is about ${GSC_LAG_DAYS} days behind.`
            : 'Starting point saved from stored Google Search Console and Analytics history.';
    return {
        captured_at: now.toISOString(),
        data_through: impact ? (impact.finalThrough < end ? impact.finalThrough : end) : null,
        gsc_lag_days: GSC_LAG_DAYS,
        status,
        low_data: impact?.headline.lowData ?? false,
        estimate: status !== 'captured',
        gsc_connected: loaded.gsc,
        ga4_connected: loaded.ga4,
        payload: {
            clicks: baseline?.clicks ?? null,
            impressions: baseline?.impressions ?? null,
            ctr: baseline?.ctr ?? null,
            position: baseline?.position ?? null,
            organicSessions: baseline?.organicSessions ?? null,
            keyEvents: baseline?.keyEvents ?? null,
            daysPresent: baseline?.daysPresent ?? 0,
            daysExpected: baseline?.daysExpected ?? 0,
        },
        note,
    };
}

async function readBaselineNote(db: Admin, organizationId: string, change: SeoChange, loaded: Awaited<ReturnType<typeof loadImpacts>>, now: Date) {
    const readSaved = () => db.from('seo_change_baselines').select('note, status, estimate, payload, captured_at, data_through')
        .eq('change_id', change.id).eq('organization_id', organizationId).eq('client_id', change.clientId)
        .maybeSingle();
    let { data: saved } = await readSaved();
    if (!saved) return null;

    const current = baselineSnapshot(change, loaded, now);
    const baselineEnd = baselineWindow(change.liveOn).end;
    for (;;) {
        const savedDays = num(saved.payload?.daysPresent);
        const complete = saved.status === 'captured' && saved.estimate !== true
            && savedDays >= current.payload.daysExpected && text(saved.data_through) >= baselineEnd;
        if (complete || current.payload.daysPresent <= savedDays) break;

        // Always advance the version, even when detail reads share a clock tick.
        const capturedAt = new Date(Math.max(now.getTime(), Date.parse(saved.captured_at) + 1)).toISOString();
        const { data: updated, error } = await db.from('seo_change_baselines').update({ ...current, captured_at: capturedAt })
            .eq('change_id', change.id).eq('organization_id', organizationId).eq('client_id', change.clientId)
            .eq('captured_at', saved.captured_at).select('note, status').maybeSingle();
        if (updated) return plainStartingPointNote(updated.note, updated.status);
        if (error) break;

        const { data: latest } = await readSaved();
        if (!latest || latest.captured_at === saved.captured_at) break;
        saved = latest;
    }
    return plainStartingPointNote(text(saved.note), text(saved.status));
}

export async function getChange(organizationId: string, clientId: string, changeId: string, now = new Date(), db = createAdminClient()): Promise<ChangeDetailResult> {
    try {
        const [change] = await loadChanges(db, organizationId, clientId, { id: changeId });
        if (!change) return { setup: 'ready', change: null, impact: null, confounders: [], baselineNote: null, pageMarkers: [] };
        const [loaded, changes] = await Promise.all([
            loadImpacts(db, organizationId, clientId, [change], now, change),
            loadChanges(db, organizationId, clientId, { start: baselineWindow(change.liveOn).start, end: afterWindow(change.liveOn, 56).end }),
        ]);
        return {
            setup: 'ready',
            change,
            impact: loaded.impacts[change.id] ?? null,
            confounders: findConfounders(changes, change),
            baselineNote: await readBaselineNote(db, organizationId, change, loaded, now),
            pageMarkers: samePageMarkers(
                { id: change.id, pageKeys: change.pages.map(page => page.urlKey) },
                changes.map(item => ({
                    id: item.id,
                    title: item.title,
                    liveOn: item.liveOn,
                    pageKeys: item.pages.map(page => page.urlKey),
                })),
            ),
        };
    } catch (error) {
        if (error instanceof MissingTable) return { setup: 'missing', change: null, impact: null, confounders: [], baselineNote: null, pageMarkers: [] };
        throw error;
    }
}

export class GroupMigrationRequired extends Error {
    constructor() {
        super('Group tests need migration 129, which has not been applied.');
        this.name = 'GroupMigrationRequired';
    }
}

export class ControlMigrationRequired extends Error {
    constructor() {
        super('Selected control pages need migration 139.');
    }
}

function missingControlColumn(error: { code?: string; message?: string } | null): boolean {
    return Boolean(error && /control_urls/i.test(error.message ?? '') && ['42703', 'PGRST204'].includes(error.code ?? ''));
}

export async function updateControlPages(
    organizationId: string,
    clientId: string,
    changeId: string,
    input: unknown,
    db = createAdminClient(),
): Promise<{ status: 'saved' } | { status: 'missing' } | { status: 'invalid'; error: string }> {
    const [change] = await loadChanges(db, organizationId, clientId, { id: changeId });
    if (!change) return { status: 'missing' };
    const urls = normalizeControlUrls(input, change.pages.map(page => page.url));
    if (typeof urls === 'string') return { status: 'invalid', error: urls };
    const { data, error } = await db.from('seo_changes').update({ control_urls: urls })
        .eq('organization_id', organizationId).eq('client_id', clientId).eq('id', changeId).select('id').maybeSingle();
    if (missingControlColumn(error)) {
        if (urls.length === 0) return { status: 'saved' };
        throw new ControlMigrationRequired();
    }
    if (error) throw new Error('Unable to save the control pages');
    return { status: data ? 'saved' : 'missing' };
}

export async function createChange(input: {
    organizationId: string;
    clientId: string;
    userId: string;
    change: NormalizedChange;
    now?: Date;
}): Promise<{ id: string; baselineStatus: BaselineStatus; baselineNote: string }> {
    const db = createAdminClient();
    const now = input.now ?? new Date();
    const payload: Record<string, unknown> = {
        organization_id: input.organizationId,
        client_id: input.clientId,
        change_type: input.change.changeType,
        title: input.change.title,
        before_text: input.change.beforeText,
        after_text: input.change.afterText,
        live_at: input.change.liveAt,
        approved_by_name: input.change.approvedByName,
        approved_at: input.change.approvedAt,
        backup_reference: input.change.backupReference,
        revert_instructions: input.change.revertInstructions,
        kpi: input.change.kpi,
        compare_last_year: input.change.compareLastYear,
        created_by: input.userId,
    };
    // Single changes omit the new columns so a database without migration 129 still saves them.
    if (input.change.testKind === 'group') {
        payload.test_kind = 'group';
        payload.treatment = input.change.treatment;
    }
    if (input.change.controlUrls.length > 0) payload.control_urls = input.change.controlUrls;
    const { data, error } = await db.from('seo_changes').insert(payload).select('id').single();
    if (error || !data?.id) {
        if (isMissingRelation(error)) throw new MissingTable();
        if (missingControlColumn(error)) throw new ControlMigrationRequired();
        if (input.change.testKind === 'group' && isMissingColumn(error)) throw new GroupMigrationRequired();
        throw new Error('Unable to save the change');
    }
    const id = text(data.id);
    try {
        const { error: pageError } = await db.from('seo_change_pages').insert(input.change.pages.map(page => ({
            change_id: id,
            organization_id: input.organizationId,
            client_id: input.clientId,
            url: page.url,
            url_key: page.urlKey,
            label: page.label,
            cms_page_id: page.cmsPageId,
            cms_widget_id: page.cmsWidgetId,
        })));
        if (pageError) throw new Error('Unable to save the page');
        if (input.change.queries.length > 0) {
            const { error: queryError } = await db.from('seo_change_queries').insert(input.change.queries.map(query => ({
                change_id: id,
                organization_id: input.organizationId,
                client_id: input.clientId,
                query: query.query,
                normalized_query: query.normalized,
            })));
            if (queryError) throw new Error('Unable to save the queries');
        }
        const saved: SeoChange = { id, clientId: input.clientId, ...input.change };
        const loaded = await loadImpacts(db, input.organizationId, input.clientId, [saved], now, 'baseline');
        const snapshot = baselineSnapshot(saved, loaded, now);
        await db.from('seo_change_baselines').insert({
            change_id: id,
            organization_id: input.organizationId,
            client_id: input.clientId,
            ...snapshot,
        });
        return { id, baselineStatus: snapshot.status, baselineNote: snapshot.note };
    } catch (error) {
        await db.from('seo_changes').delete().eq('id', id).eq('organization_id', input.organizationId);
        if (error instanceof MissingTable) throw error;
        throw error instanceof Error ? error : new Error('Unable to save the change');
    }
}

export async function deleteChange(organizationId: string, clientId: string, changeId: string): Promise<boolean> {
    const db = createAdminClient();
    const { error, count } = await db.from('seo_changes')
        .delete({ count: 'exact' })
        .eq('id', changeId)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);
    if (error) {
        if (isMissingRelation(error)) throw new MissingTable();
        throw new Error('Unable to remove the change');
    }
    return (count ?? 0) > 0;
}

export function missingTable(error: unknown): boolean {
    return error instanceof MissingTable || isMissingRelation(error as { code?: string; message?: string });
}
