import type { ForecastDeskPerson } from './build.ts';
import { parseForecastPayload, type ForecastPayload } from './contract.ts';

/**
 * Campaign Desk has no client in this repo. This is the boundary the sync
 * calls once the feature flag, allowlist, URL, and token are all set.
 * The token is sent as a bearer shared secret and is never copied into errors.
 */

export interface CampaignDeskUpsertResult {
    runId: string;
    idempotent: boolean;
}

export interface CampaignDeskDeleteResult {
    runId: string;
    idempotent: boolean;
}

export interface CampaignDeskClient {
    listPeople(): Promise<ForecastDeskPerson[]>;
    upsertRun(payload: ForecastPayload): Promise<CampaignDeskUpsertResult>;
    deleteRun(runId: string): Promise<CampaignDeskDeleteResult>;
}

export class CampaignDeskRequestError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.name = 'CampaignDeskRequestError';
        this.status = status;
        this.code = code;
    }
}

export interface CampaignDeskClientOptions {
    baseUrl: string;
    token: string;
    fetch?: typeof fetch;
}

function safeMessage(status: number, code: string): string {
    if (status === 401 || code === 'unauthorized') return 'Campaign Desk rejected the sync key.';
    if (status === 404 || code === 'run_not_found') return 'Campaign Desk has no sync with that id.';
    if (status === 409 || code === 'idempotency_conflict') return 'Campaign Desk already stored a different body for this sync.';
    if (status === 422 || code === 'invalid_payload') return 'Campaign Desk rejected the forecast body.';
    return 'Campaign Desk could not complete the sync.';
}

function stripToken(value: string, token: string): string {
    return token ? value.split(token).join('[redacted]') : value;
}

async function readBody(response: Response, token: string): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new CampaignDeskRequestError(
            response.status,
            'unreadable',
            stripToken('Campaign Desk returned an unreadable response.', token),
        );
    }
}

function errorCode(body: unknown): string {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
    const code = (body as { error?: unknown }).error;
    return typeof code === 'string' ? code : '';
}

export function createCampaignDeskClient(options: CampaignDeskClientOptions): CampaignDeskClient {
    const fetchImpl = options.fetch ?? fetch;
    const baseUrl = options.baseUrl.replace(/\/+$/, '');
    const token = options.token;

    async function request(path: string, init: { method: string; body?: unknown }): Promise<unknown> {
        let response: Response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, {
                method: init.method,
                headers: {
                    authorization: `Bearer ${token}`,
                    accept: 'application/json',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            });
        } catch {
            throw new CampaignDeskRequestError(0, 'unavailable', 'Campaign Desk could not be reached.');
        }
        const body = await readBody(response, token);
        if (!response.ok) {
            const code = errorCode(body);
            throw new CampaignDeskRequestError(response.status, code || 'unavailable', safeMessage(response.status, code));
        }
        return body;
    }

    return {
        async listPeople() {
            const body = await request('/v1/people', { method: 'GET' });
            if (!body || typeof body !== 'object' || !Array.isArray((body as { people?: unknown }).people)) {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.');
            }
            return (body as { people: unknown[] }).people.map(person => {
                if (!person || typeof person !== 'object') {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.');
                }
                const id = (person as { id?: unknown }).id;
                const email = (person as { email?: unknown }).email;
                if (typeof id !== 'string' || id.trim() === '' || typeof email !== 'string' || !email.includes('@')) {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.');
                }
                return { id: id.trim(), email: email.trim() };
            });
        },
        async upsertRun(payload) {
            parseForecastPayload(payload);
            const body = await request(`/v1/forecast-runs/${encodeURIComponent(payload.runId)}`, {
                method: 'PUT',
                body: payload,
            });
            if (!body || typeof body !== 'object') {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable sync response.');
            }
            const record = body as { runId?: unknown; status?: unknown; idempotent?: unknown };
            if (record.runId !== payload.runId || record.status !== 'accepted' || typeof record.idempotent !== 'boolean') {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable sync response.');
            }
            return { runId: payload.runId, idempotent: record.idempotent };
        },
        async deleteRun(runId) {
            const body = await request(`/v1/forecast-runs/${encodeURIComponent(runId)}`, { method: 'DELETE' });
            if (!body || typeof body !== 'object') {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable undo response.');
            }
            const record = body as { runId?: unknown; status?: unknown; idempotent?: unknown };
            if (record.runId !== runId || record.status !== 'deleted') {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable undo response.');
            }
            return { runId, idempotent: record.idempotent === true };
        },
    };
}
