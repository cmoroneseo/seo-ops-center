import { parseLocalDate } from '../planner/local-date.ts';
import { weekStartFor } from '../timesheets/ledger.ts';
import {
    calendarDateInTimeZone,
    forecastBasis,
    matchPerson,
    type ForecastBuildInput,
    type ForecastEvent,
    type ForecastLog,
    type ForecastPersonModel,
    type ForecastRowModel,
    type ForecastWarning,
    type ForecastWarningKind,
    type ForecastWeekModel,
} from './build.ts';
import {
    attributeBasecampProject,
    type ForecastBasecampProject,
    type ProjectClientAttribution,
} from './basecamp-project.ts';
import { resolveCampaignDeskClientId, type ForecastDeskClient, type ForecastSeoClient } from './clients.ts';
import { FORECAST_SOURCE, hoursStringFromMinutes, normalizeEmail } from './contract.ts';
import type { ForecastItem, ForecastItemClient, ForecastPayloadBodyV2 } from './contract-v2.ts';

/**
 * Version 2 forecast. The current week and earlier weeks send tracked time,
 * one item per person, day, and task or event. Later weeks put each task
 * estimate on the task start date. Breaks are left out. Out of office is not
 * sent. A client meeting is an event on that client. An internal event has
 * no client. Estimates shared by several people are split evenly. Actual
 * time stays with the person who tracked it.
 *
 * startTime places an item on the hour grid. It does not decide whether the
 * minutes count. For actuals the clock is the focus block start, then the
 * time log's planned start, then the event start. An estimate uses the task
 * start when the timestamp includes a time. A bare date, an all-day block,
 * and any other unscheduled item stay null so Campaign Desk can queue them.
 *
 * Time logged from a planner block is the time log whose planner event id
 * is that block. When that log names a Basecamp project, the hours prefer
 * the SEO or Campaign Desk client for that project. No match still sends
 * the hours as internal.
 */

const DONE = new Set(['done']);
const MAX_MINUTES = 1440;
const MAX_TIME_LOG_IDS = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ForecastV2Input extends ForecastBuildInput {
    clientLinks: ReadonlyMap<string, string>;
    /** Null when GET /v1/clients did not load. An empty list loaded nobody. */
    deskClients: ForecastDeskClient[] | null;
    /** Basecamp projects referenced by logged blocks. Absent means none. */
    basecampProjects?: readonly ForecastBasecampProject[];
    /** SEO clients used to turn a project name into a real client. */
    seoClients?: readonly ForecastSeoClient[];
}

export interface ForecastV2BuildResult {
    weeks: ForecastWeekModel[];
    warnings: ForecastWarning[];
    breakMinutes: number;
    allDayBreaks: number;
    oooLeftOut: number;
    unmatchedClients: number;
    itemCount: number;
    splitEstimates: number;
    nameMatches: { clientId: string; campaignDeskClientId: string }[];
    payloadVersion: 2;
    payloadBody: ForecastPayloadBodyV2;
}

interface Group {
    userId: string;
    date: string;
    itemKey: string;
    kind: 'task' | 'event';
    bucket: 'client' | 'internal';
    title: string;
    source: 'actual' | 'estimate';
    minutes: number;
    startTime: string | null;
    /** Higher wins when several logs share an item. Focus, then planned, then event. */
    startRank: number;
    taskId: string | null;
    plannerEventId: string | null;
    timeLogIds: string[];
    votes: Map<string, { minutes: number; name: string | null; domain: string | null }>;
}

interface Gap {
    userId: string;
    weekStart: string;
    clientId: string | null;
    clientName: string | null;
    bucket: 'client' | 'internal';
    source: 'actual' | 'estimate';
    reason: string;
}

export function splitMinutesEvenly(total: number, count: number): number[] {
    if (count <= 0 || total <= 0) return [];
    const base = Math.floor(total / count);
    let remainder = total % count;
    return Array.from({ length: count }, () => {
        const extra = remainder > 0 ? 1 : 0;
        if (remainder > 0) remainder -= 1;
        return base + extra;
    });
}

export function clockTimeInTimeZone(instant: string, timeZone: string): string | null {
    const parsed = new Date(instant);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(parsed);
        let hour = parts.find(part => part.type === 'hour')?.value;
        const minute = parts.find(part => part.type === 'minute')?.value;
        if (!hour || !minute) return null;
        if (hour === '24') hour = '00';
        const clock = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
        return /^([01]\d|2[0-3]):[0-5]\d$/.test(clock) ? clock : null;
    } catch {
        return null;
    }
}

/** HH:MM for a focus block. All-day focus, and every other kind, stay untimed. */
function focusStartTime(event: ForecastEvent | undefined, timeZone: string): string | null {
    if (!event || event.kind !== 'focus' || event.allDay) return null;
    return clockTimeInTimeZone(event.startsAt, timeZone);
}

/**
 * HH:MM for a task placed on the clock. A bare YYYY-MM-DD has a day and no
 * hour, so the estimate stays queued.
 */
function scheduledTaskStartTime(startDate: string, timeZone: string): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    return clockTimeInTimeZone(startDate, timeZone);
}

/**
 * Clock for one actual. Focus wins, then the time the log was planned to
 * start, then the block on the planner. All-day blocks have no clock.
 */
function actualStartTime(
    log: ForecastLog,
    event: ForecastEvent | undefined,
    timeZone: string,
): { time: string | null; rank: number } {
    const focus = focusStartTime(event, timeZone);
    if (focus) return { time: focus, rank: 3 };
    if (log.plannedStartsAt) {
        const planned = clockTimeInTimeZone(log.plannedStartsAt, timeZone);
        if (planned) return { time: planned, rank: 2 };
    }
    if (event && !event.allDay && event.kind !== 'break' && event.kind !== 'ooo') {
        const clock = clockTimeInTimeZone(event.startsAt, timeZone);
        if (clock) return { time: clock, rank: 1 };
    }
    return { time: null, rank: 0 };
}

function sameInstant(left: string | undefined, right: string | undefined): boolean {
    if (!left || !right) return false;
    const a = Date.parse(left);
    const b = Date.parse(right);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 60_000;
}

function blockCounts(
    log: ForecastLog,
    events: Map<string, ForecastEvent>,
    selected: string[],
    today: string,
    members: { has(userId: string): boolean },
): boolean {
    if (!log.plannerEventId || !log.userId || !members.has(log.userId)) return false;
    if (log.voidedAt || log.importStatus === 'voided') return false;
    if (log.importStatus === 'needs_context' || log.importStatus === 'pending_review') return false;
    if (log.status !== 'logged') return false;
    const minutes = minutesFromHours(log.hours);
    if (minutes == null || minutes <= 0 || !parseLocalDate(log.date)) return false;
    const weekStart = weekStartFor(log.date);
    if (!selected.includes(weekStart) || forecastBasis(weekStart, today) !== 'actual') return false;
    const event = events.get(log.plannerEventId);
    return Boolean(event && event.kind !== 'break' && event.kind !== 'ooo');
}

/**
 * A second time log for the same person, start, and length as a block that
 * already has its own logged entry. The block log is the one that counts.
 */
function shadowsBlockLog(
    log: ForecastLog,
    logs: readonly ForecastLog[],
    events: Map<string, ForecastEvent>,
    selected: string[],
    today: string,
    members: { has(userId: string): boolean },
): boolean {
    if (log.plannerEventId || !log.plannedStartsAt || !log.userId) return false;
    const minutes = minutesFromHours(log.hours);
    if (minutes == null || minutes <= 0) return false;
    return logs.some(other => {
        if (other.id === log.id || other.userId !== log.userId) return false;
        if (!blockCounts(other, events, selected, today, members)) return false;
        const event = other.plannerEventId ? events.get(other.plannerEventId) : undefined;
        const anchor = event && !event.allDay ? event.startsAt : other.plannedStartsAt;
        if (!sameInstant(log.plannedStartsAt, anchor)) return false;
        const otherMinutes = minutesFromHours(other.hours);
        return otherMinutes != null && Math.abs(otherMinutes - minutes) <= 1;
    });
}

function minutesFromHours(hours: number | null): number | null {
    if (hours == null || !Number.isFinite(hours) || hours < 0) return null;
    return Math.round(hours * 60);
}

function uuidOrNull(value: string | undefined): string | null {
    if (!value || !UUID.test(value)) return null;
    return value.toLowerCase();
}

function cleanTitle(value: string | undefined, fallback: string): string {
    const trimmed = (value ?? '').replace(/[\u0000-\u001f]/g, '').trim();
    return (trimmed || fallback).slice(0, 500);
}

function cleanDomain(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? '';
    if (!trimmed || trimmed.length > 253) return null;
    return trimmed;
}

function itemKey(kind: 'task' | 'event', id: string, date: string): string {
    return `${kind}:${id}:${date}`;
}

function displayName(member: { displayName: string; email: string }): string {
    const name = member.displayName.trim();
    if (name) return name;
    const email = normalizeEmail(member.email);
    return email.includes('@') ? email.split('@')[0] : 'Member';
}

export function buildForecastV2(input: ForecastV2Input): ForecastV2BuildResult {
    const selected = [...new Set(input.selectedWeekStarts)].sort();
    const members = new Map(input.members.map(member => [member.userId, member]));
    const events = new Map(input.events.map(event => [event.id, event]));
    const warnings = new Map<ForecastWarningKind, number>();
    const bump = (kind: ForecastWarningKind, amount = 1) => {
        warnings.set(kind, (warnings.get(kind) ?? 0) + amount);
    };

    let breakMinutes = 0;
    let allDayBreaks = 0;
    let oooLeftOut = 0;
    let splitEstimates = 0;
    const groups = new Map<string, Group>();
    const gaps: Gap[] = [];
    const forcedDesk = new Map<string, string>();

    const addGroup = (draft: Omit<Group, 'minutes' | 'timeLogIds' | 'votes'> & {
        minutes: number;
        timeLogId?: string;
        clientId: string | null;
        clientName: string | null;
        clientDomain: string | null;
    }) => {
        if (draft.minutes <= 0) return;
        const key = `${draft.userId}\0${draft.itemKey}`;
        const voteKey = draft.bucket === 'internal' ? '' : (draft.clientId ?? '');
        const existing = groups.get(key);
        if (existing) {
            existing.minutes += draft.minutes;
            if (draft.timeLogId && !existing.timeLogIds.includes(draft.timeLogId)) {
                existing.timeLogIds.push(draft.timeLogId);
            }
            if (existing.title === 'Tracked time' && draft.title !== 'Tracked time') existing.title = draft.title;
            if (draft.startRank > existing.startRank) {
                existing.startTime = draft.startTime;
                existing.startRank = draft.startRank;
            }
            if (voteKey) {
                const vote = existing.votes.get(voteKey);
            if (vote) {
                vote.minutes += draft.minutes;
                if (!vote.name && draft.clientName) vote.name = draft.clientName;
                if (!vote.domain && draft.clientDomain) vote.domain = draft.clientDomain;
            } else existing.votes.set(voteKey, {
                    minutes: draft.minutes,
                    name: draft.clientName,
                    domain: draft.clientDomain,
                });
            }
            return;
        }
        const votes = new Map<string, { minutes: number; name: string | null; domain: string | null }>();
        if (voteKey) {
            votes.set(voteKey, { minutes: draft.minutes, name: draft.clientName, domain: draft.clientDomain });
        }
        groups.set(key, {
            userId: draft.userId,
            date: draft.date,
            itemKey: draft.itemKey,
            kind: draft.kind,
            bucket: draft.bucket,
            title: draft.title,
            source: draft.source,
            minutes: draft.minutes,
            startTime: draft.startTime,
            startRank: draft.startRank,
            taskId: draft.taskId,
            plannerEventId: draft.plannerEventId,
            timeLogIds: draft.timeLogId ? [draft.timeLogId] : [],
            votes,
        });
    };

    function projectAttribution(
        log: ForecastLog,
        event: ForecastEvent | undefined,
    ): ProjectClientAttribution | null {
        const meeting = event?.kind === 'meeting';
        const internalEvent = event?.kind === 'event';
        if (!meeting && !internalEvent) return null;
        const eventClientId = meeting ? uuidOrNull(event?.clientId) ?? uuidOrNull(log.clientId) : null;
        if (eventClientId) return null;
        const attributed = attributeBasecampProject({
            projectId: log.basecampProjectId,
            projects: input.basecampProjects ?? [],
            seoClients: input.seoClients ?? [],
            deskClients: input.deskClients,
            links: input.clientLinks,
        });
        if (attributed?.campaignDeskClientId) {
            forcedDesk.set(attributed.clientId.toLowerCase(), attributed.campaignDeskClientId);
        }
        return attributed;
    }

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
        if (event?.kind === 'ooo') {
            oooLeftOut += 1;
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
        if (!members.has(log.userId)) continue;
        if (shadowsBlockLog(log, input.logs, events, selected, input.today, members)) continue;
        const attribution = projectAttribution(log, event);
        const classified = classifyLog(log, event, input.timeZone, attribution);
        addGroup({ ...classified, minutes, timeLogId: uuidOrNull(log.id) ?? undefined, source: 'actual' });
    }

    for (const event of input.events) {
        if (event.kind !== 'break' && event.kind !== 'ooo') continue;
        const day = calendarDateInTimeZone(event.startsAt, input.timeZone);
        if (!day) continue;
        const weekStart = weekStartFor(day);
        if (!selected.includes(weekStart) || forecastBasis(weekStart, input.today) !== 'estimate') continue;
        if (event.kind === 'ooo') {
            oooLeftOut += 1;
            continue;
        }
        if (event.allDay) allDayBreaks += 1;
        else {
            const start = new Date(event.startsAt).getTime();
            const end = new Date(event.endsAt).getTime();
            if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
                const minutes = Math.round((end - start) / 60_000);
                if (minutes > 0) breakMinutes += minutes;
            }
        }
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
        const assignees = [...new Set(task.assigneeIds.filter(Boolean))].sort();
        if (assignees.length === 0) {
            bump('unassigned_tasks');
            continue;
        }
        const inOrg = assignees.filter(userId => members.has(userId));
        if (inOrg.length === 0) {
            bump('outside_org_tasks');
            continue;
        }
        if (inOrg.length !== assignees.length) bump('outside_org_tasks');
        if (assignees.length > 1) splitEstimates += 1;
        const clientId = uuidOrNull(task.clientId);
        const bucket = clientId ? 'client' as const : 'internal' as const;
        const clientName = bucket === 'internal' ? null : task.clientName?.trim() || null;
        if (task.estimateUnreadable) {
            bump('unreadable_hours');
            for (const userId of inOrg) {
                gaps.push({
                    userId, weekStart, clientId, clientName, bucket, source: 'estimate',
                    reason: `Hours on "${task.title}" could not be read`,
                });
            }
            continue;
        }
        const minutes = minutesFromHours(task.estimatedHours);
        if (minutes == null || minutes === 0) {
            bump('missing_estimates');
            for (const userId of inOrg) {
                gaps.push({
                    userId, weekStart, clientId, clientName, bucket, source: 'estimate',
                    reason: `No estimate on "${task.title}"`,
                });
            }
            continue;
        }
        const shares = splitMinutesEvenly(minutes, assignees.length);
        const startTime = scheduledTaskStartTime(task.startDate, input.timeZone);
        assignees.forEach((userId, index) => {
            if (!members.has(userId)) return;
            const share = shares[index] ?? 0;
            if (share < 1) return;
            const capped = Math.min(share, MAX_MINUTES);
            if (capped < share) bump('over_day');
            addGroup({
                userId,
                date: day,
                itemKey: itemKey('task', uuidOrNull(task.id) ?? task.id, day),
                kind: 'task',
                bucket,
                title: cleanTitle(task.title, 'Untitled task'),
                source: 'estimate',
                minutes: capped,
                startTime,
                startRank: startTime ? 1 : 0,
                taskId: uuidOrNull(task.id),
                plannerEventId: null,
                clientId,
                clientName,
                clientDomain: cleanDomain(task.clientDomain),
            });
        });
    }

    const emitted = [];
    for (const group of groups.values()) {
        const item = finalizeGroup(group, bump);
        if (item) emitted.push(item);
    }

    const unmatched = new Set<string>();
    const nameMatches: { clientId: string; campaignDeskClientId: string }[] = [];
    const seenNameMatches = new Set<string>();

    const toClient = (
        clientId: string,
        name: string,
        domain: string | null,
    ): ForecastItemClient | null => {
        if (!UUID.test(clientId) || !name.trim() || name.trim() === 'Internal') return null;
        const forced = forcedDesk.get(clientId.toLowerCase());
        if (forced) {
            return {
                seoOpsClientId: clientId.toLowerCase(),
                name: name.trim(),
                domain,
                campaignDeskClientId: forced,
            };
        }
        const resolved = resolveCampaignDeskClientId({
            seoClientId: clientId.toLowerCase(),
            name,
            links: input.clientLinks,
            deskClients: input.deskClients,
        });
        if (!resolved.id) unmatched.add(clientId.toLowerCase());
        if (resolved.suggested && resolved.id && !seenNameMatches.has(clientId.toLowerCase())) {
            seenNameMatches.add(clientId.toLowerCase());
            nameMatches.push({ clientId: clientId.toLowerCase(), campaignDeskClientId: resolved.id });
        }
        return {
            seoOpsClientId: clientId.toLowerCase(),
            name: name.trim(),
            domain,
            campaignDeskClientId: resolved.id,
        };
    };

    const payloadPeople = new Map<string, Map<string, { date: string; item: ForecastItem }[]>>();
    const previewBuckets = new Map<string, Map<string, Map<string, ForecastRowModel>>>();

    const rowFor = (weekStart: string, userId: string, row: ForecastRowModel) => {
        let weeks = previewBuckets.get(weekStart);
        if (!weeks) {
            weeks = new Map();
            previewBuckets.set(weekStart, weeks);
        }
        let people = weeks.get(userId);
        if (!people) {
            people = new Map();
            weeks.set(userId, people);
        }
        const key = `${row.bucket}\0${row.clientId ?? ''}\0${row.source}\0${row.minutesReason ?? ''}`;
        const existing = people.get(key);
        if (existing && existing.minutes != null && row.minutes != null) {
            existing.minutes += row.minutes;
            return;
        }
        people.set(key, { ...row });
    };

    for (const item of emitted) {
        const weekStart = weekStartFor(item.date);
        const member = members.get(item.userId);
        if (!member) continue;
        const match = matchPerson(normalizeEmail(member.email), input.directory, input.directoryUnavailableReason);
        let client: ForecastItemClient | null = null;
        let clientName = item.bucket === 'internal' ? 'Internal' : item.clientName;
        const sent = match.status === 'mapped';
        if (item.bucket === 'client') {
            if (!item.clientId || !item.clientName) {
                bump('missing_client_names');
                rowFor(weekStart, item.userId, {
                    clientId: item.clientId,
                    clientName: item.clientName,
                    bucket: 'client',
                    source: item.source,
                    minutes: item.minutes,
                    minutesReason: 'Client name is missing',
                    sent: false,
                });
                continue;
            }
            client = toClient(item.clientId, item.clientName, item.clientDomain);
            if (!client) {
                bump('missing_client_names');
                rowFor(weekStart, item.userId, {
                    clientId: item.clientId,
                    clientName: item.clientName,
                    bucket: 'client',
                    source: item.source,
                    minutes: item.minutes,
                    minutesReason: 'Client name is missing',
                    sent: false,
                });
                continue;
            }
            clientName = client.name;
        }
        rowFor(weekStart, item.userId, {
            clientId: item.bucket === 'internal' ? null : item.clientId,
            clientName,
            bucket: item.bucket,
            source: item.source,
            minutes: item.minutes,
            minutesReason: null,
            sent: sent && item.minutes > 0 && (item.bucket === 'internal' || Boolean(client)),
        });
        if (!sent) continue;
        const payloadItem: ForecastItem = {
            itemKey: item.itemKey,
            kind: item.kind,
            bucket: item.bucket,
            client: item.bucket === 'internal' ? null : client,
            title: item.title,
            source: item.source,
            minutes: item.minutes,
            hours: hoursStringFromMinutes(item.minutes),
            startTime: item.startTime,
            sourceIds: {
                taskId: item.taskId,
                timeLogIds: item.timeLogIds.slice(0, MAX_TIME_LOG_IDS),
                plannerEventId: item.plannerEventId,
            },
        };
        let weeks = payloadPeople.get(weekStart);
        if (!weeks) {
            weeks = new Map();
            payloadPeople.set(weekStart, weeks);
        }
        const list = weeks.get(item.userId) ?? [];
        list.push({ date: item.date, item: payloadItem });
        weeks.set(item.userId, list);
    }

    for (const gap of gaps) {
        rowFor(gap.weekStart, gap.userId, {
            clientId: gap.clientId,
            clientName: gap.bucket === 'internal' ? 'Internal' : gap.clientName,
            bucket: gap.bucket,
            source: gap.source,
            minutes: null,
            minutesReason: gap.reason,
            sent: false,
        });
    }

    const weeks: ForecastWeekModel[] = selected.map(weekStart => {
        const basis = forecastBasis(weekStart, input.today);
        const peopleIds = new Set<string>([
            ...previewBuckets.get(weekStart)?.keys() ?? [],
        ]);
        const people = [...peopleIds].flatMap(userId => {
            const member = members.get(userId);
            if (!member) return [];
            const email = normalizeEmail(member.email);
            const match = matchPerson(email, input.directory, input.directoryUnavailableReason);
            const rows = [...(previewBuckets.get(weekStart)?.get(userId)?.values() ?? [])]
                .map(row => ({ ...row, sent: row.sent && match.status === 'mapped' }))
                .sort(compareRows);
            if (rows.length === 0) return [];
            const person: ForecastPersonModel = {
                userId,
                displayName: displayName(member),
                email,
                match,
                rows,
            };
            return [person];
        }).sort((left, right) => left.displayName.localeCompare(right.displayName));
        return { weekStart, basis, people };
    });

    const unmappedPeople = new Set(
        weeks.flatMap(week => week.people)
            .filter(person => person.match.status === 'not_mapped')
            .map(person => person.userId),
    );
    if (unmappedPeople.size > 0) bump('unmapped_people', unmappedPeople.size);
    if (unmatched.size > 0) bump('unmatched_clients', unmatched.size);

    let itemCount = 0;
    const payloadWeeks = selected.map(weekStart => {
        const people = [...(payloadPeople.get(weekStart)?.entries() ?? [])].flatMap(([userId, items]) => {
            const member = members.get(userId);
            if (!member) return [];
            const match = matchPerson(normalizeEmail(member.email), input.directory, input.directoryUnavailableReason);
            if (match.status !== 'mapped') return [];
            const byDate = new Map<string, ForecastItem[]>();
            for (const entry of items) {
                const list = byDate.get(entry.date) ?? [];
                list.push(entry.item);
                byDate.set(entry.date, list);
            }
            const days = [...byDate.entries()]
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([date, dayItems]) => ({
                    date,
                    items: dayItems.sort((left, right) => left.itemKey.localeCompare(right.itemKey)),
                }));
            itemCount += days.reduce((sum, day) => sum + day.items.length, 0);
            return [{
                personEmail: normalizeEmail(member.email),
                campaignDeskPersonId: match.campaignDeskPersonId,
                days,
            }];
        }).sort((left, right) => left.personEmail.localeCompare(right.personEmail));
        return {
            weekStart,
            basis: forecastBasis(weekStart, input.today),
            people,
        };
    });

    if (itemCount > 500) bump('too_many_items');

    return {
        weeks,
        warnings: [...warnings.entries()]
            .filter(([, count]) => count > 0)
            .map(([kind, count]) => ({ kind, count })),
        breakMinutes,
        allDayBreaks,
        oooLeftOut,
        unmatchedClients: unmatched.size,
        itemCount,
        splitEstimates,
        nameMatches,
        payloadVersion: 2,
        payloadBody: {
            version: 2,
            source: FORECAST_SOURCE,
            organizationId: input.organizationId,
            weeks: payloadWeeks,
        },
    };
}

function classifyLog(
    log: ForecastLog,
    event: ForecastEvent | undefined,
    timeZone: string,
    attribution: ProjectClientAttribution | null,
): Omit<Group, 'minutes' | 'timeLogIds' | 'votes'> & {
    clientId: string | null;
    clientName: string | null;
    clientDomain: string | null;
} {
    const clock = actualStartTime(log, event, timeZone);
    const meeting = event?.kind === 'meeting';
    const internalEvent = event?.kind === 'event';
    if (meeting || internalEvent) {
        const eventClientId = uuidOrNull(event?.clientId);
        let clientId = meeting ? eventClientId ?? uuidOrNull(log.clientId) : null;
        let clientName = clientId
            ? (eventClientId && event?.clientName?.trim() ? event.clientName : log.clientName)?.trim() || event?.clientName?.trim() || null
            : null;
        let clientDomain = clientId
            ? cleanDomain(eventClientId ? event?.clientDomain : undefined) ?? cleanDomain(log.clientDomain)
            : null;
        if (!clientId && attribution) {
            clientId = uuidOrNull(attribution.clientId);
            clientName = attribution.clientName.trim() || null;
            clientDomain = cleanDomain(attribution.clientDomain ?? undefined);
        }
        const bucket = clientId ? 'client' as const : 'internal' as const;
        return {
            userId: log.userId,
            date: log.date,
            itemKey: itemKey('event', uuidOrNull(event?.id) ?? event?.id ?? log.id, log.date),
            kind: 'event',
            bucket,
            title: cleanTitle(event?.title, 'Meeting'),
            source: 'actual',
            startTime: clock.time,
            startRank: clock.rank,
            taskId: null,
            plannerEventId: uuidOrNull(event?.id),
            clientId: bucket === 'client' ? clientId : null,
            clientName: bucket === 'client' ? clientName : null,
            clientDomain: bucket === 'client' ? clientDomain : null,
        };
    }
    const taskId = uuidOrNull(log.taskId) ?? uuidOrNull(event?.taskId);
    const clientId = uuidOrNull(log.clientId);
    const bucket = clientId ? 'client' as const : 'internal' as const;
    const id = taskId ?? (clientId ?? 'internal');
    return {
        userId: log.userId,
        date: log.date,
        itemKey: itemKey('task', id, log.date),
        kind: 'task',
        bucket,
        title: cleanTitle(log.taskTitle || event?.taskTitle || log.description, 'Tracked time'),
        source: 'actual',
        startTime: clock.time,
        startRank: clock.rank,
        taskId,
        plannerEventId: null,
        clientId: bucket === 'client' ? clientId : null,
        clientName: bucket === 'client' ? log.clientName?.trim() || null : null,
        clientDomain: bucket === 'client' ? cleanDomain(log.clientDomain) : null,
    };
}

function finalizeGroup(
    group: Group,
    bump: (kind: ForecastWarningKind, amount?: number) => void,
): (Group & { clientId: string | null; clientName: string | null; clientDomain: string | null }) | null {
    let minutes = group.minutes;
    if (minutes > MAX_MINUTES) {
        bump('over_day');
        minutes = MAX_MINUTES;
    }
    if (minutes < 1) return null;
    if (group.timeLogIds.length > MAX_TIME_LOG_IDS) bump('truncated_time_logs');
    const timeLogIds = [...group.timeLogIds].sort().slice(0, MAX_TIME_LOG_IDS);
    let clientId: string | null = null;
    let clientName: string | null = null;
    let clientDomain: string | null = null;
    if (group.bucket === 'client') {
        const ranked = [...group.votes.entries()].sort((left, right) =>
            right[1].minutes - left[1].minutes || left[0].localeCompare(right[0]));
        const winner = ranked[0];
        if (winner && winner[0]) {
            clientId = winner[0];
            clientName = winner[1].name;
            clientDomain = winner[1].domain;
        }
    }
    return { ...group, minutes, timeLogIds, clientId, clientName, clientDomain };
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
