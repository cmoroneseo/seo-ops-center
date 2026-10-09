/**
 * Client report view model. Built only from a frozen report_versions snapshot.
 * Missing numbers stay null and render as "—". A stored zero stays 0.
 */

import { snapshotLocked } from '@/lib/reporting/states-copy';
import { closeMonthName } from './close-view';
import type { ClientBlockKind } from './client-blocks';
import { CLIENT_BLOCK_KINDS } from './client-blocks';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const INTERNAL_CHORE = /extend search history|backfill|16 months|tracker noise|ahrefs error|retry sync/i;
const HOURS = /\b\d+(?:\.\d+)?\s*hours?\b/gi;

export interface ClientReceipt {
    title: string;
    value: string;
    freshness: string;
    source: string;
    dates: string;
    note: string | null;
    frozenAt: string;
    metricSources: readonly string[];
}

export type Piece =
    | { kind: 'text'; text: string }
    | { kind: 'value'; display: string; receipt: ClientReceipt };

export interface GlanceRow {
    id: 'finding' | 'reaching' | 'did' | 'working' | 'need';
    question: string;
    pieces: Piece[];
    pill: string;
    audience: 'client' | 'am';
}

export interface CityCard {
    name: string;
    mapPieces: Piece[];
    websitePieces: Piece[];
}

export interface MonthChip {
    month: string;
    label: string;
    href: string | null;
    current: boolean;
    disabled: boolean;
    tooltip: string | null;
}

export type ClientBlock =
    | { kind: 'hero'; pieces: Piece[]; lede: string | null; comparison: { prior: string; reason: string } | null }
    | { kind: 'at_a_glance'; rows: GlanceRow[] }
    | { kind: 'where_you_show_up'; intro: string; cities: CityCard[]; empty: string | null }
    | { kind: 'work_completed'; items: { title: string; url: string; shippedOn: string; line: string }[] }
    | { kind: 'what_changed'; sentence: string }
    | { kind: 'whats_next'; audience: 'client' | 'am'; intro: string | null; items: { label: string; sentence: string }[] }
    | { kind: 'what_we_need'; items: { sentence: string }[] }
    | { kind: 'about_these_numbers'; lines: string[] }
    | { kind: 'domain_rating'; sentence: string };

export interface ClientReportModel {
    reportId: string;
    clientName: string;
    agencyName: string;
    month: string;
    monthName: string;
    year: string;
    summary: ClientBlock[];
    detail: ClientBlock[];
    switcher: MonthChip[];
    staffBanner: string | null;
}

export interface ReportMonthLink {
    month: string;
    reportId: string;
}

export function formatClientCount(value: number | null): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

export function partialMonthTooltip(monthName: string): string {
    return `${monthName} is only partly covered, so there's no ${monthName} report.`;
}

export function snapshotMatchesScope(snapshot: unknown, organizationId: string, clientId: string): boolean {
    const row = record(snapshot);
    if (!row) return false;
    return row.organizationId === organizationId && row.clientId === clientId;
}

function record(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function monthParts(month: string): { year: number; month: number; name: string; last: number } | null {
    const match = MONTH.exec(month);
    if (!match) return null;
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { year, month: monthNumber, name: closeMonthName(month), last };
}

function nextMonth(month: string): string {
    const parts = monthParts(month);
    if (!parts) return month;
    const index = parts.year * 12 + (parts.month - 1) + 1;
    const year = Math.floor(index / 12);
    const monthNumber = (index % 12) + 1;
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
}

function shortMonth(month: string): string {
    return closeMonthName(month).slice(0, 3);
}

function rangeLabel(month: string): string {
    const parts = monthParts(month);
    if (!parts) return month;
    const short = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts.month - 1];
    return `${short} 1–${parts.last}, ${parts.year}`;
}

function withoutHours(value: string): string {
    return value.replace(HOURS, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function metricMap(snapshot: Record<string, unknown>, month: string): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    const rows = Array.isArray(snapshot.metrics) ? snapshot.metrics : [];
    for (const item of rows) {
        const row = record(item);
        if (!row || row.metricMonth !== month) continue;
        const source = text(row.source);
        const data = record(row.data);
        if (source && data) out.set(source, data);
    }
    const portal = record(snapshot.portal);
    const metrics = record(portal?.metrics);
    const current = record(metrics?.current);
    if (current) {
        for (const [source, data] of Object.entries(current)) {
            if (!out.has(source)) {
                const parsed = record(data);
                if (parsed) out.set(source, parsed);
            }
        }
    }
    return out;
}

function countFrom(data: Record<string, unknown> | undefined, key: string): number | null {
    if (!data || !Object.prototype.hasOwnProperty.call(data, key)) return null;
    return finite(data[key]);
}

interface FrozenCity {
    name: string;
    mapTop3: number | null;
    mapPhrases: number | null;
    websitePage1: number | null;
    websitePhrases: number | null;
    mapSentence: string | null;
    websiteSentence: string | null;
}

interface NextItem {
    audience: 'client' | 'am';
    label: string;
    sentence: string;
}

interface Extension {
    clientName: string | null;
    agencyName: string | null;
    property: string | null;
    gbpConnected: boolean | null;
    gscConnected: boolean | null;
    gbpLinkShown: number | null;
    gbpLinkClicks: number | null;
    comparablePrior: boolean | null;
    final: boolean | null;
    partialMonths: string[];
    cities: FrozenCity[];
    nextItems: NextItem[];
    extraAsks: string[];
    domainRating: number | null;
    comparison: { priorShown: number; reason: string } | null;
}

function readExtension(snapshot: Record<string, unknown>): Extension {
    const raw = record(snapshot.clientReport);
    const cities: FrozenCity[] = [];
    for (const item of Array.isArray(raw?.cities) ? raw.cities : []) {
        const city = record(item);
        const name = text(city?.name);
        if (!name) continue;
        cities.push({
            name,
            mapTop3: finite(city?.mapTop3),
            mapPhrases: finite(city?.mapPhrases),
            websitePage1: finite(city?.websitePage1),
            websitePhrases: finite(city?.websitePhrases),
            mapSentence: text(city?.mapSentence),
            websiteSentence: text(city?.websiteSentence),
        });
    }
    const nextItems: NextItem[] = [];
    for (const item of Array.isArray(raw?.nextItems) ? raw.nextItems : []) {
        const row = record(item);
        const label = text(row?.label);
        const sentence = text(row?.sentence);
        if (!label || !sentence) continue;
        nextItems.push({
            audience: row?.audience === 'am' ? 'am' : 'client',
            label: withoutHours(label),
            sentence: withoutHours(sentence),
        });
    }
    const partialMonths = (Array.isArray(raw?.partialMonths) ? raw.partialMonths : [])
        .filter((month): month is string => typeof month === 'string' && MONTH.test(month));
    const comparison = record(raw?.comparison);
    const priorShown = finite(comparison?.priorShown);
    const reason = text(comparison?.reason);
    return {
        clientName: text(raw?.clientName),
        agencyName: text(raw?.agencyName),
        property: text(raw?.property),
        gbpConnected: typeof raw?.gbpConnected === 'boolean' ? raw.gbpConnected : null,
        gscConnected: typeof raw?.gscConnected === 'boolean' ? raw.gscConnected : null,
        gbpLinkShown: finite(raw?.gbpLinkShown),
        gbpLinkClicks: finite(raw?.gbpLinkClicks),
        comparablePrior: typeof raw?.comparablePrior === 'boolean' ? raw.comparablePrior : null,
        final: typeof raw?.final === 'boolean' ? raw.final : null,
        partialMonths,
        cities,
        nextItems,
        extraAsks: (Array.isArray(raw?.extraAsks) ? raw.extraAsks : []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => withoutHours(item.trim())),
        domainRating: finite(raw?.domainRating),
        comparison: priorShown != null && reason ? { priorShown, reason } : null,
    };
}

function receipt(input: {
    title: string;
    value: number | null;
    source: string;
    dates: string;
    note: string | null;
    frozenAt: string;
    final: boolean;
    metricSources: readonly string[];
}): ClientReceipt {
    const display = formatClientCount(input.value);
    const freshness = input.final
        ? `Final · ${snapshotLocked(input.dates)}`
        : 'Preliminary · Google may still change these days';
    return {
        title: input.title,
        value: display,
        freshness,
        source: input.source,
        dates: input.dates,
        note: input.note,
        frozenAt: input.frozenAt,
        metricSources: input.metricSources,
    };
}

function valuePiece(label: string, value: number | null, dates: string, note: string | null, frozenAt: string, final: boolean, sources: readonly string[]): Piece {
    const made = receipt({
        title: label,
        value,
        source: 'Google Search Console',
        dates,
        note,
        frozenAt,
        final,
        metricSources: sources,
    });
    return { kind: 'value', display: made.value, receipt: made };
}

function textPiece(value: string): Piece {
    return { kind: 'text', text: value };
}

function piecesFrom(sentence: string, values: { display: string; receipt: ClientReceipt }[]): Piece[] {
    let rest = sentence;
    const pieces: Piece[] = [];
    for (const value of values) {
        if (!value.display || value.display === '—') continue;
        const index = rest.indexOf(value.display);
        if (index < 0) continue;
        if (index > 0) pieces.push(textPiece(rest.slice(0, index)));
        pieces.push({ kind: 'value', display: value.display, receipt: value.receipt });
        rest = rest.slice(index + value.display.length);
    }
    if (rest) pieces.push(textPiece(rest));
    return pieces.length > 0 ? pieces : [textPiece(sentence)];
}

function joinPieces(pieces: Piece[]): string {
    return pieces.map(piece => piece.kind === 'text' ? piece.text : piece.display).join('');
}

function cityLine(kind: 'map' | 'website', city: FrozenCity): string {
    if (kind === 'map') {
        if (city.mapSentence) return city.mapSentence;
        if (city.mapTop3 == null || city.mapPhrases == null) return `Map results for ${city.name} aren't in this report.`;
        return `In the top 3 map results for ${formatClientCount(city.mapTop3)} of ${formatClientCount(city.mapPhrases)} ${city.name} phrases.`;
    }
    if (city.websiteSentence) return city.websiteSentence;
    if (city.websitePage1 == null || city.websitePhrases == null) return `Page 1 counts for ${city.name} aren't in this report.`;
    return `On page 1 for ${formatClientCount(city.websitePage1)} of ${formatClientCount(city.websitePhrases)} phrases.`;
}

function ledgerItems(snapshot: Record<string, unknown>, monthName: string): { title: string; url: string; shippedOn: string; line: string }[] {
    const rows = Array.isArray(snapshot.ledgerRows) ? snapshot.ledgerRows : [];
    const items: { title: string; url: string; shippedOn: string; line: string }[] = [];
    for (const item of rows) {
        const row = record(item);
        const title = withoutHours(text(row?.title) ?? '');
        const url = text(row?.publishedUrl) ?? '';
        if (!title || !url) continue;
        const shippedOn = text(row?.shippedOn) ?? '';
        const verdict = withoutHours(text(row?.verdict) ?? '');
        const detail = withoutHours(text(row?.detail) ?? '');
        const line = [verdict, detail].filter(Boolean).join(' ').trim();
        items.push({ title, url, shippedOn, line: line || `Shipped in ${monthName}.` });
    }
    return items;
}

function whatWeDid(snapshot: Record<string, unknown>): string | null {
    const copy = record(snapshot.copy);
    return text(copy?.whatWeDid);
}

export function clientReportFromSnapshot(snapshot: unknown, context?: { reports?: ReportMonthLink[] }): ClientReportModel | null {
    const row = record(snapshot);
    const month = text(row?.reportMonth);
    const parts = month ? monthParts(month) : null;
    if (!row || !month || !parts) return null;

    const extension = readExtension(row);
    const metrics = metricMap(row, month);
    const gsc = metrics.get('gsc');
    const gbp = metrics.get('gbp');
    const ahrefs = metrics.get('ahrefs');
    const previous = metricMap(row, previousMonth(month)).get('gsc');
    const shown = countFrom(gsc, 'impressions');
    const clicks = countFrom(gsc, 'organic_clicks');
    const gscConnected = extension.gscConnected ?? Boolean(gsc);
    const gbpConnected = extension.gbpConnected ?? Boolean(gbp);
    const callTaps = gbpConnected ? countFrom(gbp, 'calls') : null;
    const directions = gbpConnected ? countFrom(gbp, 'direction_requests') : null;
    const domainRating = extension.domainRating ?? countFrom(ahrefs, 'domain_rating');
    const comparable = extension.comparablePrior ?? (countFrom(previous, 'impressions') != null);
    const series = Array.isArray(row.gscSeries) ? row.gscSeries : [];
    const seriesFinal = series.length === 0 ? null : series.every(day => record(day)?.isIncomplete !== true);
    const final = extension.final ?? seriesFinal ?? true;
    const frozenAt = text(row.capturedAt) ?? '';
    const dates = rangeLabel(month);
    const note = 'Google’s own count for this month. Missing days are not filled in.';
    const gscSources = ['gsc', 'organic_clicks', 'impressions'] as const;

    const shownPiece = valuePiece('Times shown', gscConnected ? shown : null, dates, note, frozenAt, final, gscSources);
    const clicksPiece = valuePiece('Clicks to your website', gscConnected ? clicks : null, dates, note, frozenAt, final, gscSources);
    const hero: ClientBlock = {
        kind: 'hero',
        pieces: [
            textPiece('Google showed your business '),
            shownPiece,
            textPiece(` times in ${parts.name}. That led to `),
            clicksPiece,
            textPiece(' clicks to your website.'),
        ],
        lede: comparable
            ? null
            : `This is your first report built on Google's own data, so there's nothing to compare with yet. ${closeMonthName(nextMonth(month))}'s report will show what changed.`,
        comparison: extension.comparison
            ? { prior: formatClientCount(extension.comparison.priorShown), reason: extension.comparison.reason }
            : null,
    };

    const findingPieces = findingRow(parts.name, gscConnected, shown, extension.gbpLinkShown, dates, note, frozenAt, final, gscSources);
    const reachingPieces = reachingRow(clicks, extension.gbpLinkClicks, gbpConnected, callTaps, directions, dates, note, frozenAt, final, gscSources);
    const did = whatWeDid(row);
    const glanceRows: GlanceRow[] = [
        {
            id: 'finding',
            question: 'Are people finding you?',
            pieces: findingPieces,
            pill: !gscConnected ? 'Not connected' : final ? 'Google data · final' : 'Preliminary',
            audience: 'client',
        },
        {
            id: 'reaching',
            question: 'Are they reaching out?',
            pieces: reachingPieces,
            pill: gbpConnected ? 'Business Profile' : 'Calls: not connected',
            audience: 'client',
        },
        {
            id: 'did',
            question: 'What did we do?',
            pieces: [textPiece(did ?? `No ${parts.name} work is recorded. Write a short note before approving. Clients see this row only once it's filled.`)],
            pill: did ? 'On file' : 'Add work note',
            audience: did ? 'client' : 'am',
        },
        {
            id: 'working',
            question: 'Is it working?',
            pieces: [textPiece(workingCopy(comparable, parts.name))],
            pill: comparable ? 'Too early' : 'First month',
            audience: 'client',
        },
        {
            id: 'need',
            question: 'What do we need from you?',
            pieces: [textPiece(needCopy(gbpConnected))],
            pill: gbpConnected ? "You're set" : 'One step',
            audience: 'client',
        },
    ];

    const cities = extension.cities.map(city => cityCard(city, dates, frozenAt, final));
    const where: ClientBlock = {
        kind: 'where_you_show_up',
        intro: 'A "search phrase" is the exact words someone typed, like "plumber eastvale". Counts are phrases, not people.',
        cities,
        empty: cities.length > 0 ? null : 'City phrase counts aren\'t in this report. Map results, when we have them, come only from your Business Profile link in Google Search.',
    };

    const workItems = ledgerItems(row, parts.name);
    const detail: ClientBlock[] = [where];
    if (workItems.length > 0) {
        detail.push({ kind: 'work_completed', items: workItems });
    }
    if (comparable) {
        const shipped = workItems[0]?.title;
        detail.push({
            kind: 'what_changed',
            sentence: shipped
                ? `After ${shipped} shipped, the month moved. That's a correlation, not a cause.`
                : `This month has a prior month of Google's own data, and nothing shipped that we can line up with it.`,
        });
    }
    const nextClient = extension.nextItems.filter(item => item.audience === 'client' && !INTERNAL_CHORE.test(`${item.label} ${item.sentence}`));
    const nextAm = extension.nextItems.filter(item => item.audience === 'am' || INTERNAL_CHORE.test(`${item.label} ${item.sentence}`));
    if (nextClient.length > 0) {
        detail.push({ kind: 'whats_next', audience: 'client', intro: null, items: nextClient.map(item => ({ label: item.label, sentence: item.sentence })) });
    }
    if (nextAm.length > 0) {
        detail.push({
            kind: 'whats_next',
            audience: 'am',
            intro: "AM writes this. Placeholder copy; the facts are real, the plan isn't on file.",
            items: nextAm.map(item => ({ label: item.label, sentence: item.sentence })),
        });
    }
    const glanceAsk = needCopy(gbpConnected);
    const extraAsks = extension.extraAsks.filter(ask => ask !== glanceAsk && !INTERNAL_CHORE.test(ask));
    if (extraAsks.length > 0) detail.push({ kind: 'what_we_need', items: extraAsks.map(sentence => ({ sentence })) });

    const property = extension.property ? ` (${extension.property})` : '';
    const finalLine = final ? 'Every day is final.' : 'Some days are still preliminary.';
    detail.push({
        kind: 'about_these_numbers',
        lines: [
            `Numbers come from your Google Search Console account${property}, ${dates}. ${finalLine}`,
            'A dotted number shows its source when tapped. We don\'t list single-keyword rankings: one check from one spot doesn\'t match what your customers see.',
        ],
    });
    detail.push({
        kind: 'domain_rating',
        sentence: domainRating == null
            ? 'Domain Rating isn\'t in this report.'
            : `Domain Rating ${formatClientCount(domainRating)}. This is an Ahrefs reference, not a Google count.`,
    });

    const clientName = extension.clientName ?? text(row.title) ?? 'Your business';
    const agencyName = extension.agencyName ?? 'Your agency';
    return {
        reportId: text(row.reportId) ?? '',
        clientName,
        agencyName,
        month,
        monthName: parts.name,
        year: String(parts.year),
        summary: [hero, { kind: 'at_a_glance', rows: glanceRows }],
        detail,
        switcher: buildSwitcher(month, extension.partialMonths, context?.reports ?? []),
        staffBanner: 'Draft, not sent. This bar never prints or goes to the client.',
    };
}

function previousMonth(month: string): string {
    const parts = monthParts(month);
    if (!parts) return month;
    const index = parts.year * 12 + (parts.month - 1) - 1;
    const year = Math.floor(index / 12);
    const monthNumber = (index % 12) + 1;
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
}

function findingRow(monthName: string, connected: boolean, shown: number | null, gbpShown: number | null, dates: string, note: string | null, frozenAt: string, final: boolean, sources: readonly string[]): Piece[] {
    if (!connected || shown == null) {
        return [textPiece(connected ? `We don't have Google's count for ${monthName} yet.` : `Search Console isn't connected, so this report has no times shown yet.`)];
    }
    if (shown === 0) return [textPiece(`Google didn't show your website for any searches in ${monthName}.`)];
    const shownReceipt = receipt({ title: 'Times shown', value: shown, source: 'Google Search Console', dates, note, frozenAt, final, metricSources: sources });
    const sentence = gbpShown == null
        ? `Yes. You appeared in ${shownReceipt.value} Google searches.`
        : `Yes. You appeared in ${shownReceipt.value} Google searches. Your Business Profile showed with its website link ${formatClientCount(gbpShown)} times.`;
    const values = [{ display: shownReceipt.value, receipt: shownReceipt }];
    if (gbpShown != null) {
        values.push({
            display: formatClientCount(gbpShown),
            receipt: receipt({
                title: 'Business Profile link times shown',
                value: gbpShown,
                source: 'Google Search Console',
                dates,
                note: 'Times your Business Profile link was shown. This is separate from the rest of Google Search.',
                frozenAt,
                final,
                metricSources: sources,
            }),
        });
    }
    return piecesFrom(sentence, values);
}

function reachingRow(clicks: number | null, gbpClicks: number | null, gbpConnected: boolean, callTaps: number | null, directions: number | null, dates: string, note: string | null, frozenAt: string, final: boolean, sources: readonly string[]): Piece[] {
    if (clicks == null) return [textPiece('Clicks to your website aren\'t in this report.')];
    if (clicks === 0 && (gbpClicks == null || gbpClicks === 0)) {
        return [textPiece('Google recorded 0 clicks to your website this month.')];
    }
    const clickReceipt = receipt({ title: 'Clicks to your website', value: clicks, source: 'Google Search Console', dates, note, frozenAt, final, metricSources: sources });
    let sentence = `${clickReceipt.value} clicks to your website.`;
    const values = [{ display: clickReceipt.value, receipt: clickReceipt }];
    if (gbpClicks != null) {
        const display = formatClientCount(gbpClicks);
        sentence += ` ${display} of them from your Business Profile.`;
        values.push({
            display,
            receipt: receipt({
                title: 'Clicks from your Business Profile link',
                value: gbpClicks,
                source: 'Google Search Console',
                dates,
                note: 'Clicks on the website link shown with your Business Profile.',
                frozenAt,
                final,
                metricSources: sources,
            }),
        });
    }
    if (!gbpConnected) sentence += ' We can\'t see phone calls or direction requests yet.';
    else if (callTaps == null && directions == null) sentence += ' Call-button taps and direction requests aren\'t in this report yet.';
    else {
        if (callTaps != null) {
            const display = formatClientCount(callTaps);
            sentence += ` ${display} call-button taps.`;
            values.push({
                display,
                receipt: receipt({
                    title: 'Call-button taps',
                    value: callTaps,
                    source: 'Google Business Profile',
                    dates,
                    note: 'Taps on the Call button.',
                    frozenAt,
                    final,
                    metricSources: ['gbp', 'CALL_CLICKS'],
                }),
            });
        }
        if (directions != null) {
            const display = formatClientCount(directions);
            sentence += ` ${display} direction requests.`;
            values.push({
                display,
                receipt: receipt({
                    title: 'Direction requests',
                    value: directions,
                    source: 'Google Business Profile',
                    dates,
                    note: null,
                    frozenAt,
                    final,
                    metricSources: ['gbp'],
                }),
            });
        }
    }
    return piecesFrom(sentence, values);
}

function workingCopy(comparable: boolean, monthName: string): string {
    if (!comparable) return 'Too early to say. This is the first month we have Google\'s numbers for, so it sets the starting line.';
    return `Too early to call a winner. ${monthName} is one month of Google's own data, not a proof.`;
}

function needCopy(gbpConnected: boolean): string {
    if (gbpConnected) return 'Nothing else this month. We\'ll say so here when something is actually waiting on you.';
    return 'Access to your Google Business Profile. It lets us show how many people tapped Call or asked for directions.';
}

function cityCard(city: FrozenCity, dates: string, frozenAt: string, final: boolean): CityCard {
    const mapSentence = cityLine('map', city);
    const websiteSentence = cityLine('website', city);
    const sources = ['gsc', 'impressions'] as const;
    const mapValues = numberReceipts(city.name, 'Map results', [city.mapTop3, city.mapPhrases], dates, frozenAt, final, sources);
    const webValues = numberReceipts(city.name, 'Page 1', [city.websitePage1, city.websitePhrases], dates, frozenAt, final, sources);
    return {
        name: city.name,
        mapPieces: piecesFrom(mapSentence, mapValues),
        websitePieces: piecesFrom(websiteSentence, webValues),
    };
}

function numberReceipts(city: string, title: string, values: Array<number | null>, dates: string, frozenAt: string, final: boolean, sources: readonly string[]): { display: string; receipt: ClientReceipt }[] {
    return values.filter((value): value is number => value != null).map(value => ({
        display: formatClientCount(value),
        receipt: receipt({
            title: `${city} ${title}`,
            value,
            source: 'Google Search Console',
            dates,
            note: 'Counts are search phrases, not people.',
            frozenAt,
            final,
            metricSources: sources,
        }),
    }));
}

export function buildSwitcher(current: string, partialMonths: readonly string[], reports: readonly ReportMonthLink[]): MonthChip[] {
    const byMonth = new Map<string, string>();
    for (const report of reports) {
        if (MONTH.test(report.month)) byMonth.set(report.month, report.reportId);
    }
    const months = new Set<string>([current, ...partialMonths, ...byMonth.keys()]);
    return [...months].filter(month => MONTH.test(month)).sort().map(month => {
        const partial = partialMonths.includes(month);
        const reportId = byMonth.get(month) ?? null;
        const currentChip = month === current;
        const disabled = partial || (!currentChip && !reportId);
        const name = closeMonthName(month);
        let tooltip: string | null = null;
        if (partial) tooltip = partialMonthTooltip(name);
        else if (disabled) tooltip = `There's no ${name} report.`;
        return {
            month,
            label: currentChip ? `${name} ${month.slice(0, 4)}` : shortMonth(month),
            href: !disabled && reportId ? `/portal/reports/${reportId}` : null,
            current: currentChip,
            disabled,
            tooltip,
        };
    });
}

export function forAudience(model: ClientReportModel, audience: 'client' | 'staff'): ClientReportModel {
    const glance = model.summary.map(block => {
        if (block.kind !== 'at_a_glance' || audience === 'staff') return block;
        return { ...block, rows: block.rows.filter(row => row.audience === 'client') };
    });
    const detail = model.detail.filter(block => {
        if (audience === 'staff') return true;
        if (block.kind === 'whats_next' && block.audience === 'am') return false;
        return true;
    });
    return {
        ...model,
        summary: glance,
        detail,
        staffBanner: audience === 'staff' ? model.staffBanner : null,
    };
}

export function blockKinds(model: ClientReportModel): ClientBlockKind[] {
    return [...model.summary, ...model.detail].map(block => block.kind);
}

export function renderedStrings(model: ClientReportModel): string[] {
    const strings: string[] = [];
    if (model.staffBanner) strings.push(model.staffBanner);
    strings.push(model.clientName, model.agencyName, `${model.monthName} ${model.year}`);
    for (const chip of model.switcher) {
        strings.push(chip.label);
        if (chip.tooltip) strings.push(chip.tooltip);
    }
    for (const block of [...model.summary, ...model.detail]) strings.push(...blockStrings(block));
    return strings.filter(item => item.trim().length > 0);
}

function receiptStrings(pieces: Piece[]): string[] {
    return pieces.flatMap(piece => piece.kind === 'text' ? [] : [piece.receipt.title, piece.receipt.freshness, piece.receipt.source, piece.receipt.dates, piece.receipt.note ?? '']);
}

function blockStrings(block: ClientBlock): string[] {
    switch (block.kind) {
        case 'hero':
            return [joinPieces(block.pieces), block.lede ?? '', block.comparison ? `${block.comparison.prior} ${block.comparison.reason}` : '', ...receiptStrings(block.pieces)];
        case 'at_a_glance':
            return block.rows.flatMap(row => [row.question, joinPieces(row.pieces), row.pill, ...receiptStrings(row.pieces)]);
        case 'where_you_show_up':
            return [block.intro, block.empty ?? '', ...block.cities.flatMap(city => [city.name, joinPieces(city.mapPieces), joinPieces(city.websitePieces), ...receiptStrings(city.mapPieces), ...receiptStrings(city.websitePieces)])];
        case 'work_completed':
            return block.items.flatMap(item => [item.title, item.line, item.shippedOn]);
        case 'what_changed':
            return [block.sentence];
        case 'whats_next':
            return [block.intro ?? '', ...block.items.flatMap(item => [item.label, item.sentence])];
        case 'what_we_need':
            return block.items.map(item => item.sentence);
        case 'about_these_numbers':
            return block.lines;
        case 'domain_rating':
            return [block.sentence];
        default: {
            const never: never = block;
            return never;
        }
    }
}

export function headlineDisplays(model: ClientReportModel): string[] {
    const hero = model.summary.find(block => block.kind === 'hero');
    if (!hero || hero.kind !== 'hero') return [];
    return hero.pieces.filter((piece): piece is Extract<Piece, { kind: 'value' }> => piece.kind === 'value' && piece.display !== '—').map(piece => piece.display);
}

/** Headline counts may be restated in At a glance. They must not appear again later. */
export function headlineRepeatedLater(model: ClientReportModel): string[] {
    const headlines = headlineDisplays(model);
    const later = model.detail.flatMap(blockStrings).join('\n');
    return headlines.filter(display => containsNumber(later, display));
}

function containsNumber(text: string, display: string): boolean {
    const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d,])${escaped}(?!\\d)`).test(text);
}

export function everyBlockKindIsAllowed(model: ClientReportModel): boolean {
    return blockKinds(model).every(kind => (CLIENT_BLOCK_KINDS as readonly string[]).includes(kind));
}
