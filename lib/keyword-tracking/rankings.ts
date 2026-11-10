/**
 * Rankings table rules for tracked keywords.
 *
 * Windows match Search Insights' 28-day pair: the current window ends on the
 * last final Search Console day, and the compare window is the adjacent 28
 * days before it. There is no second date picker.
 *
 * A missing position is not 0 and is not band 1–3. Lower position is better.
 */

import { dateOffset } from '../gsc/history';
import type { SearchReportingAdmin } from '../search-reporting/load';
import { lastFinalDate, ROLLING_DAYS, rollingSpan } from '../search-reporting/range';
import { ptToday } from '../sync/months';
import { createClient } from '../supabase/client';
import {
    GSC_NOT_MEASURABLE,
    type GscReadWindow,
    type KeywordGscWindow,
    type TrackedKeywordGscRow,
} from './gsc-read';
import { keywordTrackingEnabled } from './flag';
import type { KeywordSource } from './plan';

/** Stored on published keyword snapshots. Do not change this string. */
export const RANKING_POSITION_LABEL = 'GSC avg position, all locations & devices';

export const RANKING_POSITION_DISPLAY = 'Average Google position, all locations and devices';

export const RANKING_BANDS = [
    { id: '1-3', label: '1–3' },
    { id: '4-10', label: '4–10' },
    { id: '11-20', label: '11–20' },
    { id: '21-50', label: '21–50' },
    { id: '51-100', label: '51–100' },
] as const;

export type RankingBandId = (typeof RANKING_BANDS)[number]['id'];
export type RankingBand = (typeof RANKING_BANDS)[number];
export type RankingChange = 'New' | 'Lost' | 'Improved' | 'Declined' | 'Unchanged';

export interface RankingBandCount {
    id: RankingBandId;
    label: string;
    count: number;
}

export interface RankingsDisplayRow {
    id: string;
    keyword: string;
    source: KeywordSource;
    change: RankingChange | null;
    changeTitle: string;
    bandLabel: string | null;
    /** Null when this window is not measurable. Never coerced to 0. */
    position: number | null;
    positionText: string;
    clicksText: string;
    impressionsText: string;
    bestUrl: string | null;
    bestUrlText: string;
}

export type RankingWindowResult =
    | { enabled: false }
    | { enabled: true; ok: false; error: string }
    | {
        enabled: true;
        ok: true;
        connected: boolean;
        current: GscReadWindow;
        compare: GscReadWindow;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_PAGE = 1000;

/**
 * Inclusive from 1 through 100, with no gap between the labeled bands.
 * 3 stays in 1–3. 3.1 has left that band, so it is 4–10. 100 stays in 51–100.
 * 0, null, and anything above 100 are outside every band.
 */
export function positionBand(position: number | null): RankingBand | null {
    if (position == null || !Number.isFinite(position)) return null;
    if (position < 1 || position > 100) return null;
    if (position <= 3) return RANKING_BANDS[0];
    if (position <= 10) return RANKING_BANDS[1];
    if (position <= 20) return RANKING_BANDS[2];
    if (position <= 50) return RANKING_BANDS[3];
    return RANKING_BANDS[4];
}

/** Lower average position is better. Equal positions are Unchanged. */
export function classifyRankingChange(current: KeywordGscWindow, compare: KeywordGscWindow): RankingChange | null {
    if (current.status === 'measured' && compare.status === 'measured') {
        if (current.avgPosition < compare.avgPosition) return 'Improved';
        if (current.avgPosition > compare.avgPosition) return 'Declined';
        return 'Unchanged';
    }
    if (current.status === 'measured') return 'New';
    if (compare.status === 'measured') return 'Lost';
    return null;
}

export function rankingDistribution(positions: readonly (number | null)[]): RankingBandCount[] {
    const counts: RankingBandCount[] = RANKING_BANDS.map(band => ({ id: band.id, label: band.label, count: 0 }));
    for (const position of positions) {
        const band = positionBand(position);
        if (!band) continue;
        const row = counts.find(item => item.id === band.id);
        if (row) row.count += 1;
    }
    return counts;
}

/** Adjacent 28-day windows ending on `end`, same shape as Search Insights' rolling pair. */
export function rankingWindows(end: string): { current: GscReadWindow; compare: GscReadWindow } {
    const current = rollingSpan(end, ROLLING_DAYS);
    const compare = rollingSpan(dateOffset(current.start, -1), ROLLING_DAYS);
    return { current, compare };
}

/** Current window ends on the last final day on or before today, else today. */
export function rankingWindowsForDays(
    days: readonly { date: string; isIncomplete: boolean }[],
    now = new Date(),
): { current: GscReadWindow; compare: GscReadWindow } {
    const today = ptToday(now);
    return rankingWindows(lastFinalDate([...days], today) ?? today);
}

export function formatMeasuredCount(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return GSC_NOT_MEASURABLE;
    return new Intl.NumberFormat('en-US').format(value);
}

export function formatMeasuredPosition(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return GSC_NOT_MEASURABLE;
    return value.toFixed(1);
}

export function rankingUrlLabel(url: string | null): string {
    if (!url) return GSC_NOT_MEASURABLE;
    try {
        const parsed = new URL(url);
        const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '');
        return `${parsed.host}${path || '/'}`;
    } catch {
        return url;
    }
}

function unmeasured(): KeywordGscWindow {
    return {
        status: GSC_NOT_MEASURABLE,
        clicks: null,
        impressions: null,
        avgPosition: null,
        bestUrl: null,
    };
}

function changeTitle(change: RankingChange | null, current: KeywordGscWindow, compare: KeywordGscWindow): string {
    const currentText = formatMeasuredPosition(current.status === 'measured' ? current.avgPosition : null);
    const compareText = formatMeasuredPosition(compare.status === 'measured' ? compare.avgPosition : null);
    if (change == null) return 'Not measurable in either window.';
    if (change === 'New') return 'New. The compare window is not measurable.';
    if (change === 'Lost') return `Lost. This window is not measurable. Compare position was ${compareText}.`;
    return `${change}. ${currentText} vs ${compareText}. Lower is better.`;
}

export function rankingsDisplayRows(
    keywords: readonly { id: string; keyword: string; source: KeywordSource }[],
    gscRows: readonly TrackedKeywordGscRow[],
): RankingsDisplayRow[] {
    const byId = new Map(gscRows.map(row => [row.id, row]));
    const rows = keywords.map(keyword => {
        const metrics = byId.get(keyword.id);
        const current = metrics?.current ?? unmeasured();
        const compare = metrics?.compare ?? unmeasured();
        const position = current.status === 'measured' ? current.avgPosition : null;
        const band = positionBand(position);
        const change = classifyRankingChange(current, compare);
        const bestUrl = current.status === 'measured' ? current.bestUrl : null;
        return {
            id: keyword.id,
            keyword: keyword.keyword,
            source: keyword.source,
            change,
            changeTitle: changeTitle(change, current, compare),
            bandLabel: band?.label ?? null,
            position,
            positionText: formatMeasuredPosition(position),
            clicksText: formatMeasuredCount(current.status === 'measured' ? current.clicks : null),
            impressionsText: formatMeasuredCount(current.status === 'measured' ? current.impressions : null),
            bestUrl,
            bestUrlText: rankingUrlLabel(bestUrl),
        };
    });
    return rows.sort((a, b) => {
        if (a.position == null && b.position == null) return a.keyword.localeCompare(b.keyword);
        if (a.position == null) return 1;
        if (b.position == null) return -1;
        if (a.position !== b.position) return a.position - b.position;
        return a.keyword.localeCompare(b.keyword);
    });
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    if (typeof siteUrl !== 'string') return null;
    const trimmed = siteUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export async function loadRankingWindows(input: {
    organizationId: string;
    clientId: string;
    now?: Date;
    /** Injected in tests. Omitted uses the signed-in browser client. */
    client?: SearchReportingAdmin | null;
}): Promise<RankingWindowResult> {
    if (!keywordTrackingEnabled()) return { enabled: false };
    const now = input.now ?? new Date();
    const today = ptToday(now);
    const admin = input.client === undefined
        ? createClient() as unknown as SearchReportingAdmin | undefined
        : input.client;
    if (!admin) return { enabled: true, ok: false, error: 'Keyword tracking is unavailable.' };

    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) throw new Error('Unable to read Search Console history');
        const property = siteUrlOf(integration.data);
        if (!property) return { enabled: true, ok: true, connected: false, ...rankingWindows(today) };

        const { data, error } = await admin.from('gsc_history_days')
            .select('data_date, is_incomplete')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .lte('data_date', today)
            .order('data_date', { ascending: false })
            .range(0, DAY_PAGE - 1);
        if (error) throw new Error('Unable to read Search Console history');
        const batch = Array.isArray(data) ? data as Record<string, unknown>[] : null;
        if (!batch) throw new Error('Unable to read Search Console history');
        const days: { date: string; isIncomplete: boolean }[] = [];
        for (const row of batch) {
            const raw = typeof row.data_date === 'string' ? row.data_date.slice(0, 10) : '';
            if (!ISO_DATE.test(raw)) continue;
            days.push({ date: raw, isIncomplete: row.is_incomplete === true });
        }
        const end = lastFinalDate(days, today);
        if (!end && batch.length === DAY_PAGE) throw new Error('Unable to read Search Console history');
        return { enabled: true, ok: true, connected: true, ...rankingWindows(end ?? today) };
    } catch {
        console.error('Could not read Search Console history for tracked keywords.');
        return { enabled: true, ok: false, error: 'Could not read Search Console history for tracked keywords.' };
    }
}
