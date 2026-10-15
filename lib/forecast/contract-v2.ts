import { weekDays, weekStartFor } from '../timesheets/ledger.ts';
import {
    FORECAST_SOURCE,
    ForecastPayloadError,
    hoursStringFromMinutes,
    parseForecastPayload,
    type ForecastPayload,
} from './contract.ts';

/**
 * Campaign Desk payload version 2. Unknown keys are rejected. Version 1 is
 * unchanged: omit `version` and send `allocations`.
 *
 * The receiver's contract is docs/campaign-desk-sync-v2.md in Campaign Desk.
 * Minutes are an integer from 1 to 1440. Hours are minutes ÷ 60, half away
 * from zero, two decimal places. An item's source matches the week basis.
 * weekStart is the Monday. itemKey is stable `kind:id:date`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const RUN_KEYS = ['version', 'runId', 'source', 'organizationId', 'weeks'] as const;
const WEEK_KEYS = ['weekStart', 'basis', 'people'] as const;
const PERSON_KEYS = ['personEmail', 'campaignDeskPersonId', 'days'] as const;
const DAY_KEYS = ['date', 'items'] as const;
const ITEM_KEYS = ['itemKey', 'kind', 'bucket', 'client', 'title', 'source', 'minutes', 'hours', 'startTime', 'sourceIds'] as const;
const CLIENT_KEYS = ['seoOpsClientId', 'name', 'domain', 'campaignDeskClientId'] as const;
const SOURCE_ID_KEYS = ['taskId', 'timeLogIds', 'plannerEventId'] as const;

const MAX_ITEMS = 500;
const MAX_MINUTES = 1440;
const MAX_TITLE = 500;
const MAX_ITEM_KEY = 200;
const MAX_TIME_LOG_IDS = 50;
const MAX_DOMAIN = 253;
const MAX_CLIENT_KEY = 64;

export interface ForecastItemClient {
    seoOpsClientId: string;
    name: string;
    domain: string | null;
    campaignDeskClientId: string | null;
}

export interface ForecastItemSourceIds {
    taskId: string | null;
    timeLogIds: string[];
    plannerEventId: string | null;
}

export interface ForecastItem {
    itemKey: string;
    kind: 'task' | 'event';
    bucket: 'client' | 'internal';
    client: ForecastItemClient | null;
    title: string;
    source: 'actual' | 'estimate';
    minutes: number;
    hours: string;
    startTime: string | null;
    sourceIds: ForecastItemSourceIds;
}

export interface ForecastDayPayload {
    date: string;
    items: ForecastItem[];
}

export interface ForecastPersonPayload {
    personEmail: string;
    campaignDeskPersonId: string;
    days: ForecastDayPayload[];
}

export interface ForecastWeekPayloadV2 {
    weekStart: string;
    basis: 'actual' | 'estimate';
    people: ForecastPersonPayload[];
}

export interface ForecastPayloadBodyV2 {
    version: 2;
    source: typeof FORECAST_SOURCE;
    organizationId: string;
    weeks: ForecastWeekPayloadV2[];
}

export interface ForecastPayloadV2 extends ForecastPayloadBodyV2 {
    runId: string;
}

export type StoredForecastPayload = ForecastPayload | ForecastPayloadV2;

export function isForecastPayloadV2(payload: StoredForecastPayload): payload is ForecastPayloadV2 {
    return 'version' in payload && payload.version === 2;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): string | null {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) return key;
    }
    return null;
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[], at: string): void {
    for (const key of keys) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
            throw new ForecastPayloadError(`${at}.${key} is required`);
        }
    }
}

function dateInWeek(date: string, weekStart: string): boolean {
    try {
        return weekDays(weekStart).includes(date);
    } catch {
        return false;
    }
}

function optionalUuid(value: unknown, at: string): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !UUID.test(value)) {
        throw new ForecastPayloadError(`${at} must be a UUID or null`);
    }
    return value.toLowerCase();
}

function parseClient(value: unknown, at: string): ForecastItemClient {
    if (!isRecord(value)) throw new ForecastPayloadError(`${at} must be an object`);
    const extra = unknownKey(value, CLIENT_KEYS);
    if (extra) throw new ForecastPayloadError(`${at}.${extra} is not allowed`);
    if (typeof value.seoOpsClientId !== 'string' || !UUID.test(value.seoOpsClientId)) {
        throw new ForecastPayloadError(`${at}.seoOpsClientId must be a UUID`);
    }
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.trim() === 'Internal') {
        throw new ForecastPayloadError(`${at}.name must be the client name`);
    }
    if (value.name.trim().length > MAX_TITLE) throw new ForecastPayloadError(`${at}.name is too long`);
    let domain: string | null = null;
    if (value.domain !== undefined && value.domain !== null) {
        if (typeof value.domain !== 'string' || value.domain.trim().length > MAX_DOMAIN) {
            throw new ForecastPayloadError(`${at}.domain must be a string or null`);
        }
        domain = value.domain.trim() || null;
    }
    if (!Object.prototype.hasOwnProperty.call(value, 'campaignDeskClientId')) {
        throw new ForecastPayloadError(`${at}.campaignDeskClientId must be a string or null`);
    }
    let campaignDeskClientId: string | null = null;
    if (value.campaignDeskClientId !== null) {
        if (
            typeof value.campaignDeskClientId !== 'string'
            || !value.campaignDeskClientId.trim()
            || value.campaignDeskClientId !== value.campaignDeskClientId.trim()
            || value.campaignDeskClientId.length > MAX_CLIENT_KEY
        ) {
            throw new ForecastPayloadError(`${at}.campaignDeskClientId must be a string or null`);
        }
        campaignDeskClientId = value.campaignDeskClientId;
    }
    return {
        seoOpsClientId: value.seoOpsClientId.toLowerCase(),
        name: value.name.trim(),
        domain,
        campaignDeskClientId,
    };
}

function parseSourceIds(value: unknown, at: string): ForecastItemSourceIds {
    if (!isRecord(value)) throw new ForecastPayloadError(`${at} must be an object`);
    const extra = unknownKey(value, SOURCE_ID_KEYS);
    if (extra) throw new ForecastPayloadError(`${at}.${extra} is not allowed`);
    requireKeys(value, SOURCE_ID_KEYS, at);
    const taskId = optionalUuid(value.taskId, `${at}.taskId`);
    const plannerEventId = optionalUuid(value.plannerEventId, `${at}.plannerEventId`);
    if (!Array.isArray(value.timeLogIds)) throw new ForecastPayloadError(`${at}.timeLogIds must be an array`);
    if (value.timeLogIds.length > MAX_TIME_LOG_IDS) throw new ForecastPayloadError(`${at}.timeLogIds is too long`);
    const timeLogIds: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < value.timeLogIds.length; index += 1) {
        const id = value.timeLogIds[index];
        if (typeof id !== 'string' || !UUID.test(id)) {
            throw new ForecastPayloadError(`${at}.timeLogIds[${index}] must be a UUID`);
        }
        const lower = id.toLowerCase();
        if (seen.has(lower)) throw new ForecastPayloadError(`${at}.timeLogIds[${index}] is repeated`);
        seen.add(lower);
        timeLogIds.push(lower);
    }
    return { taskId, timeLogIds, plannerEventId };
}

function parseItem(value: unknown, at: string, basis: 'actual' | 'estimate'): ForecastItem {
    if (!isRecord(value)) throw new ForecastPayloadError(`${at} must be an object`);
    const extra = unknownKey(value, ITEM_KEYS);
    if (extra) throw new ForecastPayloadError(`${at}.${extra} is not allowed`);
    requireKeys(value, ITEM_KEYS, at);
    if (
        typeof value.itemKey !== 'string'
        || value.itemKey.length < 1
        || value.itemKey.length > MAX_ITEM_KEY
        || value.itemKey !== value.itemKey.trim()
        || /[\u0000-\u001f]/.test(value.itemKey)
    ) {
        throw new ForecastPayloadError(`${at}.itemKey must be a short stable string`);
    }
    if (value.kind !== 'task' && value.kind !== 'event') {
        throw new ForecastPayloadError(`${at}.kind must be task or event`);
    }
    if (value.bucket !== 'client' && value.bucket !== 'internal') {
        throw new ForecastPayloadError(`${at}.bucket must be client or internal`);
    }
    let client: ForecastItemClient | null = null;
    if (value.bucket === 'internal') {
        if (value.client !== null) throw new ForecastPayloadError(`${at}.client must be null when bucket is internal`);
    } else {
        client = parseClient(value.client, `${at}.client`);
    }
    if (typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > MAX_TITLE) {
        throw new ForecastPayloadError(`${at}.title must be the item title`);
    }
    if (value.source !== basis) throw new ForecastPayloadError(`${at}.source must match basis`);
    if (
        typeof value.minutes !== 'number'
        || !Number.isInteger(value.minutes)
        || value.minutes < 1
        || value.minutes > MAX_MINUTES
    ) {
        throw new ForecastPayloadError(`${at}.minutes must be an integer from 1 to 1440`);
    }
    if (typeof value.hours !== 'string' || value.hours !== hoursStringFromMinutes(value.minutes)) {
        throw new ForecastPayloadError(`${at}.hours must equal minutes / 60`);
    }
    if (value.startTime !== null && (typeof value.startTime !== 'string' || !TIME.test(value.startTime))) {
        throw new ForecastPayloadError(`${at}.startTime must be HH:MM or null`);
    }
    return {
        itemKey: value.itemKey,
        kind: value.kind,
        bucket: value.bucket,
        client,
        title: value.title.trim(),
        source: basis,
        minutes: value.minutes,
        hours: value.hours,
        startTime: value.startTime,
        sourceIds: parseSourceIds(value.sourceIds, `${at}.sourceIds`),
    };
}

export function parseForecastPayloadV2(value: unknown): ForecastPayloadV2 {
    if (!isRecord(value)) throw new ForecastPayloadError('Forecast payload must be an object');
    const extra = unknownKey(value, RUN_KEYS);
    if (extra) throw new ForecastPayloadError(`${extra} is not allowed`);
    if (value.version !== 2) throw new ForecastPayloadError('version must be the number 2');
    if (typeof value.runId !== 'string' || !UUID.test(value.runId)) {
        throw new ForecastPayloadError('runId must be a UUID');
    }
    if (value.source !== FORECAST_SOURCE) throw new ForecastPayloadError('source must be seo-ops-center');
    if (typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)) {
        throw new ForecastPayloadError('organizationId must be a UUID');
    }
    if (!Array.isArray(value.weeks) || value.weeks.length < 1 || value.weeks.length > 4) {
        throw new ForecastPayloadError('weeks must contain 1 to 4 weeks');
    }

    const weeks: ForecastWeekPayloadV2[] = [];
    const seenWeeks = new Set<string>();
    let itemCount = 0;
    for (let weekIndex = 0; weekIndex < value.weeks.length; weekIndex += 1) {
        const week = value.weeks[weekIndex];
        const at = `weeks[${weekIndex}]`;
        if (!isRecord(week)) throw new ForecastPayloadError(`${at} must be an object`);
        const weekExtra = unknownKey(week, WEEK_KEYS);
        if (weekExtra) throw new ForecastPayloadError(`${at}.${weekExtra} is not allowed`);
        const weekStart = week.weekStart;
        let monday = false;
        try {
            monday = typeof weekStart === 'string' && DATE.test(weekStart) && weekStartFor(weekStart) === weekStart;
        } catch {
            monday = false;
        }
        if (!monday) throw new ForecastPayloadError(`${at}.weekStart must be a Monday yyyy-MM-dd`);
        if (seenWeeks.has(weekStart as string)) throw new ForecastPayloadError(`${at}.weekStart is repeated`);
        seenWeeks.add(weekStart as string);
        const basis = week.basis === 'actual' || week.basis === 'estimate' ? week.basis : null;
        if (!basis) throw new ForecastPayloadError(`${at}.basis must be actual or estimate`);
        if (!Array.isArray(week.people)) throw new ForecastPayloadError(`${at}.people must be an array`);

        const people: ForecastPersonPayload[] = [];
        const seenPeople = new Set<string>();
        for (let personIndex = 0; personIndex < week.people.length; personIndex += 1) {
            const person = week.people[personIndex];
            const personAt = `${at}.people[${personIndex}]`;
            if (!isRecord(person)) throw new ForecastPayloadError(`${personAt} must be an object`);
            const personExtra = unknownKey(person, PERSON_KEYS);
            if (personExtra) throw new ForecastPayloadError(`${personAt}.${personExtra} is not allowed`);
            if (typeof person.personEmail !== 'string' || person.personEmail !== person.personEmail.toLowerCase() || !EMAIL.test(person.personEmail)) {
                throw new ForecastPayloadError(`${personAt}.personEmail must be a lowercase email`);
            }
            if (typeof person.campaignDeskPersonId !== 'string' || person.campaignDeskPersonId.trim() === '' || person.campaignDeskPersonId !== person.campaignDeskPersonId.trim()) {
                throw new ForecastPayloadError(`${personAt}.campaignDeskPersonId must be a string`);
            }
            if (seenPeople.has(person.personEmail)) throw new ForecastPayloadError(`${personAt}.personEmail is repeated`);
            seenPeople.add(person.personEmail);
            if (!Array.isArray(person.days)) throw new ForecastPayloadError(`${personAt}.days must be an array`);

            const days: ForecastDayPayload[] = [];
            const seenDates = new Set<string>();
            for (let dayIndex = 0; dayIndex < person.days.length; dayIndex += 1) {
                const day = person.days[dayIndex];
                const dayAt = `${personAt}.days[${dayIndex}]`;
                if (!isRecord(day)) throw new ForecastPayloadError(`${dayAt} must be an object`);
                const dayExtra = unknownKey(day, DAY_KEYS);
                if (dayExtra) throw new ForecastPayloadError(`${dayAt}.${dayExtra} is not allowed`);
                if (typeof day.date !== 'string' || !DATE.test(day.date) || !dateInWeek(day.date, weekStart as string)) {
                    throw new ForecastPayloadError(`${dayAt}.date must be a day in the week`);
                }
                if (seenDates.has(day.date)) throw new ForecastPayloadError(`${dayAt}.date is repeated`);
                seenDates.add(day.date);
                if (!Array.isArray(day.items)) throw new ForecastPayloadError(`${dayAt}.items must be an array`);
                const items: ForecastItem[] = [];
                const seenKeys = new Set<string>();
                for (let itemIndex = 0; itemIndex < day.items.length; itemIndex += 1) {
                    itemCount += 1;
                    if (itemCount > MAX_ITEMS) {
                        throw new ForecastPayloadError(`a run can include at most ${MAX_ITEMS} items`);
                    }
                    const item = parseItem(day.items[itemIndex], `${dayAt}.items[${itemIndex}]`, basis);
                    if (seenKeys.has(item.itemKey)) {
                        throw new ForecastPayloadError(`${dayAt}.items[${itemIndex}].itemKey is repeated`);
                    }
                    seenKeys.add(item.itemKey);
                    items.push(item);
                }
                days.push({ date: day.date, items });
            }
            people.push({
                personEmail: person.personEmail,
                campaignDeskPersonId: person.campaignDeskPersonId,
                days,
            });
        }
        weeks.push({ weekStart: weekStart as string, basis, people });
    }

    return {
        version: 2,
        runId: (value.runId as string).toLowerCase(),
        source: FORECAST_SOURCE,
        organizationId: (value.organizationId as string).toLowerCase(),
        weeks,
    };
}

/** Version 2 when `version` is 2. Version 1 when `version` is omitted. */
export function parseStoredForecastPayload(value: unknown): StoredForecastPayload {
    if (!isRecord(value)) throw new ForecastPayloadError('Forecast payload must be an object');
    if (!Object.prototype.hasOwnProperty.call(value, 'version')) return parseForecastPayload(value);
    if (value.version === 2) return parseForecastPayloadV2(value);
    throw new ForecastPayloadError('version must be omitted or the number 2');
}
