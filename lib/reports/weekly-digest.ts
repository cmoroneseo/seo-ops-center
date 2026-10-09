/**
 * Monday work digest: shipped, in progress, and waiting on the client.
 * No search metrics and no hours. Copy goes through the client-copy lint.
 * One queue event per client per Pacific week, shared by that week's contacts.
 */

import { createHash } from 'node:crypto';
import { safePortalNext } from '@/lib/portal/access-policy';
import { ptToday } from '@/lib/sync/months';
import { findClientCopyViolations } from './copy-rules';
import { reportFromHeader, reportReplyTo } from './email';

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const COPY_SOURCES = ['gsc', 'organic_clicks', 'impressions', 'CALL_CLICKS'] as const;
const SECTION_LIMIT = 15;
const DIGEST_NAMESPACE = 'b7e1d4a0-0810-5410-8d19-c0ffee081081';

export interface DigestWeek {
    start: string;
    end: string;
}

export interface DigestDeliverable {
    title: string;
    status: string;
    deliveredOn: string | null;
    publishedUrl: string | null;
}

export interface DigestCandidate {
    organizationId: string;
    clientId: string;
    clientName: string;
    amName: string;
    amEmail: string | null;
    agencyName: string;
    contacts: { id: string; email: string }[];
    deliverables: DigestDeliverable[];
    waiting: { title: string }[];
    optedIn: boolean;
}

export interface DigestContent {
    shipped: { title: string; url: string | null }[];
    inProgress: { title: string }[];
    waiting: { title: string }[];
    truncated: boolean;
}

export interface WeeklyDigestEmail {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    html: string;
    text: string;
}

export type ComposeDecision =
    | { action: 'queue'; eventId: string; contactIds: string[] }
    | { action: 'skip'; reason: 'not_opted_in' | 'no_contact' | 'no_manager' | 'nothing_to_say' };

export type DeliveryDecision =
    | { action: 'send'; email: WeeklyDigestEmail }
    | { action: 'cancel'; reason: 'stale' | 'not_opted_in' | 'no_contact' | 'no_manager' | 'nothing_to_say' | 'wrong_week' }
    | { action: 'retry' };

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function readDay(iso: string): { year: number; month: number; day: number } | null {
    const match = DAY.exec(iso);
    if (!match) return null;
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function addIsoDays(iso: string, days: number): string | null {
    const parts = readDay(iso);
    if (!parts) return null;
    const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    date.setUTCDate(date.getUTCDate() + days);
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function weekday(iso: string): number | null {
    const parts = readDay(iso);
    if (!parts) return null;
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

/** True when the Pacific calendar date is Monday. The hour is not checked. */
export function isPacificMonday(now: Date): boolean {
    return weekday(ptToday(now)) === 1;
}

/**
 * The completed Pacific week ending the day before `monday`.
 * A Monday Oct 12 digest covers Oct 5–11.
 */
export function coveredWeek(mondayIso: string): DigestWeek | null {
    if (weekday(mondayIso) !== 1) return null;
    const start = addIsoDays(mondayIso, -7);
    const end = addIsoDays(mondayIso, -1);
    if (!start || !end) return null;
    return { start, end };
}

export function digestWeek(now: Date): DigestWeek | null {
    if (!isPacificMonday(now)) return null;
    return coveredWeek(ptToday(now));
}

/** A queued digest can still send through the Sunday after the Monday it was queued. */
export function digestIsCurrent(createdAt: string, now: Date): boolean {
    const queued = new Date(createdAt);
    if (Number.isNaN(queued.getTime())) return false;
    const queuedDay = ptToday(queued);
    const today = ptToday(now);
    const queuedUtc = readDay(queuedDay);
    const todayUtc = readDay(today);
    if (!queuedUtc || !todayUtc) return false;
    const ageDays = Math.round((Date.UTC(todayUtc.year, todayUtc.month - 1, todayUtc.day) - Date.UTC(queuedUtc.year, queuedUtc.month - 1, queuedUtc.day)) / 86400000);
    return ageDays >= 0 && ageDays < 7;
}

export function weekForQueuedAt(createdAt: string): DigestWeek | null {
    const queued = new Date(createdAt);
    if (Number.isNaN(queued.getTime())) return null;
    return coveredWeek(ptToday(queued));
}

function monthName(iso: string): string {
    const parts = readDay(iso);
    if (!parts) return iso;
    return new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

export function formatWeekLabel(start: string, end: string): string {
    const a = readDay(start);
    const b = readDay(end);
    if (!a || !b) return `${start}–${end}`;
    if (a.year === b.year && a.month === b.month) return `${monthName(start)} ${a.day}–${b.day}`;
    if (a.year === b.year) return `${monthName(start)} ${a.day}–${monthName(end)} ${b.day}`;
    return `${monthName(start)} ${a.day}, ${a.year}–${monthName(end)} ${b.day}, ${b.year}`;
}

function uuidBytes(uuid: string): Buffer {
    return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** Stable id for (client, week). The queue unique key then blocks a second send. */
export function weeklyDigestEventId(clientId: string, weekStart: string): string {
    const hash = createHash('sha1').update(uuidBytes(DIGEST_NAMESPACE)).update(`${clientId}:${weekStart}`).digest();
    const bytes = Buffer.from(hash.subarray(0, 16));
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function oneLine(value: string): string {
    return value.replace(/[\r\n<>"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function clientTitle(value: string): string | null {
    const title = oneLine(value).slice(0, 180);
    if (!title) return null;
    if (findClientCopyViolations(title, COPY_SOURCES).length > 0) return null;
    return title;
}

export function proofUrl(value: string | null | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed || /[\s<>"]/.test(trimmed)) return null;
    try {
        const url = new URL(trimmed);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url.toString();
    } catch {
        return null;
    }
}

function inWeek(day: string | null, week: DigestWeek): boolean {
    if (!day) return false;
    const value = day.slice(0, 10);
    return DAY.test(value) && value >= week.start && value <= week.end;
}

export function buildDigestContent(input: {
    week: DigestWeek;
    deliverables: DigestDeliverable[];
    waiting: { title: string }[];
}): DigestContent {
    const shipped = input.deliverables
        .filter(item => item.status === 'Published' && inWeek(item.deliveredOn, input.week))
        .map(item => {
            const title = clientTitle(item.title);
            if (!title) return null;
            return { title, url: proofUrl(item.publishedUrl), deliveredOn: item.deliveredOn?.slice(0, 10) ?? '' };
        })
        .filter((item): item is { title: string; url: string | null; deliveredOn: string } => Boolean(item))
        .sort((a, b) => b.deliveredOn.localeCompare(a.deliveredOn) || a.title.localeCompare(b.title));

    const inProgress = input.deliverables
        .filter(item => item.status === 'In Progress' || item.status === 'Review' || (item.status === 'Approved' && !item.deliveredOn))
        .map(item => clientTitle(item.title))
        .filter((title): title is string => Boolean(title))
        .sort((a, b) => a.localeCompare(b))
        .map(title => ({ title }));

    const waiting = input.waiting
        .map(item => clientTitle(item.title))
        .filter((title): title is string => Boolean(title))
        .sort((a, b) => a.localeCompare(b))
        .map(title => ({ title }));

    const truncated = shipped.length > SECTION_LIMIT || inProgress.length > SECTION_LIMIT || waiting.length > SECTION_LIMIT;
    return {
        shipped: shipped.slice(0, SECTION_LIMIT).map(({ title, url }) => ({ title, url })),
        inProgress: inProgress.slice(0, SECTION_LIMIT),
        waiting: waiting.slice(0, SECTION_LIMIT),
        truncated,
    };
}

export function digestHasNews(content: DigestContent): boolean {
    return content.shipped.length + content.inProgress.length + content.waiting.length > 0;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function digestPortalUrl(siteUrl: string, clientId: string): string {
    const base = siteUrl.replace(/\/$/, '') || 'https://seo-ops-center.vercel.app';
    const portal = new URL('/portal/login', base);
    portal.searchParams.set('next', safePortalNext('/portal'));
    portal.searchParams.set('client', clientId);
    return portal.toString();
}

function sectionText(heading: string, lines: string[]): string[] {
    if (lines.length === 0) return [];
    return [heading, ...lines.map(line => `- ${line}`), ''];
}

export function buildWeeklyDigestEmail(input: {
    content: DigestContent;
    week: DigestWeek;
    clientName: string;
    clientId: string;
    amName: string;
    amEmail: string;
    agencyName: string;
    verifiedFrom: string;
    to: string;
    siteUrl: string;
}): WeeklyDigestEmail | null {
    if (!digestHasNews(input.content)) return null;
    const from = reportFromHeader(input.amName, input.agencyName, input.verifiedFrom);
    const replyTo = reportReplyTo(input.amEmail);
    const to = reportReplyTo(input.to);
    if (!from || !replyTo || !to) return null;

    const client = oneLine(input.clientName) || 'your business';
    const label = formatWeekLabel(input.week.start, input.week.end);
    const link = digestPortalUrl(input.siteUrl, input.clientId);
    const shippedLines = input.content.shipped.map(item => item.url ? `${item.title}: ${item.url}` : item.title);
    const progressLines = input.content.inProgress.map(item => item.title);
    const waitingLines = input.content.waiting.map(item => item.title);
    const more = input.content.truncated ? ['There is more in your portal.', ''] : [];
    const text = [
        `Here is what moved for ${client} from ${label}.`,
        '',
        ...sectionText('Shipped', shippedLines),
        ...sectionText('In progress', progressLines),
        ...sectionText('Waiting on you', waitingLines),
        ...more,
        `Open your portal: ${link}`,
    ].join('\n');

    if (findClientCopyViolations(text, COPY_SOURCES).length > 0) return null;

    const items = (entries: string[]) => entries.map(entry => `<li>${entry}</li>`).join('');
    const shippedHtml = input.content.shipped.map(item => {
        if (!item.url) return `<li>${escapeHtml(item.title)}</li>`;
        const href = escapeHtml(item.url);
        return `<li><a href="${href}">${escapeHtml(item.title)}</a></li>`;
    }).join('');
    const html = [
        `<p>Here is what moved for ${escapeHtml(client)} from ${escapeHtml(label)}.</p>`,
        shippedHtml ? `<h2>Shipped</h2><ul>${shippedHtml}</ul>` : '',
        progressLines.length ? `<h2>In progress</h2><ul>${items(progressLines.map(escapeHtml))}</ul>` : '',
        waitingLines.length ? `<h2>Waiting on you</h2><ul>${items(waitingLines.map(escapeHtml))}</ul>` : '',
        input.content.truncated ? '<p>There is more in your portal.</p>' : '',
        `<p><a href="${escapeHtml(link)}">Open your portal</a></p>`,
    ].filter(Boolean).join('');

    return {
        from,
        replyTo,
        to,
        subject: oneLine(`${client}: Your week of ${label}`),
        html,
        text,
    };
}

function validContacts(contacts: { id: string; email: string }[]): { id: string; email: string }[] {
    return contacts.filter(contact => reportReplyTo(contact.email));
}

export function decideDigestCompose(input: {
    candidate: DigestCandidate;
    week: DigestWeek;
}): ComposeDecision {
    if (!input.candidate.optedIn) return { action: 'skip', reason: 'not_opted_in' };
    const contacts = validContacts(input.candidate.contacts);
    if (contacts.length === 0) return { action: 'skip', reason: 'no_contact' };
    if (!input.candidate.amEmail || !reportReplyTo(input.candidate.amEmail)) return { action: 'skip', reason: 'no_manager' };
    const content = buildDigestContent({
        week: input.week,
        deliverables: input.candidate.deliverables,
        waiting: input.candidate.waiting,
    });
    if (!digestHasNews(content)) return { action: 'skip', reason: 'nothing_to_say' };
    return {
        action: 'queue',
        eventId: weeklyDigestEventId(input.candidate.clientId, input.week.start),
        contactIds: contacts.map(contact => contact.id),
    };
}

export function decideDigestDelivery(input: {
    now: Date;
    createdAt: string;
    eventId: string;
    candidate: DigestCandidate;
    verifiedFrom: string;
    to: string;
    siteUrl: string;
}): DeliveryDecision {
    if (!digestIsCurrent(input.createdAt, input.now)) return { action: 'cancel', reason: 'stale' };
    const week = weekForQueuedAt(input.createdAt);
    if (!week) return { action: 'cancel', reason: 'wrong_week' };
    if (input.eventId !== weeklyDigestEventId(input.candidate.clientId, week.start)) return { action: 'cancel', reason: 'wrong_week' };
    if (!input.candidate.optedIn) return { action: 'cancel', reason: 'not_opted_in' };
    if (!reportReplyTo(input.to)) return { action: 'cancel', reason: 'no_contact' };
    if (!input.candidate.amEmail || !reportReplyTo(input.candidate.amEmail)) return { action: 'cancel', reason: 'no_manager' };
    const content = buildDigestContent({
        week,
        deliverables: input.candidate.deliverables,
        waiting: input.candidate.waiting,
    });
    if (!digestHasNews(content)) return { action: 'cancel', reason: 'nothing_to_say' };
    if (!input.verifiedFrom.trim()) return { action: 'retry' };
    const email = buildWeeklyDigestEmail({
        content,
        week,
        clientName: input.candidate.clientName,
        clientId: input.candidate.clientId,
        amName: input.candidate.amName,
        amEmail: input.candidate.amEmail,
        agencyName: input.candidate.agencyName,
        verifiedFrom: input.verifiedFrom,
        to: input.to,
        siteUrl: input.siteUrl,
    });
    if (!email) return { action: 'retry' };
    return { action: 'send', email };
}
