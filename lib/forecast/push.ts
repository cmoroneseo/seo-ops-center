import { campaignDeskHybridWeek } from './flags.ts';
import { executeForecastSync, type ForecastHttpDependencies, type ForecastSyncCommand } from './http.ts';
import { forecastPushWindow } from './nudge.ts';
import { resolveClientToday, assertTimeZone } from './weeks.ts';

/** Wait this long so a burst of edits becomes one Campaign Desk call per week. */
export const FORECAST_PUSH_DELAY_MS = 3000;

export interface ForecastPushTarget {
    organizationId: string;
    weekStart: string;
    timeZone: string;
    today: string;
    userId: string;
    actorName: string;
    now?: string;
    /**
     * Set only by a server hook that just deleted the work. A request to
     * /api/forecast/push cannot turn this on.
     */
    allowEmpty?: boolean;
}

export interface ForecastPushTimer {
    cancel(): void;
}

export interface ForecastPushScheduler {
    schedule(target: ForecastPushTarget): void;
}

/**
 * One timer per organization and week. A newer request cancels the previous
 * one, so only the last edit in the burst is sent.
 */
export function createForecastPushScheduler(options: {
    delayMs: number;
    schedule(delayMs: number, run: () => void): ForecastPushTimer;
    push(target: ForecastPushTarget): Promise<void>;
    onError?(error: unknown, target: ForecastPushTarget): void;
}): ForecastPushScheduler {
    const pending = new Map<string, { generation: number; timer: ForecastPushTimer }>();
    return {
        schedule(target) {
            const key = `${target.organizationId}\0${target.weekStart}`;
            const previous = pending.get(key);
            previous?.timer.cancel();
            const generation = (previous?.generation ?? 0) + 1;
            const timer = options.schedule(options.delayMs, () => {
                const current = pending.get(key);
                if (!current || current.generation !== generation) return;
                pending.delete(key);
                void Promise.resolve()
                    .then(() => options.push(target))
                    .catch(error => options.onError?.(error, target));
            });
            pending.set(key, { generation, timer });
        },
    };
}

/** Send one week. A Campaign Desk failure is logged and does not throw. */
export async function runForecastPush(
    deps: ForecastHttpDependencies,
    target: ForecastPushTarget,
    isStale?: () => boolean,
): Promise<void> {
    try {
        const command: ForecastSyncCommand = {
            organizationId: target.organizationId,
            userId: target.userId,
            actorName: target.actorName,
            today: target.today,
            timeZone: target.timeZone,
            weekStarts: [target.weekStart],
            allowEmpty: target.allowEmpty === true && (deps.hybridWeek?.() ?? campaignDeskHybridWeek()),
            now: target.now,
            isStale,
        };
        const outcome = await executeForecastSync(deps, command);
        if (!outcome.ok && outcome.status !== 409) {
            console.warn(JSON.stringify({
                event: 'campaign_desk_request_failed',
                path: '/v1/forecast-runs',
                status: outcome.status,
                message: outcome.error,
            }));
        }
    } catch {
        console.warn(JSON.stringify({
            event: 'campaign_desk_request_failed',
            path: '/v1/forecast-runs',
            status: 0,
            message: 'Campaign Desk could not complete the sync.',
        }));
    }
}

export interface ForecastPushAuth {
    ok: true;
    userId: string;
    actorName: string;
    organizationId: string;
}

export interface ForecastPushAuthFailure {
    ok: false;
    status: number;
    error: string;
}

/** Viewers can look, not send. Owners, admins, and members can. */
export function forecastPushViewerRejection(
    role: 'owner' | 'admin' | 'member' | 'viewer',
): ForecastPushAuthFailure | null {
    if (role !== 'viewer') return null;
    return { ok: false, status: 403, error: 'Forbidden' };
}

export interface ForecastPushPostDependencies {
    now(): Date;
    authorize(organizationId: string): Promise<ForecastPushAuth | ForecastPushAuthFailure>;
    schedule(target: ForecastPushTarget): void;
}

/** Accept a nudge and schedule the send. The response does not wait for Campaign Desk. */
export function createForecastPushPost(deps: ForecastPushPostDependencies) {
    return async function postForecastPush(request: Request): Promise<Response> {
        const body = await readJson(request);
        if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        const gate = await deps.authorize(stringField(body.organizationId));
        if (!gate.ok) return Response.json({ error: gate.error }, { status: gate.status });
        const now = deps.now();
        const todayResult = resolveClientToday(stringField(body.today) || null, now);
        if (typeof todayResult !== 'string') {
            return Response.json({ error: todayResult.error }, { status: 400 });
        }
        const timeZone = assertTimeZone(stringField(body.timeZone));
        if (!timeZone) return Response.json({ error: 'timeZone is not a valid IANA time zone' }, { status: 400 });
        const requested = Array.isArray(body.weekStarts)
            ? body.weekStarts.filter((week): week is string => typeof week === 'string')
            : [];
        let allowed = new Set<string>();
        try {
            allowed = new Set(forecastPushWindow(todayResult));
        } catch {
            allowed = new Set();
        }
        const weeks = [...new Set(requested.map(week => week.trim()))].filter(week => allowed.has(week)).sort();
        for (const weekStart of weeks) {
            try {
                deps.schedule({
                    organizationId: gate.organizationId,
                    weekStart,
                    timeZone,
                    today: todayResult,
                    userId: gate.userId,
                    actorName: gate.actorName,
                    now: now.toISOString(),
                });
            } catch {
                console.warn(JSON.stringify({
                    event: 'campaign_desk_request_failed',
                    path: '/v1/forecast-runs',
                    status: 0,
                    message: 'Campaign Desk could not complete the sync.',
                }));
            }
        }
        return Response.json({ ok: true }, { status: 202 });
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
