import { forecastPayloadHash, normalizeEmail, type ForecastAllocationLine, type ForecastPayload } from './contract.ts';
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
    payload: ForecastPayload;
}

export interface ForecastMemberStatus {
    status: 'synced' | 'changed' | 'not_mapped' | 'unknown';
    reason: string | null;
}

export function linesForPerson(
    payload: ForecastPayload,
    weekStart: string,
    email: string,
): ForecastAllocationLine[] {
    const week = payload.weeks.find(entry => entry.weekStart === weekStart);
    if (!week) return [];
    const normalized = normalizeEmail(email);
    return week.allocations
        .filter(line => line.personEmail === normalized)
        .slice()
        .sort((left, right) => lineKey(left).localeCompare(lineKey(right)));
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
    if (sameLines(input.previousLines, input.currentLines)) {
        return { status: 'synced', reason: null };
    }
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
