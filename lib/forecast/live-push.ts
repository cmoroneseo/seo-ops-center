import { after } from 'next/server';

import { campaignDeskReady } from './flags.ts';
import { forecastWeeksForInstants } from './nudge.ts';
import { FORECAST_PUSH_DELAY_MS, runForecastPush, type ForecastPushTarget } from './push.ts';
import { forecastHttpDependencies } from './wire.ts';

const generation = new Map<string, number>();

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}

function pushKey(target: ForecastPushTarget): string {
    return `${target.organizationId}\0${target.weekStart}`;
}

function logPushFailure(): void {
    console.warn(JSON.stringify({
        event: 'campaign_desk_request_failed',
        path: '/v1/forecast-runs',
        status: 0,
        message: 'Campaign Desk could not complete the sync.',
    }));
}

/**
 * Coalesce edits for one organization and week, then send after the response.
 * A newer edit replaces the pending one. Campaign Desk is not called while
 * the feature flags are off.
 */
export function scheduleLiveForecastPush(target: ForecastPushTarget): void {
    try {
        if (!campaignDeskReady(target.organizationId).enabled) return;
        const key = pushKey(target);
        const ticket = (generation.get(key) ?? 0) + 1;
        generation.set(key, ticket);
        after(async () => {
            try {
                await sleep(FORECAST_PUSH_DELAY_MS);
                if (generation.get(key) !== ticket) return;
                await runForecastPush(forecastHttpDependencies(), {
                    ...target,
                    now: target.now ?? new Date().toISOString(),
                }, () => generation.get(key) !== ticket);
                if (generation.get(key) === ticket) generation.delete(key);
            } catch {
                logPushFailure();
            }
        });
    } catch {
        logPushFailure();
    }
}

/**
 * Look up the week after the response, then wait and send.
 * Used when the week is not known until a row is read.
 */
export function scheduleLiveForecastPushResolved(resolve: () => Promise<ForecastPushTarget[]>): void {
    try {
        after(async () => {
        try {
            const targets = await resolve();
            for (const target of targets) {
                if (!campaignDeskReady(target.organizationId).enabled) continue;
                const key = pushKey(target);
                const ticket = (generation.get(key) ?? 0) + 1;
                generation.set(key, ticket);
                await sleep(FORECAST_PUSH_DELAY_MS);
                if (generation.get(key) !== ticket) continue;
                await runForecastPush(forecastHttpDependencies(), {
                    ...target,
                    now: target.now ?? new Date().toISOString(),
                }, () => generation.get(key) !== ticket);
                if (generation.get(key) === ticket) generation.delete(key);
            }
        } catch {
            logPushFailure();
        }
        });
    } catch {
        logPushFailure();
    }
}

/** Resolve calendar weeks, then schedule one push per week. */
export function scheduleLiveForecastPushFromDates(input: {
    organizationId: string;
    userId: string;
    actorName: string;
    timeZone: string;
    today: string;
    dates: readonly (string | null | undefined)[];
    now?: string;
}): void {
    try {
        if (!campaignDeskReady(input.organizationId).enabled) return;
        const weeks = forecastWeeksForInstants(input.today, input.timeZone, input.dates);
        for (const weekStart of weeks) {
            scheduleLiveForecastPush({
                organizationId: input.organizationId,
                weekStart,
                timeZone: input.timeZone,
                today: input.today,
                userId: input.userId,
                actorName: input.actorName,
                now: input.now,
            });
        }
    } catch {
        logPushFailure();
    }
}
