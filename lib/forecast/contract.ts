import { createHash } from 'node:crypto';

import { weekStartFor } from '../timesheets/ledger.ts';

/**
 * The body SEO Ops Center sends to Campaign Desk.
 *
 * One allocation is one person, one client (or the internal bucket), one week,
 * and one source. Hours are a two-decimal string so a float cannot drift.
 * `minutes` is the canonical integer. Allocation percent is not part of this
 * contract; the preview computes it for display and does not send it.
 */

export const FORECAST_SOURCE = 'seo-ops-center' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS = /^-?\d+\.\d{2}$/;

export interface ForecastAllocationLine {
    personEmail: string;
    campaignDeskPersonId: string;
    clientId: string | null;
    clientName: string;
    bucket: 'client' | 'internal';
    source: 'actual' | 'estimate';
    minutes: number;
    hours: string;
}

export interface ForecastWeekPayload {
    weekStart: string;
    basis: 'actual' | 'estimate';
    allocations: ForecastAllocationLine[];
}

export interface ForecastPayloadBody {
    source: typeof FORECAST_SOURCE;
    organizationId: string;
    weeks: ForecastWeekPayload[];
}

export interface ForecastPayload extends ForecastPayloadBody {
    runId: string;
}

export class ForecastPayloadError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ForecastPayloadError';
    }
}

/** Decimal hours with exactly two places. Half away from zero via Math.round. */
export function hoursStringFromMinutes(minutes: number): string {
    if (!Number.isInteger(minutes)) {
        throw new ForecastPayloadError('minutes must be an integer');
    }
    const negative = minutes < 0;
    const hundredths = Math.round((Math.abs(minutes) * 100) / 60);
    const whole = Math.floor(hundredths / 100);
    const fraction = String(hundredths % 100).padStart(2, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            if (record[key] !== undefined) sorted[key] = canonicalize(record[key]);
        }
        return sorted;
    }
    return value;
}

/** Stable hash of the hours we would send. The run id is not part of the hash. */
export function forecastPayloadHash(body: ForecastPayloadBody): string {
    const rest: ForecastPayloadBody & { runId?: string } = { ...body };
    delete rest.runId;
    return createHash('sha256').update(JSON.stringify(canonicalize(rest))).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new ForecastPayloadError(`${label} is missing`);
    }
    return value;
}

export function parseForecastPayload(value: unknown): ForecastPayload {
    if (!isRecord(value)) throw new ForecastPayloadError('Forecast payload must be an object');
    const runId = requireString(value.runId, 'runId');
    if (!UUID.test(runId)) throw new ForecastPayloadError('runId must be a uuid');
    if (value.source !== FORECAST_SOURCE) throw new ForecastPayloadError('source must be seo-ops-center');
    const organizationId = requireString(value.organizationId, 'organizationId');
    if (!UUID.test(organizationId)) throw new ForecastPayloadError('organizationId must be a uuid');
    if (!Array.isArray(value.weeks)) throw new ForecastPayloadError('weeks must be an array');

    const weeks = value.weeks.map(week => parseWeek(week));
    return {
        runId,
        source: FORECAST_SOURCE,
        organizationId,
        weeks,
    };
}

function parseWeek(value: unknown): ForecastWeekPayload {
    if (!isRecord(value)) throw new ForecastPayloadError('week must be an object');
    const weekStart = requireString(value.weekStart, 'weekStart');
    let monday = false;
    try {
        monday = DATE.test(weekStart) && weekStartFor(weekStart) === weekStart;
    } catch {
        monday = false;
    }
    if (!monday) throw new ForecastPayloadError('weekStart must be a Monday yyyy-MM-dd date');
    const basis = value.basis === 'actual' || value.basis === 'estimate' ? value.basis : null;
    if (!basis) throw new ForecastPayloadError('basis must be actual or estimate');
    if (!Array.isArray(value.allocations)) throw new ForecastPayloadError('allocations must be an array');
    return {
        weekStart,
        basis,
        allocations: value.allocations.map(line => parseLine(line, basis)),
    };
}

function parseLine(value: unknown, basis: 'actual' | 'estimate'): ForecastAllocationLine {
    if (!isRecord(value)) throw new ForecastPayloadError('allocation must be an object');
    const personEmail = normalizeEmail(requireString(value.personEmail, 'personEmail'));
    if (!personEmail.includes('@')) throw new ForecastPayloadError('personEmail must be an email');
    const campaignDeskPersonId = requireString(value.campaignDeskPersonId, 'campaignDeskPersonId');
    const bucket = value.bucket;
    if (bucket !== 'client' && bucket !== 'internal') {
        throw new ForecastPayloadError('bucket must be client or internal');
    }
    const clientId = value.clientId;
    const clientName = requireString(value.clientName, 'clientName');
    if (bucket === 'internal') {
        if (clientId !== null) throw new ForecastPayloadError('internal allocations have no client id');
        if (clientName !== 'Internal') throw new ForecastPayloadError('internal allocations are named Internal');
    } else if (typeof clientId !== 'string' || !UUID.test(clientId)) {
        throw new ForecastPayloadError('client allocations need a client uuid');
    }
    const source = value.source === basis ? basis : null;
    if (!source) throw new ForecastPayloadError('allocation source must match the week basis');
    if (typeof value.minutes !== 'number' || !Number.isInteger(value.minutes) || value.minutes < 0) {
        throw new ForecastPayloadError('minutes must be a non-negative integer');
    }
    if (typeof value.hours !== 'string' || !HOURS.test(value.hours)) {
        throw new ForecastPayloadError('hours must be a two-decimal string');
    }
    if (value.hours !== hoursStringFromMinutes(value.minutes)) {
        throw new ForecastPayloadError('hours must match minutes');
    }
    return {
        personEmail,
        campaignDeskPersonId,
        clientId: bucket === 'internal' ? null : clientId as string,
        clientName,
        bucket,
        source,
        minutes: value.minutes,
        hours: value.hours,
    };
}
