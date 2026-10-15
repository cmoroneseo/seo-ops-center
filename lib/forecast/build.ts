import { parseLocalDate } from '../planner/local-date.ts';
import { weekStartFor } from '../timesheets/ledger.ts';
import {
    FORECAST_SOURCE,
    hoursStringFromMinutes,
    normalizeEmail,
    type ForecastAllocationLine,
    type ForecastPayloadBody,
    type ForecastWeekPayload,
} from './contract.ts';

/**
 * Pure forecast for one manual sync.
 *
 * The current week and every earlier week use tracked time. Later weeks use
 * task estimates. Breaks are left out. Meetings are internal, including when
 * the event is tied to a client. Unmapped time is counted as a warning and is
 * not allocated. Missing numbers stay unknown; they are never written as zero.
 */

export interface ForecastMember {
    userId: string;
    displayName: string;
    email: string;
}

export interface ForecastDeskPerson {
    id: string;
    email: string;
}

export interface ForecastLog {
    id: string;
    userId: string;
    clientId?: string;
    clientName?: string;
    date: string;
    /** Null when the stored hours cannot be read. Never coerce that to zero. */
    hours: number | null;
    status: string;
    importStatus: string;
    voidedAt?: string;
    plannerEventId?: string;
    taskId?: string;
    taskTitle?: string;
    description?: string;
    clientDomain?: string;
}

export interface ForecastEvent {
    id: string;
    userId: string;
    attendeeIds: string[];
    kind: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    clientId?: string;
    clientName?: string;
    clientDomain?: string;
    taskId?: string;
    taskTitle?: string;
    title: string;
}

export interface ForecastTask {
    id: string;
    title: string;
    status: string;
    assigneeIds: string[];
    clientId?: string;
    clientName?: string;
    clientDomain?: string;
    startDate?: string;
    /** Null when the task has no estimate. */
    estimatedHours: number | null;
    /** True when a value was present but was not a usable number. */
    estimateUnreadable?: boolean;
}

export type PersonMatch =
    | { status: 'mapped'; campaignDeskPersonId: string }
    | { status: 'not_mapped'; reason: string }
    | { status: 'unknown'; reason: string };

export interface ForecastRowModel {
    clientId: string | null;
    clientName: string | null;
    bucket: 'client' | 'internal';
    source: 'actual' | 'estimate';
    minutes: number | null;
    minutesReason: string | null;
    sent: boolean;
}

export interface ForecastPersonModel {
    userId: string;
    displayName: string;
    email: string;
    match: PersonMatch;
    rows: ForecastRowModel[];
}

export interface ForecastWeekModel {
    weekStart: string;
    basis: 'actual' | 'estimate';
    people: ForecastPersonModel[];
}

export type ForecastWarningKind =
    | 'unmapped_entries'
    | 'unmapped_people'
    | 'missing_estimates'
    | 'open_entries'
    | 'unassigned_tasks'
    | 'multi_assignee_tasks'
    | 'outside_org_tasks'
    | 'all_day_meetings'
    | 'missing_client_names'
    | 'unreadable_hours'
    | 'missing_events'
    | 'unreadable_starts'
    | 'unmatched_clients'
    | 'over_day'
    | 'truncated_time_logs'
    | 'too_many_items';

export interface ForecastWarning {
    kind: ForecastWarningKind;
    count: number;
}

export interface ForecastBuildInput {
    organizationId: string;
    today: string;
    timeZone: string;
    selectedWeekStarts: string[];
    members: ForecastMember[];
    /**
     * Null when Campaign Desk's people list was not loaded. An empty array
     * means the list loaded and contained nobody.
     */
    directory: ForecastDeskPerson[] | null;
    directoryUnavailableReason?: string;
    logs: ForecastLog[];
    events: ForecastEvent[];
    tasks: ForecastTask[];
}

export interface ForecastBuildResult {
    weeks: ForecastWeekModel[];
    warnings: ForecastWarning[];
    /** Known break minutes left out. Zero means none were found. */
    breakMinutes: number;
    /** All-day breaks have no duration, so they are counted instead of timed. */
    allDayBreaks: number;
    /** Set by the version 2 builder. Version 1 leaves these unset. */
    payloadVersion?: 1 | 2;
    oooLeftOut?: number;
    unmatchedClients?: number;
    itemCount?: number;
    payloadBody: ForecastPayloadBody;
}

const DONE = new Set(['done', 'approved']);

interface NumericBucket {
    clientId: string | null;
    clientName: string | null;
    bucket: 'client' | 'internal';
    source: 'actual' | 'estimate';
    minutes: number;
}

interface Gap {
    clientId: string | null;
    clientName: string | null;
    bucket: 'client' | 'internal';
    source: 'actual' | 'estimate';
    reason: string;
}

interface PersonAccum {
    member: ForecastMember;
    buckets: Map<string, NumericBucket>;
    gaps: Gap[];
}

export function matchPerson(
    email: string,
    directory: ForecastDeskPerson[] | null,
    unavailableReason = 'Campaign Desk is not connected',
): PersonMatch {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes('@')) {
        return { status: 'not_mapped', reason: 'No email on this account' };
    }
    if (directory == null) return { status: 'unknown', reason: unavailableReason };
    const hits = directory.filter(person =>
        normalizeEmail(person.email) === normalized && person.id.trim() !== '');
    if (hits.length === 1) return { status: 'mapped', campaignDeskPersonId: hits[0].id.trim() };
    if (hits.length > 1) {
        return { status: 'not_mapped', reason: 'Campaign Desk has more than one person with this email' };
    }
    return { status: 'not_mapped', reason: 'No Campaign Desk person uses this email' };
}

export function calendarDateInTimeZone(instant: string, timeZone: string): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return parseLocalDate(instant) ? instant : null;
    const parsed = new Date(instant);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(parsed);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;
        if (!year || !month || !day) return null;
        return `${year}-${month}-${day}`;
    } catch {
        return null;
    }
}

export function forecastBasis(weekStart: string, today: string): 'actual' | 'estimate' {
    return weekStart <= weekStartFor(today) ? 'actual' : 'estimate';
}

function minutesFromHours(hours: number | null): number | null {
    if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
    return Math.round(hours * 60);
}

function eventMinutes(event: ForecastEvent): number | null {
    const start = new Date(event.startsAt).getTime();
    const end = new Date(event.endsAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return Math.round((end - start) / 60_000);
}

function bucketKey(bucket: NumericBucket): string {
    return `${bucket.bucket}\0${bucket.clientId ?? ''}\0${bucket.source}`;
}

function displayName(member: ForecastMember): string {
    const name = member.displayName.trim();
    if (name) return name;
    const email = normalizeEmail(member.email);
    return email.includes('@') ? email.split('@')[0] : 'Member';
}

export function buildForecast(input: ForecastBuildInput): ForecastBuildResult {
    const selected = [...new Set(input.selectedWeekStarts)].sort();
    const members = new Map(input.members.map(member => [member.userId, member]));
    const events = new Map(input.events.map(event => [event.id, event]));
    const warnings = new Map<ForecastWarningKind, number>();
    const bump = (kind: ForecastWarningKind, amount = 1) => {
        warnings.set(kind, (warnings.get(kind) ?? 0) + amount);
    };

    let breakMinutes = 0;
    let allDayBreaks = 0;
    const accums = new Map<string, Map<string, PersonAccum>>();

    const personFor = (weekStart: string, userId: string): PersonAccum | null => {
        const member = members.get(userId);
        if (!member) return null;
        let week = accums.get(weekStart);
        if (!week) {
            week = new Map();
            accums.set(weekStart, week);
        }
        let person = week.get(userId);
        if (!person) {
            person = { member, buckets: new Map(), gaps: [] };
            week.set(userId, person);
        }
        return person;
    };

    const addMinutes = (
        weekStart: string,
        userId: string,
        draft: Omit<NumericBucket, 'minutes'>,
        minutes: number,
    ) => {
        if (minutes <= 0) return;
        const person = personFor(weekStart, userId);
        if (!person) return;
        const key = bucketKey({ ...draft, minutes: 0 });
        const existing = person.buckets.get(key);
        if (existing) {
            existing.minutes += minutes;
            if (!existing.clientName && draft.clientName) existing.clientName = draft.clientName;
            return;
        }
        person.buckets.set(key, { ...draft, minutes });
    };

    const addGap = (weekStart: string, userId: string, gap: Gap) => {
        const person = personFor(weekStart, userId);
        if (!person) return;
        person.gaps.push(gap);
    };

    for (const log of input.logs) {
        if (log.voidedAt || log.importStatus === 'voided') continue;
        const event = log.plannerEventId ? events.get(log.plannerEventId) : undefined;
        if (log.plannerEventId && !event) {
            bump('missing_events');
            continue;
        }
        if (event?.kind === 'break') {
            if (event.allDay) allDayBreaks += 1;
            else {
                const minutes = minutesFromHours(log.hours);
                if (minutes != null && minutes > 0) breakMinutes += minutes;
            }
            continue;
        }
        if (log.importStatus === 'needs_context' || log.importStatus === 'pending_review' || !log.userId) {
            bump('unmapped_entries');
            continue;
        }
        if (log.status !== 'logged') {
            bump('open_entries');
            continue;
        }
        const minutes = minutesFromHours(log.hours);
        if (minutes == null) {
            bump('unreadable_hours');
            continue;
        }
        if (minutes === 0) continue;
        if (!parseLocalDate(log.date)) {
            bump('unreadable_hours');
            continue;
        }
        const weekStart = weekStartFor(log.date);
        if (!selected.includes(weekStart) || forecastBasis(weekStart, input.today) !== 'actual') continue;
        const meeting = event?.kind === 'meeting';
        const clientId = meeting ? null : log.clientId ?? null;
        const bucket = clientId ? 'client' as const : 'internal' as const;
        addMinutes(weekStart, log.userId, {
            clientId: bucket === 'internal' ? null : clientId,
            clientName: bucket === 'internal' ? 'Internal' : log.clientName?.trim() || null,
            bucket,
            source: 'actual',
        }, minutes);
    }

    for (const task of input.tasks) {
        if (DONE.has(task.status.toLowerCase())) continue;
        if (!task.startDate) continue;
        const day = calendarDateInTimeZone(task.startDate, input.timeZone);
        if (!day) {
            bump('unreadable_starts');
            continue;
        }
        const weekStart = weekStartFor(day);
        if (!selected.includes(weekStart) || forecastBasis(weekStart, input.today) !== 'estimate') continue;
        const assignees = [...new Set(task.assigneeIds.filter(Boolean))];
        if (assignees.length === 0) {
            bump('unassigned_tasks');
            continue;
        }
        if (assignees.length > 1) {
            bump('multi_assignee_tasks');
            continue;
        }
        if (!members.has(assignees[0])) {
            bump('outside_org_tasks');
            continue;
        }
        const clientId = task.clientId ?? null;
        const bucket = clientId ? 'client' as const : 'internal' as const;
        const clientName = bucket === 'internal' ? 'Internal' : task.clientName?.trim() || null;
        if (task.estimateUnreadable) {
            bump('unreadable_hours');
            addGap(weekStart, assignees[0], {
                clientId: bucket === 'internal' ? null : clientId,
                clientName,
                bucket,
                source: 'estimate',
                reason: `Hours on "${task.title}" could not be read`,
            });
            continue;
        }
        const minutes = minutesFromHours(task.estimatedHours);
        if (minutes == null || minutes === 0) {
            bump('missing_estimates');
            addGap(weekStart, assignees[0], {
                clientId: bucket === 'internal' ? null : clientId,
                clientName,
                bucket,
                source: 'estimate',
                reason: `No estimate on "${task.title}"`,
            });
            continue;
        }
        addMinutes(weekStart, assignees[0], {
            clientId: bucket === 'internal' ? null : clientId,
            clientName,
            bucket,
            source: 'estimate',
        }, minutes);
    }

    for (const event of input.events) {
        if (event.kind !== 'meeting' && event.kind !== 'break') continue;
        const day = calendarDateInTimeZone(event.startsAt, input.timeZone);
        if (!day) continue;
        const weekStart = weekStartFor(day);
        if (!selected.includes(weekStart) || forecastBasis(weekStart, input.today) !== 'estimate') continue;
        if (event.kind === 'break') {
            if (event.allDay) allDayBreaks += 1;
            else {
                const minutes = eventMinutes(event);
                if (minutes != null && minutes > 0) breakMinutes += minutes;
            }
            continue;
        }
        if (event.allDay) {
            bump('all_day_meetings');
            continue;
        }
        const minutes = eventMinutes(event);
        if (minutes == null) {
            bump('unreadable_hours');
            continue;
        }
        const people = [...new Set([event.userId, ...event.attendeeIds].filter(Boolean))];
        for (const userId of people) {
            addMinutes(weekStart, userId, {
                clientId: null,
                clientName: 'Internal',
                bucket: 'internal',
                source: 'estimate',
            }, minutes);
        }
    }

    const weeks: ForecastWeekModel[] = selected.map(weekStart => {
        const basis = forecastBasis(weekStart, input.today);
        const people = [...(accums.get(weekStart)?.values() ?? [])]
            .map(person => toPerson(
                person,
                input.directory,
                input.directoryUnavailableReason,
            ))
            .filter(person => person.rows.length > 0)
            .sort((left, right) => left.displayName.localeCompare(right.displayName));
        return { weekStart, basis, people };
    });

    const unmappedPeople = new Set(
        weeks.flatMap(week => week.people)
            .filter(person => person.match.status === 'not_mapped')
            .map(person => person.userId),
    );
    if (unmappedPeople.size > 0) bump('unmapped_people', unmappedPeople.size);
    const missingNames = weeks.flatMap(week => week.people).flatMap(person => person.rows)
        .filter(row => row.minutes != null && row.minutesReason === 'Client name is missing')
        .length;
    if (missingNames > 0) bump('missing_client_names', missingNames);

    const payloadWeeks: ForecastWeekPayload[] = weeks.map(week => ({
        weekStart: week.weekStart,
        basis: week.basis,
        allocations: week.people.flatMap(person => {
            if (person.match.status !== 'mapped') return [];
            const campaignDeskPersonId = person.match.campaignDeskPersonId;
            return person.rows.flatMap(row => {
                if (!row.sent || row.minutes == null || row.minutes <= 0) return [];
                if (row.bucket === 'client' && !row.clientId) return [];
                const line: ForecastAllocationLine = {
                    personEmail: person.email,
                    campaignDeskPersonId,
                    clientId: row.bucket === 'internal' ? null : row.clientId,
                    clientName: row.bucket === 'internal' ? 'Internal' : row.clientName ?? '',
                    bucket: row.bucket,
                    source: row.source,
                    minutes: row.minutes,
                    hours: hoursStringFromMinutes(row.minutes),
                };
                return line.clientName ? [line] : [];
            });
        }).sort(compareLines),
    }));

    return {
        weeks,
        warnings: [...warnings.entries()]
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => ({ kind, count })),
        breakMinutes,
        allDayBreaks,
        payloadBody: {
            source: FORECAST_SOURCE,
            organizationId: input.organizationId,
            weeks: payloadWeeks,
        },
    };
}

function toPerson(
    person: PersonAccum,
    directory: ForecastDeskPerson[] | null,
    unavailableReason: string | undefined,
): ForecastPersonModel {
    const email = normalizeEmail(person.member.email);
    const match = matchPerson(email, directory, unavailableReason);
    const numeric: ForecastRowModel[] = [...person.buckets.values()].map(bucket => {
        const named = bucket.bucket === 'internal' || Boolean(bucket.clientName);
        return {
            clientId: bucket.clientId,
            clientName: bucket.bucket === 'internal' ? 'Internal' : bucket.clientName,
            bucket: bucket.bucket,
            source: bucket.source,
            minutes: bucket.minutes,
            minutesReason: named ? null : 'Client name is missing',
            sent: match.status === 'mapped' && named && bucket.minutes > 0,
        };
    });
    const gaps: ForecastRowModel[] = person.gaps.map(gap => ({
        clientId: gap.clientId,
        clientName: gap.bucket === 'internal' ? 'Internal' : gap.clientName,
        bucket: gap.bucket,
        source: gap.source,
        minutes: null,
        minutesReason: gap.reason,
        sent: false,
    }));
    const rows = [...numeric, ...gaps].sort(compareRows);
    return {
        userId: person.member.userId,
        displayName: displayName(person.member),
        email,
        match,
        rows,
    };
}

function compareRows(left: ForecastRowModel, right: ForecastRowModel): number {
    const bucket = left.bucket.localeCompare(right.bucket);
    if (bucket !== 0) return bucket;
    const name = (left.clientName ?? '').localeCompare(right.clientName ?? '');
    if (name !== 0) return name;
    if (left.minutes == null && right.minutes != null) return 1;
    if (left.minutes != null && right.minutes == null) return -1;
    return 0;
}

function compareLines(left: ForecastAllocationLine, right: ForecastAllocationLine): number {
    return left.personEmail.localeCompare(right.personEmail)
        || left.bucket.localeCompare(right.bucket)
        || (left.clientId ?? '').localeCompare(right.clientId ?? '')
        || left.source.localeCompare(right.source);
}

export function lineIdentity(line: ForecastAllocationLine): string {
    return [
        line.personEmail,
        line.campaignDeskPersonId,
        line.bucket,
        line.clientId ?? '',
        line.source,
        String(line.minutes),
    ].join('\0');
}
