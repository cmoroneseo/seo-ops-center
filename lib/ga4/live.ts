import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';
import { Ga4KeyEventsError, readGa4KeyEvents } from './key-events';
import { enqueueGa4Continuation } from './queue';
import { Ga4AuthError, runGa4Cron, runGa4QueueMessage, type Ga4ReadResult, type Ga4RunDeps } from './run';
import { createGa4Store } from './store';
import { eventNameFilter, ga4ReportBody, organicChannelFilter, readPropertyQuota, strictestQuota } from './sync';

function failStatus(status: number): number {
    return status === 401 || status === 403 || status === 429 ? status : 500;
}

async function postReport(token: string, propertyId: string, body: unknown): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
        response = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000),
        });
    } catch {
        console.error('GA4 runReport request failed', { status: 0 });
        return { status: 500, body: null };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) console.error('GA4 runReport request failed', { status: response.status });
    return { status: response.status, body: payload };
}

function liveDeps(): Ga4RunDeps {
    const admin = createAdminClient();
    return {
        env: process.env,
        now: () => new Date(),
        newRunId: () => crypto.randomUUID(),
        store: createGa4Store(admin as unknown as Parameters<typeof createGa4Store>[0]),
        publish: enqueueGa4Continuation,
        async getToken(clientId) {
            try {
                const auth = await getGoogleAccessToken(clientId, 'ga4');
                if (!auth) return null;
                return { token: auth.token };
            } catch (error) {
                if (error instanceof GoogleAuthError) throw new Ga4AuthError(error.message, error.kind);
                throw error;
            }
        },
        async listKeyEvents(token, propertyId) {
            try {
                const events = await readGa4KeyEvents(token, propertyId);
                return events.map(event => event.eventName);
            } catch (error) {
                if (error instanceof Ga4KeyEventsError && (error.status === 401 || error.status === 403)) {
                    throw new Ga4AuthError('GA4 authorization was rejected', 'reauth_required');
                }
                throw error;
            }
        },
        async readRange({ token, propertyId, start, end, keyEvents }): Promise<Ga4ReadResult> {
            const requests: Array<{ key: 'totals' | 'organic' | 'events' | 'landing'; body: unknown }> = [
                {
                    key: 'totals',
                    body: ga4ReportBody({
                        start, end,
                        metrics: ['sessions', 'engagedSessions', 'engagementRate', 'keyEvents'],
                        dimensions: ['date'],
                    }),
                },
                {
                    key: 'organic',
                    body: ga4ReportBody({
                        start, end,
                        metrics: ['sessions', 'engagedSessions', 'keyEvents'],
                        dimensions: ['date'],
                        dimensionFilter: organicChannelFilter(),
                    }),
                },
                {
                    key: 'landing',
                    body: ga4ReportBody({
                        start, end,
                        metrics: ['sessions', 'engagedSessions', 'keyEvents'],
                        dimensions: ['date', 'landingPagePlusQueryString'],
                        dimensionFilter: organicChannelFilter(),
                    }),
                },
            ];
            if (keyEvents && keyEvents.length > 0) {
                requests.push({
                    key: 'events',
                    body: ga4ReportBody({
                        start, end,
                        metrics: ['keyEvents'],
                        dimensions: ['date', 'eventName'],
                        dimensionFilter: eventNameFilter(keyEvents),
                    }),
                });
            }
            const reports: { totals: unknown; organic: unknown; events: unknown; landing: unknown } = {
                totals: { rows: [] },
                organic: { rows: [] },
                events: { rows: [] },
                landing: { rows: [] },
            };
            const bodies: unknown[] = [];
            for (const request of requests) {
                const response = await postReport(token, propertyId, request.body);
                bodies.push(response.body);
                if (!response.status || response.status >= 400) {
                    return { ok: false, status: failStatus(response.status), quota: readPropertyQuota(response.body) };
                }
                reports[request.key] = response.body;
            }
            return { ok: true, reports, quota: strictestQuota(bodies) };
        },
    };
}

export async function handleGa4Cron(): Promise<Awaited<ReturnType<typeof runGa4Cron>>> {
    try {
        const result = await runGa4Cron(liveDeps());
        if ('error' in result) return { error: 'GA4 sync will retry on the next run.' };
        return result;
    } catch {
        return { error: 'GA4 sync will retry on the next run.' };
    }
}

export async function handleGa4Queue(message: unknown): Promise<void> {
    try {
        await runGa4QueueMessage(message, liveDeps());
    } catch {
        throw new Error('GA4 sync will retry');
    }
}
