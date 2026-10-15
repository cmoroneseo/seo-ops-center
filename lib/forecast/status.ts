import { forecastPayloadHash, normalizeEmail, type ForecastAllocationLine, type ForecastPayloadBody } from './contract.ts';
import { isForecastPayloadV2, type ForecastPayloadBodyV2, type StoredForecastPayload } from './contract-v2.ts';
import type { PersonMatch } from './build.ts';

/**
 * Forecast column for one person and one week.
 *
 * "Not mapped" is used only after Campaign Desk's people list has loaded and
 * the email is absent. A missing connection is an em dash, not a false
 * "Not mapped" and not a false "Synced".
 */

export interface ForecastStatusRun {
    id: string;
    createdAt: string;
    createdByName: string;
    weekStarts: string[];
    payload: StoredForecastPayload;
}

export interface ForecastMemberStatus {
    status: 'synced' | 'changed' | 'not_mapped' | 'unknown';
    reason: string | null;
}

export function linesForPerson(
    payload: StoredForecastPayload,
    weekStart: string,
    email: string,
): ForecastAllocationLine[] {
    if (isForecastPayloadV2(payload)) return [];
    const week = payload.weeks.find(entry => entry.weekStart === weekStart);
    if (!week) return [];
    const normalized = normalizeEmail(email);
    return week.allocations
        .filter(line => line.personEmail === normalized)
        .slice()
        .sort((left, right) => lineKey(left).localeCompare(lineKey(right)));
}

/** Canonical hours for one person. Version 1 lines and version 2 items both fit. */
export function personForecastDigest(
    payload: StoredForecastPayload | ForecastPayloadBody | ForecastPayloadBodyV2,
    weekStart: string,
    email: string,
): string {
    const week = payload.weeks.find(entry => entry.weekStart === weekStart);
    if (!week) return '[]';
    const normalized = normalizeEmail(email);
    if ('people' in week) {
        const person = week.people.find(entry => entry.personEmail === normalized);
        if (!person) return '[]';
        const items = person.days.flatMap(day => day.items.map(item => ({
            date: day.date,
            itemKey: item.itemKey,
            kind: item.kind,
            bucket: item.bucket,
            clientId: item.client?.seoOpsClientId ?? '',
            campaignDeskClientId: item.client?.campaignDeskClientId ?? '',
            minutes: item.minutes,
            source: item.source,
            title: item.title,
            startTime: item.startTime ?? '',
        })));
        items.sort((left, right) => left.itemKey.localeCompare(right.itemKey) || left.date.localeCompare(right.date));
        return JSON.stringify(items);
    }
    const lines = week.allocations
        .filter(line => line.personEmail === normalized)
        .slice()
        .sort((left, right) => lineKey(left).localeCompare(lineKey(right)))
        .map(line => ({
            personEmail: line.personEmail,
            campaignDeskPersonId: line.campaignDeskPersonId,
            bucket: line.bucket,
            clientId: line.clientId ?? '',
            source: line.source,
            minutes: line.minutes,
        }));
    return JSON.stringify(lines);
}

function lineKey(line: ForecastAllocationLine): string {
    return [
        line.personEmail,
        line.campaignDeskPersonId,
        line.bucket,
        line.clientId ?? '',
        line.source,
        String(line.minutes),
    ].join('\0');
}

function ordered(lines: ForecastAllocationLine[]): ForecastAllocationLine[] {
    return lines.slice().sort((left, right) => lineKey(left).localeCompare(lineKey(right)));
}

export function sameLines(left: ForecastAllocationLine[], right: ForecastAllocationLine[]): boolean {
    const a = ordered(left);
    const b = ordered(right);
    const basisA = a[0]?.source ?? 'actual';
    const basisB = b[0]?.source ?? 'actual';
    return forecastPayloadHash({
        source: 'seo-ops-center',
        organizationId: '00000000-0000-4000-8000-000000000000',
        weeks: [{ weekStart: '2026-10-12', basis: basisA, allocations: a }],
    }) === forecastPayloadHash({
        source: 'seo-ops-center',
        organizationId: '00000000-0000-4000-8000-000000000000',
        weeks: [{ weekStart: '2026-10-12', basis: basisB, allocations: b }],
    });
}

export function memberForecastStatus(input: {
    match: PersonMatch;
    coveringRun: ForecastStatusRun | null;
    previousLines: ForecastAllocationLine[];
    currentLines: ForecastAllocationLine[];
    connectionEnabled: boolean;
    previousDigest?: string;
    currentDigest?: string;
}): ForecastMemberStatus {
    if (input.match.status === 'not_mapped') {
        return { status: 'not_mapped', reason: input.match.reason };
    }
    if (!input.coveringRun) {
        if (input.match.status === 'unknown') return { status: 'unknown', reason: input.match.reason };
        if (!input.connectionEnabled) {
            return { status: 'unknown', reason: 'Campaign Desk is not connected' };
        }
        return { status: 'unknown', reason: 'Not synced yet' };
    }
    const same = input.previousDigest != null || input.currentDigest != null
        ? (input.previousDigest ?? '') === (input.currentDigest ?? '')
        : sameLines(input.previousLines, input.currentLines);
    if (same) return { status: 'synced', reason: null };
    return { status: 'changed', reason: null };
}

export function latestRun(runs: ForecastStatusRun[]): ForecastStatusRun | null {
    return [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}

export function coveringRun(runs: ForecastStatusRun[], weekStart: string): ForecastStatusRun | null {
    return [...runs]
        .filter(run => run.weekStarts.includes(weekStart))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
}
