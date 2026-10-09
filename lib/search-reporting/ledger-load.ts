import { createAdminClient } from '@/lib/supabase/admin';
import { dateOffset } from '@/lib/gsc/history';
import { monthFinality } from '@/lib/gsc/monthly';
import { monthBounds, ptToday } from '@/lib/sync/months';
import { readGrainedFacts } from './fact-read';
import type { SearchReportingAdmin, SearchQuery } from './load';
import type { LedgerDayInput, LedgerDeliverableInput, LedgerFactInput, LedgerSource } from './ledger';
import { normalizeShipDate } from './proof';
import { LOOKBACK_DAYS, coverWindow, parseRange, resolveRange } from './range';

export interface LedgerLoadInput {
    organizationId: string;
    clientId: string;
    now: Date;
    /** Insights range (`28d` or `YYYY-MM`). Omitted means the last 28 final days. */
    range?: string | null;
}

function integer(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

function positionOf(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readPages(build: () => SearchQuery): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw new Error('Unable to read the results ledger');
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < pageSize) return rows;
    }
}

function deliverable(row: Record<string, unknown>): LedgerDeliverableInput {
    return {
        id: String(row.id ?? ''),
        title: typeof row.title === 'string' ? row.title : '',
        type: typeof row.type === 'string' ? row.type : 'Content',
        subtype: typeof row.subtype === 'string' ? row.subtype : null,
        status: typeof row.status === 'string' ? row.status : '',
        publishedUrl: typeof row.published_url === 'string' ? row.published_url : null,
        deliveredOn: typeof row.delivered_on === 'string' ? row.delivered_on : null,
    };
}

export async function loadLedger(
    input: LedgerLoadInput,
    admin: SearchReportingAdmin = createAdminClient() as unknown as SearchReportingAdmin,
): Promise<LedgerSource> {
    const clientResult = await admin.from('clients')
        .select('domain')
        .eq('id', input.clientId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
    if (clientResult.error || !clientResult.data || typeof clientResult.data !== 'object') {
        throw new Error('Unable to read the results ledger');
    }
    const domain = (clientResult.data as { domain?: unknown }).domain;
    const clientDomain = typeof domain === 'string' ? domain : null;

    const integrationResult = await admin.from('client_integrations')
        .select('sync_status, last_synced_at, site_url:credentials->>site_url')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    if (integrationResult.error) throw new Error('Unable to read the results ledger');
    const integration = integrationResult.data && typeof integrationResult.data === 'object'
        ? integrationResult.data as { site_url?: unknown; sync_status?: unknown; last_synced_at?: unknown }
        : null;
    const property = typeof integration?.site_url === 'string' && integration.site_url.trim() ? integration.site_url : null;
    const lastSyncAt = typeof integration?.last_synced_at === 'string' ? integration.last_synced_at : null;
    const lastSyncErrored = integration?.sync_status === 'error';

    const deliverableRows = await readPages(() => admin.from('deliverables')
        .select('id, title, type, subtype, status, published_url, delivered_on')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('status', 'Published')
        .order('delivered_on', { ascending: false }));
    const deliverables = deliverableRows.map(deliverable);
    const empty: LedgerSource = {
        clientId: input.clientId,
        clientDomain,
        connected: Boolean(property),
        property,
        lastSyncAt,
        lastSyncErrored,
        historyStart: null,
        earliestStoredDay: null,
        historyDays: 0,
        unsurfacedRows: 0,
        days: [],
        facts: [],
        deliverables,
        factsDegraded: false,
        historyUnreadable: false,
    };
    if (!property) return empty;

    const ships = deliverables
        .map(row => normalizeShipDate(row.deliveredOn))
        .filter((day): day is string => Boolean(day))
        .sort();
    if (ships.length === 0) return readCoverage(admin, input, property, empty);

    const today = ptToday(input.now);
    const spanStart = dateOffset(ships[0], -28);
    let historyUnreadable = false;
    let dayRows: Record<string, unknown>[] = [];
    try {
        dayRows = await readPages(() => admin.from('gsc_history_days')
            .select('id, data_date, is_incomplete')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .gte('data_date', spanStart)
            .lte('data_date', today)
            .order('data_date', { ascending: true }));
    } catch {
        historyUnreadable = true;
    }
    const days: LedgerDayInput[] = dayRows.map(row => {
        if (typeof row.id !== 'string' || typeof row.data_date !== 'string') throw new Error('Unable to read the results ledger');
        return { id: row.id, date: row.data_date, isIncomplete: row.is_incomplete === true };
    });
    const dates = days.map(day => day.date).sort();
    const earliest = dates[0] ?? null;
    const needed = new Set<string>();
    for (const ship of ships) {
        const beforeStart = dateOffset(ship, -28);
        const afterEnd = dateOffset(ship, 27);
        for (const day of days) {
            if (day.date >= beforeStart && day.date < ship) needed.add(day.id);
            if (day.date >= ship && day.date <= afterEnd) needed.add(day.id);
        }
    }

    const facts: LedgerFactInput[] = [];
    let unsurfacedRows = 0;
    let factsDegraded = false;
    if (needed.size > 0 && !historyUnreadable) {
        const factRead = await readGrainedFacts(admin, {
            dayIds: [...needed],
            grains: ['page'],
            columns: 'day_id, grain, page, clicks, impressions, position, surface',
        });
        if (factRead.failedGrains.includes('page')) factsDegraded = true;
        for (const row of factsDegraded ? [] : factRead.rows) {
            if (row.grain !== 'page') continue;
            if (row.surface !== 'organic' && row.surface !== 'gbp_link') {
                unsurfacedRows += 1;
                continue;
            }
            const clicks = integer(row.clicks);
            const impressions = integer(row.impressions);
            const position = positionOf(row.position);
            if (typeof row.day_id !== 'string' || typeof row.page !== 'string' || clicks == null || impressions == null || position == null) {
                throw new Error('Unable to read the results ledger');
            }
            facts.push({
                dayId: row.day_id,
                grain: 'page',
                page: row.page,
                clicks,
                impressions,
                position,
                surface: row.surface,
            });
        }
    }

    return {
        ...empty,
        historyStart: earliest && earliest > spanStart ? earliest : null,
        earliestStoredDay: earliest,
        historyDays: days.length,
        unsurfacedRows,
        days,
        facts,
        factsDegraded,
        historyUnreadable,
    };
}

function storedDay(row: Record<string, unknown>): LedgerDayInput {
    if (typeof row.id !== 'string' || typeof row.data_date !== 'string') throw new Error('Unable to read the results ledger');
    return { id: row.id, date: row.data_date, isIncomplete: row.is_incomplete === true };
}

/**
 * Nothing has shipped, so page facts are not read. Day rows still answer
 * "how much of this window is stored?" independently of the ledger.
 */
async function readCoverage(
    admin: SearchReportingAdmin,
    input: LedgerLoadInput,
    property: string,
    empty: LedgerSource,
): Promise<LedgerSource> {
    const preset = parseRange(input.range ?? null) ?? { kind: '28d' as const, key: '28d', month: null };
    const today = ptToday(input.now);
    const monthEnd = preset.kind === 'month' && preset.month ? monthBounds(preset.month).end : today;
    const span = preset.kind === 'month' && preset.month
        ? { start: monthBounds(preset.month).start, end: monthEnd > today ? today : monthEnd }
        : { start: dateOffset(today, -LOOKBACK_DAYS), end: today };
    let dayRows: Record<string, unknown>[] = [];
    try {
        dayRows = await readPages(() => admin.from('gsc_history_days')
            .select('id, data_date, is_incomplete')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .gte('data_date', span.start)
            .lte('data_date', span.end)
            .order('data_date', { ascending: true }));
    } catch {
        return { ...empty, historyUnreadable: true, pageFactsDeferred: true };
    }
    let days: LedgerDayInput[];
    try {
        days = dayRows.map(storedDay);
    } catch {
        return { ...empty, historyUnreadable: true, pageFactsDeferred: true };
    }
    let windowDays: LedgerDayInput[];
    let windowStart: string;
    let present: number;
    let expected: number;
    if (preset.kind === 'month' && preset.month) {
        windowDays = days;
        windowStart = monthBounds(preset.month).start;
        const finality = monthFinality(preset.month, windowDays);
        present = finality.days_present;
        expected = finality.days_expected;
    } else {
        const resolved = resolveRange(preset, days, input.now);
        windowStart = resolved.current.start;
        windowDays = days.filter(day => day.date >= windowStart && day.date <= resolved.current.end);
        const covered = coverWindow(resolved.current, days);
        present = covered.daysPresent;
        expected = covered.daysExpected;
    }
    const dates = windowDays.map(day => day.date).sort();
    const earliest = dates[0] ?? null;
    return {
        ...empty,
        historyStart: earliest && earliest > windowStart ? earliest : null,
        earliestStoredDay: earliest,
        historyDays: present,
        days: windowDays,
        coverage: { present, expected },
        pageFactsDeferred: true,
    };
}
