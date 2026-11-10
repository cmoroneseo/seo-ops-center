/**
 * Frozen tracked-keyword block for a published report.
 *
 * The numbers come from the Rankings read: loadRankingWindows,
 * loadTrackedKeywordGsc, rankingsDisplayRows, rankingDistribution, and
 * keyword cannibalization on that same read. This module does not score
 * positions on its own.
 *
 * A draft asks for a live read. A published report renders the payload
 * stored in report_tracking_snapshots. A missing payload is not available.
 * It is never filled from the current facts, and a missing observation is
 * never stored as 0.
 */

import { createClient } from '../supabase/client';
import type { SearchReportingAdmin } from '../search-reporting/load';
import {
    loadTrackedKeywordGsc,
    type GscReadWindow,
    type TrackedKeywordGscRow,
} from './gsc-read';
import { keywordTrackingEnabled } from './flag';
import type { KeywordSource } from './plan';
import {
    loadRankingWindows,
    RANKING_POSITION_LABEL,
    rankingDistribution,
    rankingsDisplayRows,
    type RankingBandCount,
    type RankingChange,
} from './rankings';
import { unmeasuredCannibalization, type CannibalizationReport } from './cannibalization';

export const TRACKED_KEYWORDS_BLOCK = 'tracked_keywords_gsc' as const;
export const TRACKED_KEYWORDS_REPORT_LABEL = 'Tracked keywords';
export const TRACKING_SNAPSHOT_SCHEMA = 1;
export const TRACKING_SNAPSHOT_UNAVAILABLE = 'These keyword numbers are not available yet.';
export const TRACKING_SNAPSHOT_EMPTY = 'No tracked keywords yet.';
export const TRACKING_SNAPSHOT_DISCONNECTED = 'Search Console is not connected for this client.';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCES = new Set<KeywordSource>(['paste', 'gsc_promote', 'ahrefs_import', 'research']);

export interface FrozenTrackedKeyword {
    id: string;
    keyword: string;
    change: RankingChange | null;
    /** Null when this window was not measurable. Never a stand-in for zero. */
    position: number | null;
    clicks: number | null;
    impressions: number | null;
    bestUrl: string | null;
}

export interface TrackedKeywordReportSnapshot {
    schemaVersion: typeof TRACKING_SNAPSHOT_SCHEMA;
    sourceLabel: typeof RANKING_POSITION_LABEL;
    capturedAt: string;
    state: 'empty' | 'unmeasured' | 'measured';
    /** Null when the property was not checked. False when it is not connected. */
    connected: boolean | null;
    window: { current: GscReadWindow; compare: GscReadWindow } | null;
    keywords: FrozenTrackedKeyword[];
    /** Null when no keyword has a measured position. Not a row of zeros. */
    distribution: RankingBandCount[] | null;
    /** Null when the tracked set is empty. Health null means not measurable. */
    cannibalization: CannibalizationReport | null;
}

export interface TrackingSnapshotWrite {
    organizationId: string;
    clientId: string;
    reportId: string;
    payload: TrackedKeywordReportSnapshot;
    capturedAt: string;
}

export type CaptureTrackingResult =
    | { ok: true; skipped: 'flag' | 'block' | 'client'; snapshot: null }
    | { ok: true; skipped: null; snapshot: TrackedKeywordReportSnapshot }
    | { ok: false; error: string };

type SnapshotReport = {
    id: string;
    organization_id: string;
    client_id: string | null;
    sections: unknown;
};

function countOrNull(value: unknown): number | null | undefined {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
    return value;
}

function windowOf(value: unknown): GscReadWindow | null | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as { start?: unknown; end?: unknown };
    if (typeof row.start !== 'string' || typeof row.end !== 'string') return undefined;
    if (!ISO_DATE.test(row.start) || !ISO_DATE.test(row.end) || row.start > row.end) return undefined;
    return { start: row.start, end: row.end };
}

function keywordOf(value: unknown): FrozenTrackedKeyword | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.keyword !== 'string' || !row.keyword.trim()) return null;
    const change = row.change;
    if (change != null && change !== 'New' && change !== 'Lost' && change !== 'Improved' && change !== 'Declined' && change !== 'Unchanged') {
        return null;
    }
    const position = countOrNull(row.position);
    const clicks = countOrNull(row.clicks);
    const impressions = countOrNull(row.impressions);
    if (position === undefined || clicks === undefined || impressions === undefined) return null;
    if (row.bestUrl != null && typeof row.bestUrl !== 'string') return null;
    return {
        id: row.id,
        keyword: row.keyword,
        change: change ?? null,
        position,
        clicks,
        impressions,
        bestUrl: typeof row.bestUrl === 'string' && row.bestUrl ? row.bestUrl : null,
    };
}

function distributionOf(value: unknown): RankingBandCount[] | null | undefined {
    if (value == null) return null;
    if (!Array.isArray(value)) return undefined;
    const bands: RankingBandCount[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const row = item as { id?: unknown; label?: unknown; count?: unknown };
        if (typeof row.id !== 'string' || typeof row.label !== 'string') return undefined;
        if (typeof row.count !== 'number' || !Number.isInteger(row.count) || row.count < 0) return undefined;
        bands.push({ id: row.id as RankingBandCount['id'], label: row.label, count: row.count });
    }
    return bands;
}

function cannibalOf(value: unknown): CannibalizationReport | null | undefined {
    if (value == null) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    if (typeof row.tracked !== 'number' || !Number.isInteger(row.tracked) || row.tracked < 0) return undefined;
    const affected = row.affected == null ? null : row.affected;
    if (affected != null && (typeof affected !== 'number' || !Number.isInteger(affected) || affected < 0)) return undefined;
    const health = row.health == null ? null : row.health;
    if (health != null && (typeof health !== 'number' || !Number.isFinite(health))) return undefined;
    if (!Array.isArray(row.keywords)) return undefined;
    const keywords: CannibalizationReport['keywords'] = [];
    for (const item of row.keywords) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
        const keyword = item as { id?: unknown; keyword?: unknown; urls?: unknown };
        if (typeof keyword.id !== 'string' || typeof keyword.keyword !== 'string' || !Array.isArray(keyword.urls)) return undefined;
        const urls: CannibalizationReport['keywords'][number]['urls'] = [];
        for (const url of keyword.urls) {
            if (!url || typeof url !== 'object' || Array.isArray(url)) return undefined;
            const page = url as { url?: unknown; clicks?: unknown; impressions?: unknown; avgPosition?: unknown };
            if (typeof page.url !== 'string') return undefined;
            const clicks = countOrNull(page.clicks);
            const impressions = countOrNull(page.impressions);
            const avgPosition = countOrNull(page.avgPosition);
            if (clicks === undefined || impressions === undefined || avgPosition === undefined || impressions == null) return undefined;
            urls.push({ url: page.url, clicks, impressions, avgPosition });
        }
        keywords.push({ id: keyword.id, keyword: keyword.keyword, urls });
    }
    return { tracked: row.tracked, affected, health, keywords };
}

/** Reject a payload that is missing pieces instead of filling them with zero. */
export function parseTrackedKeywordReportSnapshot(value: unknown): TrackedKeywordReportSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.schemaVersion !== TRACKING_SNAPSHOT_SCHEMA) return null;
    if (row.sourceLabel !== RANKING_POSITION_LABEL) return null;
    if (row.state !== 'empty' && row.state !== 'unmeasured' && row.state !== 'measured') return null;
    if (typeof row.capturedAt !== 'string' || Number.isNaN(Date.parse(row.capturedAt))) return null;
    if (row.connected != null && typeof row.connected !== 'boolean') return null;
    if (!Array.isArray(row.keywords)) return null;
    const keywords: FrozenTrackedKeyword[] = [];
    for (const item of row.keywords) {
        const keyword = keywordOf(item);
        if (!keyword) return null;
        keywords.push(keyword);
    }
    const current = row.window == null ? null : windowOf((row.window as { current?: unknown }).current);
    const compare = row.window == null ? null : windowOf((row.window as { compare?: unknown }).compare);
    if (row.window != null && (!current || !compare)) return null;
    const distribution = distributionOf(row.distribution);
    const cannibalization = cannibalOf(row.cannibalization);
    if (distribution === undefined || cannibalization === undefined) return null;
    if (row.state === 'empty' && (keywords.length > 0 || distribution != null || cannibalization != null)) return null;
    return {
        schemaVersion: TRACKING_SNAPSHOT_SCHEMA,
        sourceLabel: RANKING_POSITION_LABEL,
        capturedAt: row.capturedAt,
        state: row.state,
        connected: row.connected ?? null,
        window: current && compare ? { current, compare } : null,
        keywords,
        distribution,
        cannibalization,
    };
}

export function reportHasTrackedKeywordsBlock(sections: unknown): boolean {
    if (!sections || Array.isArray(sections) || typeof sections !== 'object') return false;
    const blocks = (sections as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return false;
    return blocks.some(block => !!block && typeof block === 'object' && (block as { type?: unknown }).type === TRACKED_KEYWORDS_BLOCK);
}

export function freezeTrackedKeywordReport(input: {
    capturedAt: string;
    keywords: readonly { id: string; keyword: string; source: KeywordSource }[];
    connected: boolean | null;
    window: { current: GscReadWindow; compare: GscReadWindow } | null;
    gscRows: readonly TrackedKeywordGscRow[];
    cannibalization: CannibalizationReport | null;
}): TrackedKeywordReportSnapshot {
    if (input.keywords.length === 0) {
        return {
            schemaVersion: TRACKING_SNAPSHOT_SCHEMA,
            sourceLabel: RANKING_POSITION_LABEL,
            capturedAt: input.capturedAt,
            state: 'empty',
            connected: null,
            window: null,
            keywords: [],
            distribution: null,
            cannibalization: null,
        };
    }
    const display = rankingsDisplayRows(input.keywords, input.gscRows);
    const byId = new Map(input.gscRows.map(row => [row.id, row]));
    const keywords = display.map(row => {
        const current = byId.get(row.id)?.current;
        const measured = current?.status === 'measured';
        return {
            id: row.id,
            keyword: row.keyword,
            change: row.change,
            position: measured ? current.avgPosition : null,
            clicks: measured ? current.clicks : null,
            impressions: measured ? current.impressions : null,
            bestUrl: measured ? current.bestUrl : null,
        };
    });
    const measuredRead = input.connected === true;
    const distribution = measuredRead && keywords.some(row => row.position != null)
        ? rankingDistribution(keywords.map(row => row.position))
        : null;
    return {
        schemaVersion: TRACKING_SNAPSHOT_SCHEMA,
        sourceLabel: RANKING_POSITION_LABEL,
        capturedAt: input.capturedAt,
        state: measuredRead ? 'measured' : 'unmeasured',
        connected: input.connected,
        window: input.window,
        keywords,
        distribution,
        cannibalization: input.cannibalization ?? unmeasuredCannibalization(input.keywords.length),
    };
}

async function listActiveKeywords(
    admin: SearchReportingAdmin,
    organizationId: string,
    clientId: string,
): Promise<{ id: string; keyword: string; source: KeywordSource }[] | null> {
    const { data, error } = await admin.from('tracked_keywords')
        .select('id, keyword, source')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('active', true)
        .order('created_at', { ascending: true })
        .range(0, 499);
    if (error || !Array.isArray(data)) return null;
    if (data.length >= 500) return null;
    const keywords: { id: string; keyword: string; source: KeywordSource }[] = [];
    for (const item of data) {
        if (!item || typeof item !== 'object') return null;
        const row = item as { id?: unknown; keyword?: unknown; source?: unknown };
        if (typeof row.id !== 'string' || typeof row.keyword !== 'string' || !row.keyword.trim()) return null;
        const source = SOURCES.has(row.source as KeywordSource) ? row.source as KeywordSource : 'paste';
        keywords.push({ id: row.id, keyword: row.keyword, source });
    }
    return keywords;
}

async function readTrackedKeywordReport(input: {
    organizationId: string;
    clientId: string;
    now: Date;
    client: SearchReportingAdmin;
}): Promise<{ ok: true; snapshot: TrackedKeywordReportSnapshot } | { ok: false; error: string }> {
    const capturedAt = input.now.toISOString();
    let keywords: { id: string; keyword: string; source: KeywordSource }[] | null;
    try {
        keywords = await listActiveKeywords(input.client, input.organizationId, input.clientId);
    } catch {
        return { ok: false, error: 'Could not load tracked keywords.' };
    }
    if (!keywords) return { ok: false, error: 'Could not load tracked keywords.' };
    if (keywords.length === 0) {
        return {
            ok: true,
            snapshot: freezeTrackedKeywordReport({
                capturedAt,
                keywords,
                connected: null,
                window: null,
                gscRows: [],
                cannibalization: null,
            }),
        };
    }

    const period = await loadRankingWindows({
        organizationId: input.organizationId,
        clientId: input.clientId,
        now: input.now,
        client: input.client,
    });
    if (!period.enabled || !period.ok) return { ok: false, error: 'Could not read Search Console history for tracked keywords.' };
    if (!period.connected) {
        return {
            ok: true,
            snapshot: freezeTrackedKeywordReport({
                capturedAt,
                keywords,
                connected: false,
                window: { current: period.current, compare: period.compare },
                gscRows: [],
                cannibalization: unmeasuredCannibalization(keywords.length),
            }),
        };
    }

    const gsc = await loadTrackedKeywordGsc({
        organizationId: input.organizationId,
        clientId: input.clientId,
        keywords: keywords.map(keyword => ({ id: keyword.id, keyword: keyword.keyword })),
        current: period.current,
        compare: period.compare,
        client: input.client,
    });
    if (!gsc.enabled || !gsc.ok) return { ok: false, error: 'Could not read Search Console history for tracked keywords.' };
    if (!gsc.connected) {
        return {
            ok: true,
            snapshot: freezeTrackedKeywordReport({
                capturedAt,
                keywords,
                connected: false,
                window: { current: period.current, compare: period.compare },
                gscRows: [],
                cannibalization: unmeasuredCannibalization(keywords.length),
            }),
        };
    }
    return {
        ok: true,
        snapshot: freezeTrackedKeywordReport({
            capturedAt,
            keywords,
            connected: true,
            window: { current: period.current, compare: period.compare },
            gscRows: gsc.rows,
            cannibalization: gsc.cannibalization,
        }),
    };
}

export async function loadDraftTrackedKeywordReport(input: {
    organizationId: string;
    clientId: string;
    now?: Date;
    /** Injected in tests. Omitted uses the signed-in browser client. */
    client?: SearchReportingAdmin | null;
}): Promise<
    | { enabled: false }
    | { enabled: true; ok: false; error: string }
    | { enabled: true; ok: true; snapshot: TrackedKeywordReportSnapshot }
> {
    if (!keywordTrackingEnabled()) return { enabled: false };
    const admin = input.client === undefined
        ? createClient() as unknown as SearchReportingAdmin | undefined
        : input.client;
    if (!admin) return { enabled: true, ok: false, error: 'Could not load tracked keywords.' };
    const read = await readTrackedKeywordReport({
        organizationId: input.organizationId,
        clientId: input.clientId,
        now: input.now ?? new Date(),
        client: admin,
    });
    if (!read.ok) return { enabled: true, ok: false, error: read.error };
    return { enabled: true, ok: true, snapshot: read.snapshot };
}

export async function captureTrackedKeywordSnapshot(input: {
    report: SnapshotReport;
    now?: Date;
    /** Injected in tests. The publish route passes the signed-in user client. */
    client?: SearchReportingAdmin | null;
    write: (row: TrackingSnapshotWrite) => Promise<{ ok: boolean }>;
}): Promise<CaptureTrackingResult> {
    if (!keywordTrackingEnabled()) return { ok: true, skipped: 'flag', snapshot: null };
    if (!reportHasTrackedKeywordsBlock(input.report.sections)) return { ok: true, skipped: 'block', snapshot: null };
    if (!input.report.client_id) return { ok: true, skipped: 'client', snapshot: null };
    if (!input.client) return { ok: false, error: 'Could not snapshot tracked keywords.' };

    const read = await readTrackedKeywordReport({
        organizationId: input.report.organization_id,
        clientId: input.report.client_id,
        now: input.now ?? new Date(),
        client: input.client,
    });
    if (!read.ok) return { ok: false, error: 'Could not snapshot tracked keywords.' };
    const capturedAt = read.snapshot.capturedAt;
    const written = await input.write({
        organizationId: input.report.organization_id,
        clientId: input.report.client_id,
        reportId: input.report.id,
        payload: read.snapshot,
        capturedAt,
    });
    if (!written.ok) return { ok: false, error: 'Could not snapshot tracked keywords.' };
    return { ok: true, skipped: null, snapshot: read.snapshot };
}

export async function readStoredTrackingSnapshot(input: {
    reportId: string;
    organizationId: string;
    clientId: string;
    /** Injected in tests. Omitted does not guess a client. */
    client?: SearchReportingAdmin | null;
}): Promise<TrackedKeywordReportSnapshot | null> {
    if (!keywordTrackingEnabled()) return null;
    if (!input.client) return null;
    try {
        const { data, error } = await input.client.from('report_tracking_snapshots')
            .select('payload')
            .eq('report_id', input.reportId)
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .order('captured_at', { ascending: false })
            .range(0, 0);
        if (error || !Array.isArray(data)) {
            console.error('Could not read the tracked keyword snapshot.');
            return null;
        }
        if (data.length === 0) return null;
        const row = data[0] as { payload?: unknown };
        return parseTrackedKeywordReportSnapshot(row.payload);
    } catch {
        console.error('Could not read the tracked keyword snapshot.');
        return null;
    }
}
