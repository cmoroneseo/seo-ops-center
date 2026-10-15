import { randomUUID } from 'node:crypto';

import { weekStartFor } from '../timesheets/ledger.ts';
import {
    buildForecast,
    matchPerson,
    type ForecastBuildInput,
    type ForecastBuildResult,
    type ForecastDeskPerson,
    type ForecastEvent,
    type ForecastLog,
    type ForecastMember,
    type ForecastTask,
} from './build.ts';
import { createCampaignDeskClient, CampaignDeskRequestError, type CampaignDeskClient } from './client.ts';
import type { ForecastClientLink, ForecastDeskClient, ForecastSeoClient } from './clients.ts';
import {
    forecastPayloadHash,
    ForecastPayloadError,
    normalizeEmail,
} from './contract.ts';
import { parseStoredForecastPayload } from './contract-v2.ts';
import type { ForecastReadiness } from './flags.ts';
import { EMPTY_FORECAST_SYNC_REASON, forecastSendableCount, forecastStatusLabel, formatLastSynced, forecastWeekChip, presentForecast } from './present.ts';
import { coveringRun, latestRun, memberForecastStatus, personForecastDigest } from './status.ts';
import { ForecastClientMapUnavailable, ForecastStoreUnavailable, type ForecastRunStore, type ForecastSyncRunRecord } from './store.ts';
import type { ForecastBasecampProject } from './basecamp-project.ts';
import { buildForecastV2, type ForecastV2BuildResult } from './v2.ts';
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
    basecampProjects?: ForecastBasecampProject[];
    seoClients?: ForecastSeoClient[];
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
    /** 2 only when CAMPAIGN_DESK_SYNC_V2 is exactly true. */
    payloadVersion(): 1 | 2;
    listClients(): Promise<ForecastDeskClient[]>;
    loadClientLinks(organizationId: string): Promise<ForecastClientLink[]>;
    rememberNameMatches(
        organizationId: string,
        updatedBy: string,
        matches: { clientId: string; campaignDeskClientId: string }[],
    ): Promise<void>;
}

type BuiltForecast = ForecastBuildResult | ForecastV2BuildResult;

function directoryReason(error: CampaignDeskRequestError): string {
    if (error.status === 0) return 'unreachable';
    if (error.status === 401 || error.code === 'unauthorized') return 'unauthorized';
    if (error.code === 'invalid_payload' || error.code === 'unreadable') return 'invalid response';
    if (error.status > 0) return String(error.status);
    return 'unavailable';
}

function peopleDirectoryMessage(error: CampaignDeskRequestError): string {
    return `Campaign Desk people could not be loaded (${directoryReason(error)}).`;
}

function envSpan(name: string): { present: boolean; length: number } {
    const raw = process.env[name];
    if (typeof raw !== 'string' || raw.length === 0) return { present: false, length: 0 };
    return { present: true, length: raw.length };
}

function redactSecret(value: string | null): string | null {
    if (!value) return value;
    const raw = process.env.CAMPAIGN_DESK_API_TOKEN;
    const secret = typeof raw === 'string' ? raw.trim() : '';
    return secret ? value.split(secret).join('[redacted]') : value;
}

/** One JSON line for Vercel. Lengths only — never the URL or the bearer value. */
function logDirectoryFailure(error: CampaignDeskRequestError): void {
    const baseUrl = envSpan('CAMPAIGN_DESK_API_BASE_URL');
    const bearer = envSpan('CAMPAIGN_DESK_API_TOKEN');
    const line = JSON.stringify({
        event: 'campaign_desk_request_failed',
        path: error.path || '/v1/people',
        status: error.status,
        code: error.code,
        fetchErrorName: error.fetchErrorName,
        fetchErrorMessage: redactSecret(error.fetchErrorMessage),
        baseUrlPresent: baseUrl.present,
        baseUrlLength: baseUrl.length,
        tokenPresent: bearer.present,
        tokenLength: bearer.length,
    });
    console.warn(line);
}

function directoryFailure(error: unknown): string | null {
    if (!(error instanceof CampaignDeskRequestError)) return null;
    logDirectoryFailure(error);
    return peopleDirectoryMessage(error);
}

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
        const { built } = await buildChosen(deps, {
            organizationId: auth.organizationId,
            today: todayResult.today,
            timeZone: zone.timeZone,
            selectedWeekStarts: [weekStart],
            ...source,
            directory: directory.people,
            directoryUnavailableReason: directory.error ?? connection.reason ?? undefined,
            connectionEnabled: connection.enabled,
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
    built: BuiltForecast,
    directory: DirectoryLoad,
    connection: ForecastReadiness,
    covered: ReturnType<typeof coveringRun>,
    weekStart: string,
) {
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
            previousLines: [],
            currentLines: [],
            previousDigest: covered ? personForecastDigest(covered.payload, weekStart, email) : undefined,
            currentDigest: personForecastDigest(built.payloadBody, weekStart, email),
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
        const message = directoryFailure(error);
        if (message) return { people: null, error: message };
        throw error;
    }
}

async function loadClientLinks(deps: ForecastHttpDependencies, organizationId: string) {
    try {
        const links = await deps.loadClientLinks(organizationId);
        return new Map(links.map(link => [link.clientId.toLowerCase(), link.campaignDeskClientId]));
    } catch (error) {
        if (error instanceof ForecastClientMapUnavailable) return new Map<string, string>();
        throw error;
    }
}

async function loadDeskClients(
    deps: ForecastHttpDependencies,
): Promise<{ clients: ForecastDeskClient[] | null; error: string | null }> {
    try {
        return { clients: await deps.listClients(), error: null };
    } catch (error) {
        if (!(error instanceof CampaignDeskRequestError)) throw error;
        logDirectoryFailure(error);
        return { clients: null, error: `Campaign Desk clients could not be loaded (${directoryReason(error)}).` };
    }
}

async function buildChosen(
    deps: ForecastHttpDependencies,
    input: ForecastBuildInput & {
        connectionEnabled: boolean;
        basecampProjects?: ForecastBasecampProject[];
        seoClients?: ForecastSeoClient[];
    },
): Promise<{ built: BuiltForecast; clientsError: string | null }> {
    const { connectionEnabled, basecampProjects = [], seoClients = [], ...rest } = input;
    if (deps.payloadVersion() !== 2) {
        return { built: buildForecast(rest), clientsError: null };
    }
    const clientLinks = await loadClientLinks(deps, input.organizationId);
    const desk = connectionEnabled
        ? await loadDeskClients(deps)
        : { clients: null, error: null };
    return {
        built: buildForecastV2({
            ...rest,
            clientLinks,
            deskClients: desk.clients,
            basecampProjects,
            seoClients,
        }),
        clientsError: desk.error,
    };
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
    const { built, clientsError } = await buildChosen(deps, {
        organizationId,
        today,
        timeZone,
        selectedWeekStarts: weeks,
        ...source,
        directory: directory.people,
        directoryUnavailableReason: directory.error ?? connection.reason ?? undefined,
        connectionEnabled: connection.enabled,
    });
    const allowed = selectableWeekStarts(today);
    const preview = presentForecast(built, connection, directory.error);
    if (clientsError) preview.warnings.push({ message: clientsError });
    return {
        connection,
        selectableWeeks: allowed.map(weekStart => ({
            weekStart,
            label: forecastWeekChip(weekStart, today),
            selected: weeks.includes(weekStart),
        })),
        preview,
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
            const message = directoryFailure(error);
            if (message) return json({ error: message }, 502);
            throw error;
        }

        const source = await deps.load({ organizationId: auth.organizationId, ...loadWindow(weeks) });
        const { built } = await buildChosen(deps, {
            organizationId: auth.organizationId,
            today: todayResult.today,
            timeZone: zone.timeZone,
            selectedWeekStarts: weeks,
            ...source,
            directory,
            connectionEnabled: true,
        });
        if ((built.itemCount ?? 0) > 500) {
            return json({ error: 'This sync has more than 500 items. Choose fewer weeks.' }, 422);
        }
        if (forecastSendableCount(built) === 0) {
            return json({ error: EMPTY_FORECAST_SYNC_REASON }, 422);
        }
        if ('nameMatches' in built && built.nameMatches.length > 0) {
            try {
                await deps.rememberNameMatches(auth.organizationId, auth.userId, built.nameMatches);
            } catch (error) {
                if (!(error instanceof ForecastClientMapUnavailable)) {
                    console.warn(JSON.stringify({ event: 'campaign_desk_client_map_write_failed' }));
                }
            }
        }
        const payloadBody = built.payloadBody;
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
        let payload;
        try {
            payload = parseStoredForecastPayload({ ...payloadBody, runId });
        } catch (error) {
            if (error instanceof ForecastPayloadError) {
                return json({ error: 'The forecast body is not valid to send.' }, 500);
            }
            throw error;
        }
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
