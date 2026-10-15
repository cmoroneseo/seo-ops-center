import { randomUUID } from 'node:crypto';

import { weekStartFor } from '../timesheets/ledger.ts';
import {
    buildForecast,
    matchPerson,
    type ForecastDeskPerson,
    type ForecastEvent,
    type ForecastLog,
    type ForecastMember,
    type ForecastTask,
} from './build.ts';
import { createCampaignDeskClient, CampaignDeskRequestError, type CampaignDeskClient } from './client.ts';
import {
    forecastPayloadHash,
    normalizeEmail,
    parseForecastPayload,
    type ForecastPayload,
    type ForecastPayloadBody,
} from './contract.ts';
import type { ForecastReadiness } from './flags.ts';
import { forecastStatusLabel, formatLastSynced, forecastWeekChip, presentForecast } from './present.ts';
import { coveringRun, latestRun, linesForPerson, memberForecastStatus } from './status.ts';
import { ForecastStoreUnavailable, type ForecastRunStore, type ForecastSyncRunRecord } from './store.ts';
import { assertTimeZone, loadWindow, parseSelectableWeeks, resolveClientToday, selectableWeekStarts } from './weeks.ts';

export interface ForecastAdminAuth {
    ok: true;
    userId: string;
    actorName: string;
    organizationId: string;
    role: 'owner' | 'admin';
}

export interface ForecastAuthFailure {
    ok: false;
    status: number;
    error: string;
}

export interface ForecastSourceData {
    members: ForecastMember[];
    logs: ForecastLog[];
    events: ForecastEvent[];
    tasks: ForecastTask[];
}

export interface ForecastHttpDependencies {
    now(): Date;
    authorize(organizationId: string): Promise<ForecastAdminAuth | ForecastAuthFailure>;
    load(scope: { organizationId: string; from: string; to: string }): Promise<ForecastSourceData>;
    readiness(organizationId: string): ForecastReadiness;
    listPeople(): Promise<ForecastDeskPerson[]>;
    store: ForecastRunStore;
    client: CampaignDeskClient;
    newRunId(): string;
}

const DIRECTORY_ERROR = 'Campaign Desk people could not be loaded.';

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function failure(result: ForecastAuthFailure): Response {
    return json({ error: result.error }, result.status);
}

async function authorize(deps: ForecastHttpDependencies, organizationId: string) {
    if (!organizationId.trim()) return { error: json({ error: 'Missing organizationId' }, 400) };
    const auth = await deps.authorize(organizationId.trim());
    if (!auth.ok) return { error: failure(auth) };
    return { auth };
}

function readToday(raw: string | null, now: Date) {
    const today = resolveClientToday(raw, now);
    if (typeof today !== 'string') return { error: json({ error: today.error }, 400) };
    return { today };
}

function readZone(raw: string | null) {
    const timeZone = assertTimeZone(raw ?? '');
    if (!timeZone) return { error: json({ error: 'timeZone is not a valid IANA time zone' }, 400) };
    return { timeZone };
}

export function createForecastPreviewGet(deps: ForecastHttpDependencies) {
    return async function getForecastPreview(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const gate = await authorize(deps, params.get('organizationId') ?? '');
        if ('error' in gate && gate.error) return gate.error;
        const todayResult = readToday(params.get('today'), deps.now());
        if ('error' in todayResult && todayResult.error) return todayResult.error;
        const zone = readZone(params.get('timeZone'));
        if ('error' in zone && zone.error) return zone.error;
        const requested = (params.get('weeks') ?? '').split(',').map(part => part.trim()).filter(Boolean);
        const weeks = parseSelectableWeeks(
            todayResult.today,
            requested.length > 0 ? requested : [selectableWeekStarts(todayResult.today)[0]],
        );
        if (!Array.isArray(weeks)) return json({ error: weeks.error }, 400);

        const { auth } = gate as { auth: ForecastAdminAuth };
        return json(await previewPayload(deps, auth.organizationId, todayResult.today, zone.timeZone, weeks));
    };
}

export function createForecastStatusGet(deps: ForecastHttpDependencies) {
    return async function getForecastStatus(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const gate = await authorize(deps, params.get('organizationId') ?? '');
        if ('error' in gate && gate.error) return gate.error;
        const todayResult = readToday(params.get('today'), deps.now());
        if ('error' in todayResult && todayResult.error) return todayResult.error;
        const zone = readZone(params.get('timeZone'));
        if ('error' in zone && zone.error) return zone.error;
        const requestedWeek = params.get('weekStart')?.trim() || todayResult.today;
        let weekStart = '';
        try {
            weekStart = weekStartFor(requestedWeek);
        } catch {
            return json({ error: 'weekStart must be a yyyy-MM-dd date' }, 400);
        }

        const { auth } = gate as { auth: ForecastAdminAuth };
        let runs: ForecastSyncRunRecord[] = [];
        try {
            runs = await deps.store.listSucceeded(auth.organizationId);
        } catch (error) {
            if (error instanceof ForecastStoreUnavailable) {
                return json({
                    available: false,
                    lastSyncedLabel: '—',
                    lastSyncedReason: 'Forecast sync storage is not set up.',
                    members: [],
                });
            }
            throw error;
        }

        const connection = deps.readiness(auth.organizationId);
        const directory = await loadDirectory(deps, connection);
        const source = await deps.load({
            organizationId: auth.organizationId,
            ...loadWindow([weekStart]),
        });
        const built = buildForecast({
            organizationId: auth.organizationId,
            today: todayResult.today,
            timeZone: zone.timeZone,
            selectedWeekStarts: [weekStart],
            ...source,
            directory: directory.people,
            directoryUnavailableReason: directory.error ?? connection.reason ?? undefined,
        });
        const covered = coveringRun(runs.map(toStatusRun), weekStart);
        const latest = latestRun(runs.map(toStatusRun));
        const synced = latest
            ? formatLastSynced(latest.createdAt, latest.createdByName, zone.timeZone)
            : { label: 'Not synced yet', reason: null };

        return json({
            available: true,
            lastSyncedLabel: synced.label,
            lastSyncedReason: synced.reason,
            members: statusMembers(source.members, built, directory, connection, covered, weekStart),
        });
    };
}

function statusMembers(
    members: ForecastMember[],
    built: ReturnType<typeof buildForecast>,
    directory: DirectoryLoad,
    connection: ForecastReadiness,
    covered: ReturnType<typeof coveringRun>,
    weekStart: string,
) {
    const weekLines = built.payloadBody.weeks.find(week => week.weekStart === weekStart)?.allocations ?? [];
    return members.map(member => {
        const email = normalizeEmail(member.email);
        const match = matchPerson(
            email,
            directory.people,
            directory.error ?? connection.reason ?? 'Campaign Desk is not connected',
        );
        const status = memberForecastStatus({
            match,
            coveringRun: covered,
            previousLines: covered ? linesForPerson(covered.payload, weekStart, email) : [],
            currentLines: weekLines.filter(line => line.personEmail === email),
            connectionEnabled: connection.enabled && !directory.error,
        });
        return {
            userId: member.userId,
            label: forecastStatusLabel(status.status),
            reason: status.reason,
            tone: status.status,
        };
    });
}

interface DirectoryLoad {
    people: ForecastDeskPerson[] | null;
    error: string | null;
}

async function loadDirectory(
    deps: ForecastHttpDependencies,
    connection: ForecastReadiness,
): Promise<DirectoryLoad> {
    if (!connection.enabled) return { people: null, error: null };
    try {
        return { people: await deps.listPeople(), error: null };
    } catch (error) {
        if (error instanceof CampaignDeskRequestError) return { people: null, error: DIRECTORY_ERROR };
        throw error;
    }
}

async function previewPayload(
    deps: ForecastHttpDependencies,
    organizationId: string,
    today: string,
    timeZone: string,
    weeks: string[],
) {
    const connection = deps.readiness(organizationId);
    const directory = await loadDirectory(deps, connection);
    const source = await deps.load({ organizationId, ...loadWindow(weeks) });
    const built = buildForecast({
        organizationId,
        today,
        timeZone,
        selectedWeekStarts: weeks,
        ...source,
        directory: directory.people,
        directoryUnavailableReason: directory.error ?? connection.reason ?? undefined,
    });
    const allowed = selectableWeekStarts(today);
    return {
        connection,
        selectableWeeks: allowed.map(weekStart => ({
            weekStart,
            label: forecastWeekChip(weekStart, today),
            selected: weeks.includes(weekStart),
        })),
        preview: presentForecast(built, connection, directory.error),
    };
}

export function createForecastSyncPost(deps: ForecastHttpDependencies) {
    return async function postForecastSync(request: Request): Promise<Response> {
        const body = await readJson(request);
        if (!body) return json({ error: 'Invalid JSON' }, 400);
        const gate = await authorize(deps, stringField(body.organizationId));
        if ('error' in gate && gate.error) return gate.error;
        const todayResult = readToday(stringField(body.today) || null, deps.now());
        if ('error' in todayResult && todayResult.error) return todayResult.error;
        const zone = readZone(stringField(body.timeZone) || null);
        if ('error' in zone && zone.error) return zone.error;
        const requested = Array.isArray(body.weekStarts) ? body.weekStarts.filter((week): week is string => typeof week === 'string') : [];
        const weeks = parseSelectableWeeks(todayResult.today, requested);
        if (!Array.isArray(weeks)) return json({ error: weeks.error }, 400);

        const { auth } = gate as { auth: ForecastAdminAuth };
        const connection = deps.readiness(auth.organizationId);
        if (!connection.enabled) return json({ error: connection.reason }, 409);

        let directory: ForecastDeskPerson[];
        try {
            directory = await deps.listPeople();
        } catch (error) {
            if (error instanceof CampaignDeskRequestError) return json({ error: DIRECTORY_ERROR }, 502);
            throw error;
        }

        const source = await deps.load({ organizationId: auth.organizationId, ...loadWindow(weeks) });
        const built = buildForecast({
            organizationId: auth.organizationId,
            today: todayResult.today,
            timeZone: zone.timeZone,
            selectedWeekStarts: weeks,
            ...source,
            directory,
        });
        const payloadBody: ForecastPayloadBody = built.payloadBody;
        const payloadHash = forecastPayloadHash(payloadBody);

        let existing: ForecastSyncRunRecord | null = null;
        try {
            existing = await deps.store.findSucceededByHash(auth.organizationId, payloadHash);
        } catch (error) {
            if (error instanceof ForecastStoreUnavailable) {
                return json({ error: 'Forecast sync storage is not set up.' }, 503);
            }
            throw error;
        }
        if (existing) return json(syncResult(existing, true));

        const runId = deps.newRunId();
        const payload: ForecastPayload = parseForecastPayload({ ...payloadBody, runId });
        let upsert: { runId: string; idempotent: boolean };
        try {
            upsert = await deps.client.upsertRun(payload);
        } catch (error) {
            if (error instanceof CampaignDeskRequestError) return json({ error: error.message }, 502);
            throw error;
        }

        const record: ForecastSyncRunRecord = {
            id: runId,
            organizationId: auth.organizationId,
            createdBy: auth.userId,
            createdByName: auth.actorName.trim() || 'A teammate',
            createdAt: deps.now().toISOString(),
            weekStarts: weeks,
            payloadHash,
            payload,
            status: 'succeeded',
            externalId: upsert.runId,
            undoneAt: null,
            undoneBy: null,
        };
        try {
            const inserted = await deps.store.insertSucceeded(record);
            if (!inserted.ok) {
                const winner = await deps.store.findSucceededByHash(auth.organizationId, payloadHash);
                if (winner && winner.id !== runId) {
                    try {
                        await deps.client.deleteRun(runId);
                    } catch (error) {
                        if (!(error instanceof CampaignDeskRequestError)) throw error;
                    }
                }
                if (winner) return json(syncResult(winner, true));
                return json({ error: 'The sync was sent but could not be recorded. Undo it in Campaign Desk before trying again.' }, 500);
            }
            return json(syncResult(inserted.run, false));
        } catch (error) {
            if (error instanceof ForecastStoreUnavailable) {
                try {
                    await deps.client.deleteRun(runId);
                } catch (undoError) {
                    if (!(undoError instanceof CampaignDeskRequestError)) throw undoError;
                }
                return json({ error: 'Forecast sync storage is not set up.' }, 503);
            }
            throw error;
        }
    };
}

function syncResult(run: ForecastSyncRunRecord, idempotent: boolean) {
    return {
        ok: true,
        runId: run.id,
        idempotent,
        weekCount: run.weekStarts.length,
        syncedAt: run.createdAt,
        syncedBy: run.createdByName,
    };
}

export function createForecastUndoPost(deps: ForecastHttpDependencies) {
    return async function postForecastUndo(request: Request): Promise<Response> {
        const body = await readJson(request);
        if (!body) return json({ error: 'Invalid JSON' }, 400);
        const gate = await authorize(deps, stringField(body.organizationId));
        if ('error' in gate && gate.error) return gate.error;
        const runId = stringField(body.runId);
        if (!runId) return json({ error: 'Missing runId' }, 400);
        const { auth } = gate as { auth: ForecastAdminAuth };
        const connection = deps.readiness(auth.organizationId);
        if (!connection.enabled) return json({ error: connection.reason }, 409);

        let runs: ForecastSyncRunRecord[];
        try {
            runs = await deps.store.listSucceeded(auth.organizationId);
        } catch (error) {
            if (error instanceof ForecastStoreUnavailable) {
                return json({ error: 'Forecast sync storage is not set up.' }, 503);
            }
            throw error;
        }
        const ordered = [...runs].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        const target = ordered.find(run => run.id === runId);
        const newest = ordered[0];
        if (!target || !newest) return json({ error: 'Sync run not found.' }, 404);
        if (newest.id !== target.id) return json({ error: 'Only the latest sync can be undone.' }, 409);

        try {
            await deps.client.deleteRun(target.externalId || target.id);
        } catch (error) {
            if (error instanceof CampaignDeskRequestError && error.code === 'run_not_found') {
                // Already gone on their side. The local row still needs to close.
            } else if (error instanceof CampaignDeskRequestError) {
                return json({ error: error.message }, 502);
            } else {
                throw error;
            }
        }

        const marked = await deps.store.markUndone(
            auth.organizationId,
            target.id,
            auth.userId,
            deps.now().toISOString(),
        );
        if (marked === 'missing') return json({ error: 'Sync run not found.' }, 404);
        return json({ ok: true, runId: target.id, alreadyUndone: marked === 'already_undone' });
    };
}

function toStatusRun(run: ForecastSyncRunRecord) {
    return {
        id: run.id,
        createdAt: run.createdAt,
        createdByName: run.createdByName,
        weekStarts: run.weekStarts,
        payload: run.payload,
    };
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
    try {
        const body = await request.json() as unknown;
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        return body as Record<string, unknown>;
    } catch {
        return null;
    }
}

function stringField(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function defaultForecastDependencies(
    overrides: Omit<ForecastHttpDependencies, 'newRunId'> & { newRunId?: () => string },
): ForecastHttpDependencies {
    return { newRunId: randomUUID, ...overrides };
}

/** Exposed for the app wire. Tests build dependencies directly. */
export function campaignDeskClientFrom(baseUrl: string, token: string): CampaignDeskClient {
    return createCampaignDeskClient({ baseUrl, token });
}
