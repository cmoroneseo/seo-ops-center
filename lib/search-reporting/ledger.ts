/**
 * SEO Plan › Results. Joins a shipped URL to v1 page facts (grain `page`)
 * and reads organic vs Business Profile from the `surface` column.
 * `page_device` and `page_organic` are ignored so an unwound v2 grain cannot
 * double-count, and a missing grain is never rendered as zero.
 */

import { dateOffset } from '@/lib/gsc/history';
import { monthFinality } from '@/lib/gsc/monthly';
import { FRESH_WINDOW_MS, formatAsOfDate } from '@/lib/reporting/freshness';
import { searchInsightsHref } from '@/lib/reporting/receipt';
import { ptToday } from '@/lib/sync/months';
import { coverWindow, eachDate, inclusiveDays } from './range';
import { sumMetrics } from './metrics';
import {
    gscPageKey,
    isClientHost,
    isMissingProof,
    normalizeShipDate,
    proofHost,
} from './proof';

export const JUDGE_FLOOR_DAYS = 28;

export const IMPACT_WINDOWS = {
    new_page: { minDays: 30, maxDays: 90 },
    optimization: { minDays: 14, maxDays: 60 },
    gbp_post: { minDays: 7, maxDays: 30 },
    backlink: { minDays: 30, maxDays: 120 },
} as const;

export type ImpactKind = keyof typeof IMPACT_WINDOWS;
export type PlanView = 'plan' | 'tasks' | 'results';
export type LedgerVerdict = 'too_early' | 'inconclusive' | 'after_shipped' | 'not_measurable' | 'not_connected';

export const LEDGER_COPY = {
    tooEarly: 'Too early to judge',
    inconclusive: 'Inconclusive',
    notMeasurable: 'Not measurable in Search Console',
    notConnectedChip: "Can't measure",
    notConnected: "Can't measure: Search Console isn't connected.",
    empty: 'No shipped work recorded yet. Work shows up here once it has a ship date and a page URL.',
    afterIncomplete: 'Inconclusive: the days after this shipped are not a full 28 yet.',
} as const;

export interface LedgerDeliverableInput {
    id: string;
    title: string;
    type: string;
    subtype?: string | null;
    status: string;
    publishedUrl?: string | null;
    deliveredOn?: string | null;
}

export interface LedgerDayInput {
    id: string;
    date: string;
    isIncomplete: boolean;
}

export interface LedgerFactInput {
    dayId: string;
    grain: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
    surface: string;
}

export interface LedgerSource {
    clientId: string;
    clientDomain: string | null;
    connected: boolean;
    property: string | null;
    lastSyncAt: string | null;
    lastSyncErrored: boolean;
    /** Earliest stored day inside the read. Null when that day is the edge of the read and older history may exist. */
    historyStart: string | null;
    earliestStoredDay: string | null;
    historyDays: number;
    unsurfacedRows: number;
    days: LedgerDayInput[];
    facts: LedgerFactInput[];
    deliverables: LedgerDeliverableInput[];
}

export interface LedgerCount {
    impressions: number;
    clicks: number;
    position: number | null;
}

export interface LedgerMeasured {
    before: LedgerCount;
    after: LedgerCount & { series: number[] };
}

export interface LedgerEntry {
    id: string;
    title: string;
    type: string;
    subtype: string | null;
    kind: ImpactKind;
    shippedOn: string;
    publishedUrl: string;
    verdict: LedgerVerdict;
    chip: string;
    detail: string;
    footnote: string | null;
    range: string;
    insightsHref: string;
    datesLabel: string | null;
    organic: LedgerMeasured | null;
    map: LedgerMeasured | null;
}

export interface MissingProofItem {
    id: string;
    title: string;
    deliveredOn: string | null;
}

export interface LedgerGap {
    id: string;
    label: string;
    value: string;
    detail: string;
}

export interface LedgerModel {
    clientId: string;
    property: string | null;
    connected: boolean;
    state: 'not_connected' | 'fresh' | 'stale' | 'partial';
    banner: string | null;
    empty: string | null;
    latest: { id: string; title: string; verdict: string } | null;
    entries: LedgerEntry[];
    missingProof: MissingProofItem[];
    gaps: LedgerGap[];
    historyStart: string | null;
    historyDays: number;
    lastSyncAt: string | null;
}

interface DatedFact {
    date: string;
    pageKey: string;
    surface: 'organic' | 'gbp_link';
    clicks: number;
    impressions: number;
    position: number;
}

const COUNT = new Intl.NumberFormat('en-US');

export function parsePlanView(value: string | null | undefined, reportingEnabled: boolean): PlanView {
    if (value === 'tasks') return 'tasks';
    if (value === 'results' && reportingEnabled) return 'results';
    return 'plan';
}

export function impactKind(type: string, subtype?: string | null): ImpactKind {
    if (type === 'GBP' || subtype === 'gbp_management') return 'gbp_post';
    if (type === 'Backlink' || subtype === 'link_building') return 'backlink';
    if (subtype === 'blog' || subtype === 'service_page' || subtype === 'city_page' || subtype === 'landing_page') return 'new_page';
    return 'optimization';
}

export function judgeAfterDays(kind: ImpactKind): number {
    return Math.max(JUDGE_FLOOR_DAYS, IMPACT_WINDOWS[kind].minDays);
}

export function ledgerInsightsHref(clientId: string, range: string): string {
    const href = searchInsightsHref(clientId, range);
    return href.replace('?range=', '?tab=insights&range=');
}

function monthDay(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(Date.UTC(year, month - 1, day)));
}

function daysSince(ship: string, today: string): number {
    if (ship > today) return -1;
    return inclusiveDays(ship, today) - 1;
}

function noBaseline(ship: string, historyStart: string | null): string {
    const when = monthDay(ship);
    if (!historyStart) return `Inconclusive: no 28-day baseline before ${when}.`;
    return `Inconclusive: no 28-day baseline before ${when}. History starts ${monthDay(historyStart)}.`;
}

function afterShipped(metric: string, from: number, to: number): string {
    return `After this shipped: ${metric} ${COUNT.format(from)} → ${COUNT.format(to)}`;
}

function staleFootnote(lastSyncAt: string | null): string {
    if (!lastSyncAt) return 'Results as of the last sync.';
    const at = new Date(lastSyncAt);
    if (Number.isNaN(at.getTime())) return 'Results as of the last sync.';
    return `Results as of ${formatAsOfDate(at)}.`;
}

function isStale(source: LedgerSource, now: Date): boolean {
    if (!source.connected) return false;
    if (source.lastSyncErrored || !source.lastSyncAt) return true;
    const at = new Date(source.lastSyncAt);
    if (Number.isNaN(at.getTime())) return true;
    return now.getTime() - at.getTime() > FRESH_WINDOW_MS.gsc;
}

function measure(facts: DatedFact[], pageKey: string, surface: 'organic' | 'gbp_link', start: string, end: string): LedgerCount & { series: number[] } {
    const series: number[] = [];
    const rows: { clicks: number; impressions: number; position: number }[] = [];
    for (const date of eachDate(start, end)) {
        const dayRows = facts.filter(fact => fact.date === date && fact.pageKey === pageKey && fact.surface === surface);
        const day = sumMetrics(dayRows);
        series.push(day.impressions);
        rows.push(...dayRows);
    }
    const total = sumMetrics(rows);
    return { impressions: total.impressions, clicks: total.clicks, position: total.position, series };
}

export function buildLedger(source: LedgerSource, now: Date): LedgerModel {
    const today = ptToday(now);
    const stale = isStale(source, now);
    const footnote = stale ? staleFootnote(source.lastSyncAt) : null;
    const byId = new Map(source.days.map(day => [day.id, day]));
    const facts: DatedFact[] = [];
    for (const fact of source.facts) {
        if (fact.grain !== 'page') continue;
        if (fact.surface !== 'organic' && fact.surface !== 'gbp_link') continue;
        const day = byId.get(fact.dayId);
        if (!day || day.isIncomplete) continue;
        const pageKey = gscPageKey(fact.page);
        if (!pageKey) continue;
        facts.push({
            date: day.date,
            pageKey,
            surface: fact.surface,
            clicks: fact.clicks,
            impressions: fact.impressions,
            position: fact.position,
        });
    }

    const missingProof: MissingProofItem[] = [];
    const entries: LedgerEntry[] = [];

    for (const row of source.deliverables) {
        if (row.status !== 'Published') continue;
        const shippedOn = normalizeShipDate(row.deliveredOn);
        const url = row.publishedUrl?.trim() ?? '';
        if (isMissingProof({ status: row.status, publishedUrl: url, deliveredOn: shippedOn })) {
            missingProof.push({ id: row.id, title: row.title || 'Untitled', deliveredOn: shippedOn });
            continue;
        }
        if (!shippedOn || !url) continue;

        const kind = impactKind(row.type, row.subtype);
        const host = proofHost(url);
        const onClient = host != null && isClientHost(host, source.clientDomain);
        const range = shippedOn.slice(0, 7);
        const base = {
            id: row.id,
            title: row.title || 'Untitled',
            type: row.type,
            subtype: row.subtype ?? null,
            kind,
            shippedOn,
            publishedUrl: url,
            footnote,
            range,
            insightsHref: ledgerInsightsHref(source.clientId, range),
        };

        if (!source.connected) {
            entries.push({
                ...base,
                verdict: 'not_connected',
                chip: LEDGER_COPY.notConnectedChip,
                detail: LEDGER_COPY.notConnected,
                datesLabel: null,
                organic: null,
                map: null,
            });
            continue;
        }

        if (!onClient || kind === 'gbp_post') {
            entries.push({
                ...base,
                verdict: 'not_measurable',
                chip: LEDGER_COPY.notMeasurable,
                detail: LEDGER_COPY.notMeasurable,
                datesLabel: null,
                organic: null,
                map: null,
            });
            continue;
        }

        const judgeAfter = judgeAfterDays(kind);
        const beforeStart = dateOffset(shippedOn, -JUDGE_FLOOR_DAYS);
        const beforeEnd = dateOffset(shippedOn, -1);
        const afterStart = shippedOn;
        const afterEnd = dateOffset(shippedOn, JUDGE_FLOOR_DAYS - 1);
        const datesLabel = `${monthDay(beforeStart)}–${monthDay(beforeEnd)} vs ${monthDay(afterStart)}–${monthDay(afterEnd)}`;
        const pageKey = gscPageKey(url);

        if (daysSince(shippedOn, today) < judgeAfter || !pageKey) {
            entries.push({
                ...base,
                verdict: 'too_early',
                chip: LEDGER_COPY.tooEarly,
                detail: `${LEDGER_COPY.tooEarly}. A reading waits until day ${judgeAfter} after ${monthDay(shippedOn)}.`,
                datesLabel,
                organic: null,
                map: null,
            });
            continue;
        }

        const before = coverWindow({ start: beforeStart, end: beforeEnd }, source.days);
        const after = coverWindow({ start: afterStart, end: afterEnd }, source.days);
        if (!before.final) {
            const startsLate = before.firstStored == null || before.firstStored > before.start;
            entries.push({
                ...base,
                verdict: 'inconclusive',
                chip: LEDGER_COPY.inconclusive,
                detail: startsLate ? noBaseline(shippedOn, source.historyStart) : noBaseline(shippedOn, null),
                datesLabel,
                organic: null,
                map: null,
            });
            continue;
        }
        if (!after.final) {
            entries.push({
                ...base,
                verdict: 'inconclusive',
                chip: LEDGER_COPY.inconclusive,
                detail: LEDGER_COPY.afterIncomplete,
                datesLabel,
                organic: null,
                map: null,
            });
            continue;
        }

        const organicAfter = measure(facts, pageKey, 'organic', afterStart, afterEnd);
        const organicBefore = measure(facts, pageKey, 'organic', beforeStart, beforeEnd);
        const mapAfter = measure(facts, pageKey, 'gbp_link', afterStart, afterEnd);
        const mapBefore = measure(facts, pageKey, 'gbp_link', beforeStart, beforeEnd);
        const organicTotal = organicBefore.impressions + organicAfter.impressions;
        const mapTotal = mapBefore.impressions + mapAfter.impressions;
        const useMap = organicTotal === 0 && mapTotal > 0;
        const metric = useMap ? 'Business Profile link impressions' : 'organic impressions';
        const from = useMap ? mapBefore.impressions : organicBefore.impressions;
        const to = useMap ? mapAfter.impressions : organicAfter.impressions;
        entries.push({
            ...base,
            verdict: 'after_shipped',
            chip: afterShipped(metric, from, to),
            detail: afterShipped(metric, from, to),
            datesLabel,
            organic: { before: organicBefore, after: organicAfter },
            map: { before: mapBefore, after: mapAfter },
        });
    }

    entries.sort((a, b) => b.shippedOn.localeCompare(a.shippedOn) || a.title.localeCompare(b.title));
    missingProof.sort((a, b) => a.title.localeCompare(b.title));

    const partial = entries.some(entry => entry.verdict === 'inconclusive');
    const state = !source.connected ? 'not_connected' : stale ? 'stale' : partial ? 'partial' : 'fresh';
    const banner = !source.connected
        ? LEDGER_COPY.notConnected
        : stale
            ? footnote
            : null;
    const latest = entries[0]
        ? { id: entries[0].id, title: entries[0].title, verdict: entries[0].chip }
        : null;

    const gaps: LedgerGap[] = [
        {
            id: 'missing-proof',
            label: 'Missing proof',
            value: String(missingProof.length),
            detail: missingProof.length === 0
                ? 'Every published deliverable has a page URL and a ship date.'
                : 'Published deliverables with no live URL or no ship date. Add both and they can be read.',
        },
        {
            id: 'page-facts',
            label: 'Page facts',
            value: source.connected && source.historyDays > 0 ? String(source.historyDays) : '—',
            detail: source.connected
                ? 'Results use page facts and the surface column. Device and organic-only page grains are not read.'
                : LEDGER_COPY.notConnected,
        },
    ];
    if (source.historyStart) {
        gaps.push({
            id: 'history',
            label: 'History starts',
            value: monthDay(source.historyStart),
            detail: `${source.historyDays} stored days in this read, starting ${monthDay(source.historyStart)}.`,
        });
    } else if (source.earliestStoredDay) {
        gaps.push({
            id: 'history',
            label: 'History',
            value: monthDay(source.earliestStoredDay),
            detail: `${source.historyDays} stored days in this read. Older days may exist outside it.`,
        });
    } else {
        gaps.push({
            id: 'history',
            label: 'History',
            value: '—',
            detail: source.connected
                ? 'No Search Console days are stored in this read.'
                : LEDGER_COPY.notConnected,
        });
    }
    const month = today.slice(0, 7);
    if (source.connected && source.days.some(day => day.date.startsWith(month))) {
        const finality = monthFinality(month, source.days);
        gaps.push({
            id: 'month',
            label: 'This month',
            value: finality.final ? 'Final' : 'Not final',
            detail: finality.complete_through
                ? `Stored through ${monthDay(finality.complete_through)}. Incomplete days stay out of verdicts.`
                : 'No complete day is stored in this month.',
        });
    }
    if (source.unsurfacedRows > 0) {
        gaps.push({
            id: 'surface',
            label: 'Surface',
            value: '—',
            detail: `${source.unsurfacedRows} page rows had no surface and were left out.`,
        });
    }

    return {
        clientId: source.clientId,
        property: source.property,
        connected: source.connected,
        state,
        banner,
        empty: entries.length === 0 ? LEDGER_COPY.empty : null,
        latest,
        entries,
        missingProof,
        gaps,
        historyStart: source.historyStart,
        historyDays: source.historyDays,
        lastSyncAt: source.lastSyncAt,
    };
}
