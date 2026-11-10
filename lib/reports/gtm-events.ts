/**
 * Client-facing GTM event report.
 *
 * Counts are assembled here. The published copy and the public link both
 * render the snapshot this returns, so a later Tag Manager edit cannot
 * change a report that was already frozen.
 *
 * Kentina Hospitality, for setup notes only (not seeded):
 * GA4 property 542058119, GTM account 6361320998,
 * container 255732081, public id GTM-W8Q8SC6V.
 * Consent clicks to exclude: "Allow cookies", "Decline".
 */

import { monthBounds, previousMonth } from '@/lib/sync/months';
import type { GtmEventTag } from '@/lib/google/gtm-containers';

export const GTM_EVENTS_SCHEMA = 1;
export const DEFAULT_OUTBOUND_EVENT = 'property_outbound_click';
export const DEFAULT_BOOKING_EVENT = 'booking_click';
export const DEFAULT_TICKET_EVENT = 'buy_tickets_click';
export const PROPERTY_DIMENSION = 'customEvent:property';
export const TICKET_DIMENSION = 'customEvent:ticket_event_name';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LIFECYCLE_EVENTS = new Set(['user_engagement', 'session_start', 'first_visit']);
const SENTINELS = new Set(['(not set)', '(other)', '(none)', 'none', 'null', '(not provided)', 'undefined', 'n/a', '(data not available)']);
const SMALL_WORDS = new Set(['de', 'del', 'la', 'of', 'the', 'and']);
const NAME_WORDS = ['hospitality', 'campground', 'portola', 'winery', 'native', 'galway', 'masia', 'vinya', 'kentina', 'bookeo', 'cross', 'creek', 'downs', 'falls', 'danza', 'trail', 'ranch', 'house', 'wine', 'golf', 'club', 'stay', 'del', 'sol', 'de', 'la'];
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

export type TagSource = 'gtm' | 'saved_list' | 'unavailable';

export interface GtmReportSettings {
    excludedLinkTexts: string[];
    /** Used only when Tag Manager is not connected. */
    fallbackEventNames: string[];
    outboundEventName: string;
    bookingEventName: string;
    ticketEventName: string;
}

export const DEFAULT_GTM_REPORT_SETTINGS: GtmReportSettings = {
    excludedLinkTexts: [],
    fallbackEventNames: [],
    outboundEventName: DEFAULT_OUTBOUND_EVENT,
    bookingEventName: DEFAULT_BOOKING_EVENT,
    ticketEventName: DEFAULT_TICKET_EVENT,
};

export interface Ga4CountRow {
    eventName: string;
    count: number;
}

export interface Ga4LinkRow {
    eventName: string;
    count: number;
    linkText?: string | null;
    linkUrl?: string | null;
    linkDomain?: string | null;
    property?: string | null;
    ticketEventName?: string | null;
}

export interface Ga4DailyRow {
    date: string;
    eventName: string;
    count: number;
}

export interface GtmCount {
    current: number;
    prior: number;
}

export interface GtmEventRow {
    name: string;
    current: number;
    prior: number;
}

export interface GtmBreakdownRow {
    label: string;
    detail: string | null;
    destination: string;
    current: number;
    prior: number;
}

export interface GtmBreakdown {
    eventName: string;
    current: number;
    prior: number;
    rows: GtmBreakdownRow[];
}

export interface GtmOutbound extends GtmBreakdown {
    byProperty: GtmBreakdownRow[];
    byLink: GtmBreakdownRow[];
}

export interface GtmTrend {
    eventName: string;
    total: number;
    days: number[];
    peakCount: number;
    peakDay: number;
}

export interface GtmEventsCopy {
    lede: string;
    totalEvents: string;
    tagEvents: string;
    sessions: string;
    events: string;
    outbound: string;
    links: string;
    booking: string;
    tickets: string;
    trends: string;
}

export interface GtmEventsSnapshot {
    schemaVersion: typeof GTM_EVENTS_SCHEMA;
    capturedAt: string;
    clientName: string;
    reportMonth: string;
    priorMonth: string;
    periodLabel: string;
    priorPeriodLabel: string;
    monthShort: string;
    priorShort: string;
    copy: GtmEventsCopy;
    kpis: {
        totalEvents: GtmCount;
        tagEvents: {
            current: number | null;
            prior: number | null;
            source: TagSource;
            tagsRecorded: number | null;
            tagsActive: number | null;
        };
        sessions: GtmCount;
    };
    events: GtmEventRow[];
    outbound: GtmOutbound | null;
    booking: GtmBreakdown | null;
    tickets: GtmBreakdown | null;
    trends: GtmTrend[];
}

export interface BuildGtmEventsInput {
    clientName: string;
    reportMonth: string;
    capturedAt: string;
    sessions: GtmCount;
    events: { current: Ga4CountRow[]; prior: Ga4CountRow[] };
    links: { current: Ga4LinkRow[]; prior: Ga4LinkRow[] };
    daily: Ga4DailyRow[];
    excludedLinkTexts: readonly string[];
    tagSource: TagSource;
    tags: readonly GtmEventTag[];
    fallbackEventNames: readonly string[];
    outboundEventName: string;
    bookingEventName: string;
    ticketEventName: string;
}

export function isSentinelLabel(value: string | null | undefined): boolean {
    if (value == null) return true;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length === 0 || SENTINELS.has(trimmed);
}

export function normalizeLinkText(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isExcludedLinkText(value: string | null | undefined, excluded: readonly string[]): boolean {
    if (value == null || isSentinelLabel(value)) return false;
    const key = normalizeLinkText(value);
    return excluded.some(item => normalizeLinkText(item) === key);
}

export function destinationHost(value: string | null | undefined): string {
    if (!value || isSentinelLabel(value)) return '';
    const trimmed = value.trim();
    try {
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        return new URL(withProtocol).hostname.replace(/^www\./i, '').toLowerCase();
    } catch {
        return trimmed.split('/')[0]?.replace(/^www\./i, '').toLowerCase() ?? '';
    }
}

export function destinationLabel(value: string | null | undefined): string {
    if (!value || isSentinelLabel(value)) return '';
    const trimmed = value.trim();
    try {
        const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
        const url = new URL(withProtocol);
        const host = url.hostname.replace(/^www\./i, '');
        const path = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '');
        return truncate(`${host}${path}`);
    } catch {
        return truncate(trimmed.split('?')[0] ?? trimmed);
    }
}

function truncate(value: string): string {
    if (value.length <= 72) return value;
    return `${value.slice(0, 71)}…`;
}

function titleWord(word: string, index: number): string {
    const lower = word.toLowerCase();
    if (index > 0 && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function splitConcat(slug: string): string[] | null {
    const dictionary = [...NAME_WORDS].sort((a, b) => b.length - a.length || a.localeCompare(b));
    const source = slug.toLowerCase();
    const walk = (index: number): string[] | null => {
        if (index === source.length) return [];
        for (const word of dictionary) {
            if (!source.startsWith(word, index)) continue;
            const rest = walk(index + word.length);
            if (rest) return [word, ...rest];
        }
        return null;
    };
    const words = walk(0);
    return words && words.length > 0 ? words : null;
}

/** A readable place name from a hostname when Analytics has no property name. */
export function friendlyNameFromDestination(destination: string): string {
    const host = destinationHost(destination);
    if (!host) return 'Link';
    const label = host.split('.')[0] || host;
    const pieces = label.includes('-') || label.includes('_')
        ? label.split(/[-_]+/).filter(Boolean)
        : splitConcat(label);
    return (pieces ?? [label]).map(titleWord).join(' ');
}

export function friendlyPropertyLabel(property: string | null | undefined, destination: string | null | undefined): string {
    if (!isSentinelLabel(property)) return property!.trim();
    if (destination && !isSentinelLabel(destination)) return friendlyNameFromDestination(destination);
    return 'Link';
}

export function formatCount(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

/** A prior-month zero is an em dash. The word "None" is never a count. */
export function formatPrior(value: number): string {
    return value > 0 ? formatCount(value) : '—';
}

export function formatChange(current: number, prior: number): { text: string; tone: 'up' | 'down' | 'flat' } {
    if (prior <= 0) return { text: 'New', tone: 'up' };
    const rounded = Math.round((((current - prior) / prior) * 100) * 10) / 10;
    if (rounded === 0) return { text: '0.0%', tone: 'flat' };
    const sign = rounded > 0 ? '+' : '';
    return { text: `${sign}${rounded.toFixed(1)}%`, tone: rounded > 0 ? 'up' : 'down' };
}

export function periodLabels(month: string): { monthName: string; short: string; range: string; days: number; start: string; end: string } {
    const bounds = monthBounds(month);
    const index = Number(month.slice(5, 7)) - 1;
    const endDay = Number(bounds.end.slice(8));
    return {
        monthName: MONTH_NAMES[index] ?? month,
        short: MONTH_SHORT[index] ?? month,
        range: `${MONTH_NAMES[index] ?? month} 1–${endDay}, ${bounds.start.slice(0, 4)}`,
        days: bounds.days,
        start: bounds.start,
        end: bounds.end,
    };
}

function finiteCount(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function sumEvents(rows: readonly Ga4CountRow[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        if (!row.eventName || isSentinelLabel(row.eventName)) continue;
        const count = finiteCount(row.count);
        if (count <= 0) continue;
        map.set(row.eventName, (map.get(row.eventName) ?? 0) + count);
    }
    return map;
}

function excludedByEvent(rows: readonly Ga4LinkRow[], excluded: readonly string[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        if (!isExcludedLinkText(row.linkText, excluded) || !row.eventName) continue;
        const count = finiteCount(row.count);
        if (count <= 0) continue;
        map.set(row.eventName, (map.get(row.eventName) ?? 0) + count);
    }
    return map;
}

function applyAdjustments(raw: Map<string, number>, excluded: Map<string, number>, names: ReadonlySet<string>): Map<string, number> {
    const next = new Map(raw);
    for (const name of names) {
        const drop = excluded.get(name) ?? 0;
        if (drop <= 0) continue;
        next.set(name, Math.max(0, (next.get(name) ?? 0) - drop));
    }
    return next;
}

function hostOf(row: Ga4LinkRow): string {
    const domain = destinationHost(row.linkDomain);
    return domain || destinationHost(row.linkUrl);
}

interface Bucket {
    label: string;
    explicit: boolean;
    detail: string | null;
    destination: string;
    current: number;
    prior: number;
}

function preferLabel(bucket: Bucket, label: string, explicit: boolean, period: 'current' | 'prior') {
    if (!explicit) return;
    if (!bucket.explicit || period === 'current') {
        bucket.label = label;
        bucket.explicit = true;
    }
}

function rowsFrom(map: Map<string, Bucket>): GtmBreakdownRow[] {
    return [...map.values()]
        .filter(row => row.current > 0)
        .sort((a, b) => b.current - a.current || a.label.localeCompare(b.label))
        .map(row => ({
            label: row.label,
            detail: row.detail && row.detail !== row.label ? row.detail : null,
            destination: row.destination,
            current: row.current,
            prior: row.prior,
        }));
}

function addCounted(map: Map<string, Bucket>, key: string, seed: Bucket, period: 'current' | 'prior', count: number, label: string, explicit: boolean) {
    const bucket = map.get(key) ?? seed;
    preferLabel(bucket, label, explicit, period);
    bucket[period] += count;
    map.set(key, bucket);
}

function propertyRows(current: readonly Ga4LinkRow[], prior: readonly Ga4LinkRow[], eventName: string, excluded: readonly string[]): GtmBreakdownRow[] {
    const map = new Map<string, Bucket>();
    const add = (row: Ga4LinkRow, period: 'current' | 'prior') => {
        if (row.eventName !== eventName || isExcludedLinkText(row.linkText, excluded)) return;
        const count = finiteCount(row.count);
        const host = hostOf(row);
        if (count <= 0 || !host) return;
        const explicit = !isSentinelLabel(row.property);
        const label = explicit ? row.property!.trim() : friendlyNameFromDestination(host);
        addCounted(map, host, { label, explicit, detail: null, destination: host, current: 0, prior: 0 }, period, count, label, explicit);
    };
    current.forEach(row => add(row, 'current'));
    prior.forEach(row => add(row, 'prior'));
    return rowsFrom(map);
}

function linkRows(current: readonly Ga4LinkRow[], prior: readonly Ga4LinkRow[], eventName: string, excluded: readonly string[], mode: 'link' | 'booking' | 'ticket'): GtmBreakdownRow[] {
    const map = new Map<string, Bucket>();
    const add = (row: Ga4LinkRow, period: 'current' | 'prior') => {
        if (row.eventName !== eventName || isExcludedLinkText(row.linkText, excluded)) return;
        const count = finiteCount(row.count);
        if (count <= 0) return;
        const host = hostOf(row);
        const destination = mode === 'link' ? host : destinationLabel(row.linkUrl || row.linkDomain);
        if (!destination) return;
        const property = friendlyPropertyLabel(row.property, host || destination);
        const ticket = !isSentinelLabel(row.ticketEventName) ? row.ticketEventName!.trim() : '';
        const link = !isSentinelLabel(row.linkText) ? row.linkText!.trim() : '';
        const label = mode === 'ticket' ? (ticket || property) : (link || property);
        const explicit = mode === 'ticket' ? Boolean(ticket) : Boolean(link);
        const pathKey = mode === 'link' ? host : destination.split('?')[0];
        const key = `${normalizeLinkText(label)}|${pathKey}`;
        addCounted(map, key, {
            label,
            explicit,
            detail: property !== label ? property : null,
            destination,
            current: 0,
            prior: 0,
        }, period, count, label, explicit);
    };
    current.forEach(row => add(row, 'current'));
    prior.forEach(row => add(row, 'prior'));
    return rowsFrom(map);
}

function normalizeDay(value: string): string | null {
    if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return null;
}

function trendFor(eventName: string, total: number, daily: readonly Ga4DailyRow[], start: string, days: number): GtmTrend {
    const counts = Array.from({ length: days }, () => 0);
    for (const row of daily) {
        if (row.eventName !== eventName) continue;
        const date = normalizeDay(row.date);
        if (!date || date < start) continue;
        const day = Number(date.slice(8));
        if (day < 1 || day > days) continue;
        counts[day - 1] += finiteCount(row.count);
    }
    let peakDay = 1;
    let peakCount = counts[0] ?? 0;
    counts.forEach((count, index) => {
        if (count > peakCount) {
            peakCount = count;
            peakDay = index + 1;
        }
    });
    return { eventName, total, days: counts, peakCount, peakDay };
}

function tagNamesFor(input: BuildGtmEventsInput): { names: string[]; active: number | null; recordedFromTags: GtmEventTag[] } {
    if (input.tagSource === 'gtm') {
        const active = input.tags.filter(tag => !tag.paused && tag.eventName && !isSentinelLabel(tag.eventName));
        return { names: [...new Set(active.map(tag => tag.eventName))], active: active.length, recordedFromTags: active };
    }
    if (input.tagSource === 'saved_list') {
        return {
            names: [...new Set(input.fallbackEventNames.filter(name => !isSentinelLabel(name)))],
            active: null,
            recordedFromTags: [],
        };
    }
    return { names: [], active: null, recordedFromTags: [] };
}

function sumNamed(map: Map<string, number>, names: readonly string[]): number {
    return names.reduce((total, name) => total + (map.get(name) ?? 0), 0);
}

export function buildGtmEventsReport(input: BuildGtmEventsInput): GtmEventsSnapshot {
    const currentPeriod = periodLabels(input.reportMonth);
    const priorMonth = previousMonth(input.reportMonth);
    const priorPeriod = periodLabels(priorMonth);
    const excluded = input.excludedLinkTexts;
    const tags = tagNamesFor(input);
    const adjust = new Set<string>([
        ...tags.names,
        input.outboundEventName,
        input.bookingEventName,
        input.ticketEventName,
    ].filter(name => name && !isSentinelLabel(name)));

    const currentRaw = sumEvents(input.events.current);
    const priorRaw = sumEvents(input.events.prior);
    const current = applyAdjustments(currentRaw, excludedByEvent(input.links.current, excluded), adjust);
    const prior = applyAdjustments(priorRaw, excludedByEvent(input.links.prior, excluded), adjust);

    const events: GtmEventRow[] = [...current.entries()]
        .filter(([, count]) => count > 0)
        .map(([name, count]) => ({ name, current: count, prior: prior.get(name) ?? 0 }))
        .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name));

    const totalEvents = {
        current: [...currentRaw.values()].reduce((sum, count) => sum + count, 0),
        prior: [...priorRaw.values()].reduce((sum, count) => sum + count, 0),
    };
    const tagCurrent = input.tagSource === 'unavailable' ? null : sumNamed(current, tags.names);
    const tagPrior = input.tagSource === 'unavailable' ? null : sumNamed(prior, tags.names);
    const tagsRecorded = input.tagSource === 'gtm'
        ? tags.recordedFromTags.filter(tag => (current.get(tag.eventName) ?? 0) > 0).length
        : null;

    const outboundRows = propertyRows(input.links.current, input.links.prior, input.outboundEventName, excluded);
    const outboundLinks = linkRows(input.links.current, input.links.prior, input.outboundEventName, excluded, 'link');
    const bookingRows = linkRows(input.links.current, input.links.prior, input.bookingEventName, excluded, 'booking');
    const ticketRows = linkRows(input.links.current, input.links.prior, input.ticketEventName, excluded, 'ticket');
    const countOf = (name: string): GtmCount => ({ current: current.get(name) ?? 0, prior: prior.get(name) ?? 0 });

    const trends = events
        .filter(row => !LIFECYCLE_EVENTS.has(row.name))
        .slice(0, 6)
        .map(row => trendFor(row.name, row.current, input.daily, currentPeriod.start, currentPeriod.days));

    const monthName = currentPeriod.monthName;
    const priorName = priorPeriod.monthName;
    const tagSentence = input.tagSource === 'gtm' && tagsRecorded != null && tags.active != null
        ? `Events recorded by the tags on this site. ${tagsRecorded} of ${tags.active} tags recorded events.`
        : input.tagSource === 'saved_list'
            ? 'Tag Manager is not connected, so this total uses the saved event list for this client.'
            : 'Tag Manager is not connected, so this report does not separate a tag total.';

    return {
        schemaVersion: GTM_EVENTS_SCHEMA,
        capturedAt: input.capturedAt,
        clientName: input.clientName,
        reportMonth: input.reportMonth,
        priorMonth,
        periodLabel: currentPeriod.range,
        priorPeriodLabel: priorPeriod.range,
        monthShort: currentPeriod.short,
        priorShort: priorPeriod.short,
        copy: {
            lede: `${input.clientName} · ${currentPeriod.range} · compared with ${priorPeriod.range}`,
            totalEvents: 'All events recorded on the site.',
            tagEvents: tagSentence,
            sessions: 'Visits give context for the event counts.',
            events: `Every event recorded in ${monthName}, sorted by count and compared with ${priorName}. Only events with a ${monthName} count are listed.`,
            outbound: `Which properties and links were clicked in ${monthName}, compared with ${priorName}.`,
            links: `The same clicks, listed by the words on the link. Only links with a ${monthName} count are listed.`,
            booking: `Booking links clicked in ${monthName}, compared with ${priorName}.`,
            tickets: `Ticket links clicked in ${monthName}, compared with ${priorName}.`,
            trends: 'Daily counts for the busiest events. Each chart has its own scale.',
        },
        kpis: {
            totalEvents,
            tagEvents: {
                current: tagCurrent,
                prior: tagPrior,
                source: input.tagSource,
                tagsRecorded,
                tagsActive: tags.active,
            },
            sessions: {
                current: finiteCount(input.sessions.current),
                prior: finiteCount(input.sessions.prior),
            },
        },
        events,
        outbound: outboundRows.length === 0 && outboundLinks.length === 0 ? null : {
            eventName: input.outboundEventName,
            ...countOf(input.outboundEventName),
            rows: outboundRows,
            byProperty: outboundRows,
            byLink: outboundLinks,
        },
        booking: bookingRows.length === 0 ? null : { eventName: input.bookingEventName, ...countOf(input.bookingEventName), rows: bookingRows },
        tickets: ticketRows.length === 0 ? null : { eventName: input.ticketEventName, ...countOf(input.ticketEventName), rows: ticketRows },
        trends,
    };
}

export function clientLabel(value: string | null | undefined, fallback: string): string {
    return isSentinelLabel(value) ? fallback : value!.trim();
}

const pulledAtFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
});

export function formatPulledAt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return pulledAtFormat.format(date);
}

export function parseGtmReportSettings(input: unknown): { ok: true; settings: GtmReportSettings } | { ok: false; error: string } {
    const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const excluded = cleanList(source.excludedLinkTexts ?? source.excluded_link_texts ?? [], 30, 80, false);
    const fallback = cleanList(source.fallbackEventNames ?? source.fallback_event_names ?? [], 40, 40, true);
    if (!excluded || !fallback) return { ok: false, error: 'Check the excluded link text and the saved event names.' };
    const outbound = eventName(source.outboundEventName ?? source.outbound_event_name, DEFAULT_OUTBOUND_EVENT);
    const booking = eventName(source.bookingEventName ?? source.booking_event_name, DEFAULT_BOOKING_EVENT);
    const ticket = eventName(source.ticketEventName ?? source.ticket_event_name, DEFAULT_TICKET_EVENT);
    if (!outbound || !booking || !ticket) return { ok: false, error: 'Event names use letters, numbers, and underscores.' };
    return { ok: true, settings: { excludedLinkTexts: excluded, fallbackEventNames: fallback, outboundEventName: outbound, bookingEventName: booking, ticketEventName: ticket } };
}

function eventName(value: unknown, fallback: string): string | null {
    if (value == null || value === '') return fallback;
    if (typeof value !== 'string' || !EVENT_NAME.test(value.trim())) return null;
    return value.trim();
}

function cleanList(value: unknown, max: number, itemMax: number, eventNames: boolean): string[] | null {
    if (!Array.isArray(value) || value.length > max) return null;
    const list: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') return null;
        const trimmed = item.trim().replace(/\s+/g, ' ');
        if (!trimmed || trimmed.length > itemMax || isSentinelLabel(trimmed)) return null;
        if (eventNames && !EVENT_NAME.test(trimmed)) return null;
        list.push(trimmed);
    }
    return list;
}

function countPair(value: unknown): GtmCount | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as { current?: unknown; prior?: unknown };
    if (!whole(row.current) || !whole(row.prior)) return null;
    return { current: row.current as number, prior: row.prior as number };
}

function whole(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function breakdownRow(value: unknown): GtmBreakdownRow | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.label !== 'string' || typeof row.destination !== 'string') return null;
    if (row.detail != null && typeof row.detail !== 'string') return null;
    if (!whole(row.current) || !whole(row.prior) || row.current <= 0) return null;
    return {
        label: row.label,
        detail: typeof row.detail === 'string' ? row.detail : null,
        destination: row.destination,
        current: row.current,
        prior: row.prior,
    };
}

/** Rebuilds a snapshot from stored JSON and drops anything that is not part of the client report. */
export function parseGtmEventsSnapshot(value: unknown): GtmEventsSnapshot | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (row.schemaVersion !== GTM_EVENTS_SCHEMA) return null;
    if (typeof row.capturedAt !== 'string' || typeof row.clientName !== 'string' || typeof row.reportMonth !== 'string') return null;
    if (typeof row.priorMonth !== 'string' || typeof row.periodLabel !== 'string' || typeof row.priorPeriodLabel !== 'string') return null;
    if (typeof row.monthShort !== 'string' || typeof row.priorShort !== 'string') return null;
    const copy = row.copy;
    if (!copy || typeof copy !== 'object') return null;
    const copyRow = copy as Record<string, unknown>;
    const copyKeys: (keyof GtmEventsCopy)[] = ['lede', 'totalEvents', 'tagEvents', 'sessions', 'events', 'outbound', 'links', 'booking', 'tickets', 'trends'];
    if (copyKeys.some(key => typeof copyRow[key] !== 'string')) return null;
    const kpis = row.kpis;
    if (!kpis || typeof kpis !== 'object') return null;
    const kpiRow = kpis as Record<string, unknown>;
    const totalEvents = countPair(kpiRow.totalEvents);
    const sessions = countPair(kpiRow.sessions);
    const tag = kpiRow.tagEvents;
    if (!totalEvents || !sessions || !tag || typeof tag !== 'object') return null;
    const tagRow = tag as Record<string, unknown>;
    if (tagRow.source !== 'gtm' && tagRow.source !== 'saved_list' && tagRow.source !== 'unavailable') return null;
    if (tagRow.current != null && !whole(tagRow.current)) return null;
    if (tagRow.prior != null && !whole(tagRow.prior)) return null;
    if (tagRow.tagsRecorded != null && !whole(tagRow.tagsRecorded)) return null;
    if (tagRow.tagsActive != null && !whole(tagRow.tagsActive)) return null;
    if (!Array.isArray(row.events) || !Array.isArray(row.trends)) return null;
    const events: GtmEventRow[] = [];
    for (const item of row.events) {
        if (!item || typeof item !== 'object') return null;
        const event = item as Record<string, unknown>;
        if (typeof event.name !== 'string' || !whole(event.current) || !whole(event.prior)) return null;
        if (event.current <= 0) continue;
        events.push({ name: event.name, current: event.current, prior: event.prior });
    }
    const section = (value: unknown, withLinks: boolean): GtmOutbound | GtmBreakdown | null => {
        if (value == null) return null;
        if (!value || typeof value !== 'object') return null;
        const sectionRow = value as Record<string, unknown>;
        if (typeof sectionRow.eventName !== 'string' || !whole(sectionRow.current) || !whole(sectionRow.prior)) return null;
        const rows = Array.isArray(sectionRow.rows) ? sectionRow.rows.map(breakdownRow) : [];
        if (rows.some(item => item == null)) return null;
        const base = {
            eventName: sectionRow.eventName,
            current: sectionRow.current as number,
            prior: sectionRow.prior as number,
            rows: rows as GtmBreakdownRow[],
        };
        if (!withLinks) return base;
        const byProperty = Array.isArray(sectionRow.byProperty) ? sectionRow.byProperty.map(breakdownRow) : base.rows.map(item => item);
        const byLink = Array.isArray(sectionRow.byLink) ? sectionRow.byLink.map(breakdownRow) : [];
        if (byProperty.some(item => item == null) || byLink.some(item => item == null)) return null;
        return { ...base, byProperty: byProperty as GtmBreakdownRow[], byLink: byLink as GtmBreakdownRow[] };
    };
    const outbound = section(row.outbound, true) as GtmOutbound | null;
    const booking = section(row.booking, false) as GtmBreakdown | null;
    const tickets = section(row.tickets, false) as GtmBreakdown | null;
    const trends: GtmTrend[] = [];
    for (const item of row.trends) {
        if (!item || typeof item !== 'object') return null;
        const trend = item as Record<string, unknown>;
        if (typeof trend.eventName !== 'string' || !whole(trend.total) || !whole(trend.peakCount) || !whole(trend.peakDay)) return null;
        if (!Array.isArray(trend.days) || trend.days.some(day => !whole(day))) return null;
        trends.push({
            eventName: trend.eventName,
            total: trend.total as number,
            days: trend.days as number[],
            peakCount: trend.peakCount as number,
            peakDay: trend.peakDay as number,
        });
    }
    return {
        schemaVersion: GTM_EVENTS_SCHEMA,
        capturedAt: row.capturedAt,
        clientName: row.clientName,
        reportMonth: row.reportMonth,
        priorMonth: row.priorMonth,
        periodLabel: row.periodLabel,
        priorPeriodLabel: row.priorPeriodLabel,
        monthShort: row.monthShort,
        priorShort: row.priorShort,
        copy: {
            lede: copyRow.lede as string,
            totalEvents: copyRow.totalEvents as string,
            tagEvents: copyRow.tagEvents as string,
            sessions: copyRow.sessions as string,
            events: copyRow.events as string,
            outbound: copyRow.outbound as string,
            links: copyRow.links as string,
            booking: copyRow.booking as string,
            tickets: copyRow.tickets as string,
            trends: copyRow.trends as string,
        },
        kpis: {
            totalEvents,
            tagEvents: {
                current: (tagRow.current as number | null) ?? null,
                prior: (tagRow.prior as number | null) ?? null,
                source: tagRow.source,
                tagsRecorded: (tagRow.tagsRecorded as number | null) ?? null,
                tagsActive: (tagRow.tagsActive as number | null) ?? null,
            },
            sessions,
        },
        events,
        outbound,
        booking,
        tickets,
        trends,
    };
}

export function niceAxisMax(peak: number): number {
    if (peak <= 1) return 1;
    if (peak <= 6) return 6;
    const exponent = 10 ** Math.floor(Math.log10(peak));
    const fraction = peak / exponent;
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
    return nice * exponent;
}

export interface SparkPoint { x: number; y: number }

export function sparkline(counts: readonly number[]): { axisMax: number; points: SparkPoint[]; peakIndex: number } {
    let peakIndex = 0;
    counts.forEach((count, index) => {
        if (count > (counts[peakIndex] ?? 0)) peakIndex = index;
    });
    const axisMax = niceAxisMax(counts[peakIndex] ?? 0);
    const x0 = 28;
    const x1 = 294;
    const yTop = 10;
    const yBase = 100;
    const points = counts.map((count, index) => {
        const x = counts.length <= 1 ? x0 : x0 + (index / (counts.length - 1)) * (x1 - x0);
        const y = yBase - (count / axisMax) * (yBase - yTop);
        return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    });
    return { axisMax, points, peakIndex };
}
