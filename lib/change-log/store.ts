import { createAdminClient } from '@/lib/supabase/admin';
import { chunkList } from '@/lib/search-reporting/fact-read';

import { impactsFromRows } from './assemble';
import {
    isMissingColumn,
    isMissingRelation,
    type Ga4PageRow,
    type Ga4SiteRow,
    type GscFactRow,
    type HistoryDayRow,
} from './facts';
import { ga4PathFor, gscPageCandidates } from './match';
import { afterWindow, baselineWindow, finalThrough, ptDate, shiftWindowLastYear } from './time';
import { GSC_LAG_DAYS } from './thresholds';
import { samePageMarkers, type ChartMarker } from './chart';
import { findConfounders, timelineItem } from './impact';
import { TREATMENTS, type SeoChange, type Treatment } from './types';
import type { Confounder, ImpactModel, TimelineItem } from './types';
import type { NormalizedChange } from './validate';

type Admin = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

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
        .select('id, data_date, is_incomplete')
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
        return [{ id, date, preliminary: row.is_incomplete === true }];
    });
}

async function facts(
    db: Admin,
    dayIds: string[],
    grain: 'property' | 'page' | 'query_page',
    filter?: { pages?: string[]; queries?: string[] },
): Promise<GscFactRow[]> {
    const out: GscFactRow[] = [];
    const pages = filter?.pages?.slice(0, 200) ?? [];
    const queries = filter?.queries?.slice(0, 100) ?? [];
    for (const chunk of chunkList(dayIds, grain === 'property' ? 14 : 7)) {
        const base = db.from('gsc_history_facts')
            .select('day_id, grain, page, query, clicks, impressions, position, surface')
            .in('day_id', chunk)
            .eq('grain', grain);
        const narrowed = pages.length && queries.length
            ? base.in('page', pages).in('query', queries)
            : pages.length
                ? base.in('page', pages)
                : queries.length
                    ? base.in('query', queries)
                    : base;
        const data = await rows(narrowed.limit(8000));
        for (const row of data) {
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
    return out;
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
    const pages = paths.length === 0 ? [] : await rows(db.from('ga4_landing_page_days')
        .select('day, landing_page_norm, organic_sessions, key_events')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .in('landing_page_norm', paths)
        .gte('day', span.start)
        .lte('day', span.end)
        .limit(8000));
    const siteRows = dayMeta.size === 0 ? [] : await rows(db.from('ga4_daily')
        .select('day_id, organic_sessions, key_events')
        .in('day_id', [...dayMeta.keys()])
        .limit(800));
    return {
        pages: pages.flatMap(row => {
            const date = text(row.day).slice(0, 10);
            const path = text(row.landing_page_norm);
            if (!date || !path) return [];
            return [{
                date,
                path,
                organicSessions: nullableNum(row.organic_sessions),
                keyEvents: nullableNum(row.key_events),
                preliminary: false,
            }];
        }),
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

async function loadImpacts(db: Admin, organizationId: string, clientId: string, changes: SeoChange[], now: Date): Promise<{ impacts: Record<string, ImpactModel>; gsc: boolean; ga4: boolean }> {
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
    const queryNeedles = [...new Set(changes.flatMap(change => change.queries.map(query => query.normalized)))];
    const paths = [...new Set(changes.flatMap(change => change.pages.flatMap(page => {
        const path = ga4PathFor(page.url);
        return path ? [path] : [];
    })))];
    const [pageFacts, propertyFacts, queryFacts, ga] = await Promise.all([
        dayIds.length && candidates.length
            ? facts(db, dayIds, 'page', { pages: candidates })
            : Promise.resolve([]),
        dayIds.length ? facts(db, dayIds, 'property') : Promise.resolve([]),
        dayIds.length && queryNeedles.length
            ? facts(db, dayIds, 'query_page', { pages: candidates, queries: queryNeedles })
            : Promise.resolve([]),
        ga4Property ? ga4Rows(db, organizationId, clientId, ga4Property, span, paths) : Promise.resolve({ pages: [], site: [] }),
    ]);
    return {
        gsc: Boolean(gscProperty),
        ga4: Boolean(ga4Property),
        impacts: impactsFromRows({
            changes,
            now,
            gscConnected: Boolean(gscProperty),
            ga4Connected: Boolean(ga4Property),
            historyDays,
            pageFacts,
            propertyFacts,
            queryFacts,
            ga4Pages: ga.pages,
            ga4Site: ga.site,
        }),
    };
}

const CHANGE_COLUMNS = 'id, client_id, change_type, title, before_text, after_text, live_at, approved_by_name, approved_at, backup_reference, revert_instructions, kpi, compare_last_year';

async function loadChanges(db: Admin, organizationId: string, clientId: string): Promise<SeoChange[]> {
    const changeRows = await loadChangeRows(db, organizationId, clientId);
    const ids = changeRows.map(row => text(row.id)).filter(Boolean);
    if (ids.length === 0) return [];
    const [pageRows, queryRows] = await Promise.all([
        rows(db.from('seo_change_pages').select('change_id, url, url_key, label, cms_page_id, cms_widget_id').in('change_id', ids)),
        rows(db.from('seo_change_queries').select('change_id, query, normalized_query').in('change_id', ids)),
    ]);
    return changeRows.flatMap(row => {
        const change = mapChange(row, pageRows, queryRows);
        return change ? [change] : [];
    });
}

/** Reads group columns when migration 129 is present, and falls back when it is not. */
async function loadChangeRows(db: Admin, organizationId: string, clientId: string): Promise<Row[]> {
    const query = db.from('seo_changes')
        .select(`${CHANGE_COLUMNS}, test_kind, treatment`)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('live_at', { ascending: false })
        .limit(100);
    const first = await query;
    if (first.error && isMissingColumn(first.error)) {
        return rows(db.from('seo_changes')
            .select(CHANGE_COLUMNS)
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .order('live_at', { ascending: false })
            .limit(100));
    }
    if (first.error) {
        if (isMissingRelation(first.error)) throw new MissingTable();
        throw new Error('Unable to read the change log');
    }
    return first.data ?? [];
}

export async function listChanges(organizationId: string, clientId: string, now = new Date()): Promise<ChangeListResult> {
    try {
        const db = createAdminClient();
        const changes = await loadChanges(db, organizationId, clientId);
        const loaded = changes.length === 0
            ? { impacts: {} as Record<string, ImpactModel> }
            : await loadImpacts(db, organizationId, clientId, changes, now);
        const items = changes.map(change => timelineItem(change, loaded.impacts[change.id])).filter(item => item.id);
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

export async function getChange(organizationId: string, clientId: string, changeId: string, now = new Date()): Promise<ChangeDetailResult> {
    try {
        const db = createAdminClient();
        const changes = await loadChanges(db, organizationId, clientId);
        const change = changes.find(item => item.id === changeId) ?? null;
        if (!change) return { setup: 'ready', change: null, impact: null, confounders: [], baselineNote: null, pageMarkers: [] };
        const loaded = await loadImpacts(db, organizationId, clientId, [change], now);
        const { data } = await db.from('seo_change_baselines')
            .select('note, status')
            .eq('change_id', changeId)
            .eq('organization_id', organizationId)
            .maybeSingle();
        const status = text((data as Row | null)?.status);
        const note = text((data as Row | null)?.note);
        return {
            setup: 'ready',
            change,
            impact: loaded.impacts[change.id] ?? null,
            confounders: findConfounders(changes, change, loaded.impacts[change.id]?.headline.ready ? loaded.impacts[change.id].headline.days : 28),
            baselineNote: plainStartingPointNote(note, status),
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

export async function createChange(input: {
    organizationId: string;
    clientId: string;
    userId: string;
    change: NormalizedChange;
    now?: Date;
}): Promise<{ id: string; baselineStatus: 'captured' | 'partial' | 'missing'; baselineNote: string }> {
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
    const { data, error } = await db.from('seo_changes').insert(payload).select('id').single();
    if (error || !data?.id) {
        if (isMissingRelation(error)) throw new MissingTable();
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
        const loaded = await loadImpacts(db, input.organizationId, input.clientId, [saved], now);
        const impact = loaded.impacts[id];
        const status = !impact || !impact.baseline.measured
            ? 'missing'
            : impact.baseline.daysPresent < impact.baseline.daysExpected
                ? 'partial'
                : 'captured';
        const note = status === 'missing'
            ? 'No saved days in the 28 days before this change.'
            : status === 'partial'
                ? `Starting point saved with ${impact.baseline.daysPresent} of ${impact.baseline.daysExpected} days. Google Search Console is about ${GSC_LAG_DAYS} days behind.`
                : 'Starting point saved from stored Google Search Console and Analytics history.';
        await db.from('seo_change_baselines').insert({
            change_id: id,
            organization_id: input.organizationId,
            client_id: input.clientId,
            captured_at: now.toISOString(),
            data_through: impact?.finalThrough ?? null,
            gsc_lag_days: GSC_LAG_DAYS,
            status,
            low_data: impact?.headline.lowData ?? false,
            estimate: status !== 'captured',
            gsc_connected: loaded.gsc,
            ga4_connected: loaded.ga4,
            payload: {
                clicks: impact?.baseline.clicks ?? null,
                impressions: impact?.baseline.impressions ?? null,
                ctr: impact?.baseline.ctr ?? null,
                position: impact?.baseline.position ?? null,
                organicSessions: impact?.baseline.organicSessions ?? null,
                keyEvents: impact?.baseline.keyEvents ?? null,
                daysPresent: impact?.baseline.daysPresent ?? 0,
                daysExpected: impact?.baseline.daysExpected ?? 0,
            },
            note,
        });
        return { id, baselineStatus: status, baselineNote: note };
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
