/**
 * Reads one month of Analytics events, and Tag Manager's live event tags
 * when that integration is connected. The Tag Manager call is read-only.
 */

import { eventNameFilter, ga4ReportBody } from '@/lib/ga4/sync';
import { monthBounds, previousMonth } from '@/lib/sync/months';
import { readLiveGtmEventTags, GtmContainersError } from '@/lib/google/gtm-containers';
import {
    PROPERTY_DIMENSION,
    TICKET_DIMENSION,
    buildGtmEventsReport,
    type Ga4CountRow,
    type Ga4DailyRow,
    type Ga4LinkRow,
    type GtmEventsSnapshot,
    type GtmReportSettings,
    type TagSource,
} from './gtm-events';

export const GTM_NOT_CONNECTED_NOTE = 'Connect Tag Manager for this client from Integrations. That connection requests https://www.googleapis.com/auth/tagmanager.readonly and nothing else. Until then this report lists every recorded event and does not separate a tag total.';

export const GTM_READ_FAILED_NOTE = 'Tag Manager refused the live tag read. Reconnect Tag Manager. The Google Cloud project for this app must have the Tag Manager API enabled, and the connect flow requests https://www.googleapis.com/auth/tagmanager.readonly only. A saved event list is used when one is set.';

export class GtmEventsFetchError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

export interface GtmConnection {
    token: string;
    accountId: string;
    containerId: string;
}

export interface CollectGtmEventsInput {
    fetch?: typeof fetch;
    ga4Token: string;
    propertyId: string;
    gtm: GtmConnection | null;
    settings: GtmReportSettings;
    clientName: string;
    reportMonth: string;
    now?: Date;
}

export function ga4PropertyPath(propertyId: string): string {
    const numeric = propertyId.replace(/^properties\//, '').trim();
    if (!/^\d{4,20}$/.test(numeric)) {
        throw new GtmEventsFetchError('Choose an Analytics property for this client.', 400);
    }
    return `properties/${numeric}`;
}

export function parseGa4Report(body: unknown): { dimensions: Record<string, string>; metrics: Record<string, number> }[] {
    if (!body || typeof body !== 'object') return [];
    const record = body as {
        dimensionHeaders?: { name?: string }[];
        metricHeaders?: { name?: string }[];
        rows?: { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] }[];
    };
    const dimensions = (record.dimensionHeaders ?? []).map(header => header.name ?? '');
    const metrics = (record.metricHeaders ?? []).map(header => header.name ?? '');
    return (record.rows ?? []).map(row => ({
        dimensions: Object.fromEntries(dimensions.map((name, index) => [name, row.dimensionValues?.[index]?.value ?? ''])),
        metrics: Object.fromEntries(metrics.map((name, index) => [name, Number(row.metricValues?.[index]?.value ?? 0)])),
    }));
}

async function postReport(
    request: typeof fetch,
    token: string,
    propertyPath: string,
    body: unknown,
): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
        response = await request(`https://analyticsdata.googleapis.com/v1beta/${propertyPath}:runReport`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
        });
    } catch {
        throw new GtmEventsFetchError('Could not read Analytics for this property.', 502);
    }
    const payload = await response.json().catch(() => null);
    return { status: response.status, body: payload };
}

async function reportOrThrow(
    request: typeof fetch,
    token: string,
    propertyPath: string,
    body: unknown,
): Promise<ReturnType<typeof parseGa4Report>> {
    const response = await postReport(request, token, propertyPath, body);
    if (response.status === 401 || response.status === 403) {
        throw new GtmEventsFetchError('Analytics refused this property. Reconnect Google Analytics.', response.status);
    }
    if (response.status >= 400) throw new GtmEventsFetchError('Could not read Analytics for this property.', 502);
    return parseGa4Report(response.body);
}

async function metadataNames(request: typeof fetch, token: string, propertyPath: string): Promise<Set<string>> {
    let response: Response;
    try {
        response = await request(`https://analyticsdata.googleapis.com/v1beta/${propertyPath}/metadata`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        return new Set();
    }
    if (!response.ok) return new Set();
    const body = await response.json().catch(() => null);
    const dimensions = body && typeof body === 'object' ? (body as { dimensions?: { apiName?: string }[] }).dimensions : undefined;
    return new Set((dimensions ?? []).map(dimension => dimension.apiName).filter((name): name is string => typeof name === 'string'));
}

function sessionsBody(start: string, end: string) {
    return {
        dateRanges: [{ startDate: start, endDate: end }],
        metrics: [{ name: 'sessions' }],
        limit: 10,
    };
}

function metricTotal(rows: ReturnType<typeof parseGa4Report>, name: string): number {
    return rows.reduce((sum, row) => sum + (Number.isFinite(row.metrics[name]) ? row.metrics[name] : 0), 0);
}

function countRows(rows: ReturnType<typeof parseGa4Report>): Ga4CountRow[] {
    return rows.map(row => ({ eventName: row.dimensions.eventName ?? '', count: row.metrics.eventCount ?? 0 }));
}

function linkRows(rows: ReturnType<typeof parseGa4Report>): Ga4LinkRow[] {
    return rows.map(row => ({
        eventName: row.dimensions.eventName ?? '',
        count: row.metrics.eventCount ?? 0,
        linkText: row.dimensions.linkText ?? null,
        linkUrl: row.dimensions.linkUrl ?? null,
        linkDomain: row.dimensions.linkDomain ?? null,
        property: row.dimensions[PROPERTY_DIMENSION] ?? null,
        ticketEventName: row.dimensions[TICKET_DIMENSION] ?? null,
    }));
}

function dailyRows(rows: ReturnType<typeof parseGa4Report>): Ga4DailyRow[] {
    return rows.map(row => ({
        date: row.dimensions.date ?? '',
        eventName: row.dimensions.eventName ?? '',
        count: row.metrics.eventCount ?? 0,
    }));
}

export async function collectGtmEvents(input: CollectGtmEventsInput): Promise<{ snapshot: GtmEventsSnapshot; staffNote: string | null }> {
    const request = input.fetch ?? fetch;
    const propertyPath = ga4PropertyPath(input.propertyId);
    const current = monthBounds(input.reportMonth);
    const priorMonth = previousMonth(input.reportMonth);
    const prior = monthBounds(priorMonth);
    const known = await metadataNames(request, input.ga4Token, propertyPath);

    let tagSource: TagSource = 'unavailable';
    let tags: Awaited<ReturnType<typeof readLiveGtmEventTags>> = [];
    let staffNote: string | null = GTM_NOT_CONNECTED_NOTE;
    if (input.gtm) {
        try {
            tags = await readLiveGtmEventTags(input.gtm.token, input.gtm.accountId, input.gtm.containerId, request);
            tagSource = 'gtm';
            staffNote = null;
        } catch (error) {
            if (!(error instanceof GtmContainersError)) throw error;
            staffNote = GTM_READ_FAILED_NOTE;
            tagSource = input.settings.fallbackEventNames.length > 0 ? 'saved_list' : 'unavailable';
        }
    } else if (input.settings.fallbackEventNames.length > 0) {
        tagSource = 'saved_list';
    }

    const names = [...new Set([
        ...(tagSource === 'gtm' ? tags.filter(tag => !tag.paused).map(tag => tag.eventName) : input.settings.fallbackEventNames),
        input.settings.outboundEventName,
        input.settings.bookingEventName,
        input.settings.ticketEventName,
    ].filter(Boolean))];

    const [currentEvents, priorEvents, currentSessions, priorSessions, daily] = await Promise.all([
        reportOrThrow(request, input.ga4Token, propertyPath, ga4ReportBody({
            start: current.start, end: current.end, metrics: ['eventCount'], dimensions: ['eventName'],
        })),
        reportOrThrow(request, input.ga4Token, propertyPath, ga4ReportBody({
            start: prior.start, end: prior.end, metrics: ['eventCount'], dimensions: ['eventName'],
        })),
        reportOrThrow(request, input.ga4Token, propertyPath, sessionsBody(current.start, current.end)),
        reportOrThrow(request, input.ga4Token, propertyPath, sessionsBody(prior.start, prior.end)),
        reportOrThrow(request, input.ga4Token, propertyPath, ga4ReportBody({
            start: current.start, end: current.end, metrics: ['eventCount'], dimensions: ['date', 'eventName'],
        })),
    ]);

    const custom = [PROPERTY_DIMENSION, TICKET_DIMENSION].filter(name => known.size === 0 || known.has(name));
    const linkDimensions = ['eventName', 'linkText', 'linkUrl', 'linkDomain', ...custom];
    const linkBody = (start: string, end: string, dimensions: string[]) => ga4ReportBody({
        start, end, metrics: ['eventCount'], dimensions, dimensionFilter: eventNameFilter(names),
    });
    async function linksFor(start: string, end: string) {
        const first = await postReport(request, input.ga4Token, propertyPath, linkBody(start, end, linkDimensions));
        if (first.status === 400 && custom.length > 0) {
            return reportOrThrow(request, input.ga4Token, propertyPath, linkBody(start, end, linkDimensions.filter(name => !name.startsWith('customEvent:'))));
        }
        if (first.status === 401 || first.status === 403) {
            throw new GtmEventsFetchError('Analytics refused this property. Reconnect Google Analytics.', first.status);
        }
        if (first.status >= 400) throw new GtmEventsFetchError('Could not read Analytics for this property.', 502);
        return parseGa4Report(first.body);
    }
    const [currentLinks, priorLinks] = await Promise.all([
        linksFor(current.start, current.end),
        linksFor(prior.start, prior.end),
    ]);

    const snapshot = buildGtmEventsReport({
        clientName: input.clientName,
        reportMonth: input.reportMonth,
        capturedAt: (input.now ?? new Date()).toISOString(),
        sessions: { current: metricTotal(currentSessions, 'sessions'), prior: metricTotal(priorSessions, 'sessions') },
        events: { current: countRows(currentEvents), prior: countRows(priorEvents) },
        links: { current: linkRows(currentLinks), prior: linkRows(priorLinks) },
        daily: dailyRows(daily),
        excludedLinkTexts: input.settings.excludedLinkTexts,
        tagSource,
        tags,
        fallbackEventNames: input.settings.fallbackEventNames,
        outboundEventName: input.settings.outboundEventName,
        bookingEventName: input.settings.bookingEventName,
        ticketEventName: input.settings.ticketEventName,
    });
    return { snapshot, staffNote };
}
