import type { ForecastDeskPerson } from './build.ts';
import type { ForecastDeskClient } from './clients.ts';
import { isCampaignDeskClientId } from './clients.ts';
import { parseStoredForecastPayload, type StoredForecastPayload } from './contract-v2.ts';

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
    listClients(): Promise<ForecastDeskClient[]>;
    upsertRun(payload: StoredForecastPayload): Promise<CampaignDeskUpsertResult>;
    deleteRun(runId: string): Promise<CampaignDeskDeleteResult>;
}

export class CampaignDeskRequestError extends Error {
    readonly status: number;
    readonly code: string;
    readonly path: string;
    readonly fetchErrorName: string | null;
    readonly fetchErrorMessage: string | null;

    constructor(
        status: number,
        code: string,
        message: string,
        details: {
            path?: string;
            fetchErrorName?: string | null;
            fetchErrorMessage?: string | null;
        } = {},
    ) {
        super(message);
        this.name = 'CampaignDeskRequestError';
        this.status = status;
        this.code = code;
        this.path = details.path ?? '';
        this.fetchErrorName = details.fetchErrorName ?? null;
        this.fetchErrorMessage = details.fetchErrorMessage ?? null;
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

function fetchFailure(error: unknown, token: string): { fetchErrorName: string | null; fetchErrorMessage: string | null } {
    if (!error || typeof error !== 'object') return { fetchErrorName: null, fetchErrorMessage: null };
    const named = error as { name?: unknown; message?: unknown; cause?: unknown };
    const fetchErrorName = typeof named.name === 'string' && named.name ? named.name : null;
    const parts: string[] = [];
    if (typeof named.message === 'string' && named.message) parts.push(named.message);
    const cause = named.cause;
    if (typeof cause === 'string' && cause) parts.push(cause);
    else if (cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string') {
        const causeMessage = (cause as { message: string }).message;
        if (causeMessage) parts.push(causeMessage);
    }
    const combined = parts.join(': ');
    return {
        fetchErrorName,
        fetchErrorMessage: combined ? stripToken(combined, token).slice(0, 300) : null,
    };
}

async function readBody(response: Response, path: string): Promise<unknown> {
    const text = await response.text();
    if (!text.trim()) return null;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new CampaignDeskRequestError(
            response.status,
            'unreadable',
            'Campaign Desk returned an unreadable response.',
            { path },
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
                    'user-agent': 'SEO-Ops-Center/1.0',
                    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
                },
                body: init.body === undefined ? undefined : JSON.stringify(init.body),
            });
        } catch (error) {
            throw new CampaignDeskRequestError(0, 'unreachable', 'Campaign Desk could not be reached.', {
                path,
                ...fetchFailure(error, token),
            });
        }
        const body = await readBody(response, path);
        if (!response.ok) {
            const code = errorCode(body);
            throw new CampaignDeskRequestError(response.status, code || 'unavailable', safeMessage(response.status, code), { path });
        }
        return body;
    }

    return {
        async listPeople() {
            const body = await request('/v1/people', { method: 'GET' });
            if (!body || typeof body !== 'object' || !Array.isArray((body as { people?: unknown }).people)) {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.', { path: '/v1/people' });
            }
            return (body as { people: unknown[] }).people.map(person => {
                if (!person || typeof person !== 'object') {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.', { path: '/v1/people' });
                }
                const id = (person as { id?: unknown }).id;
                const email = (person as { email?: unknown }).email;
                if (typeof id !== 'string' || id.trim() === '' || typeof email !== 'string' || !email.includes('@')) {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable people list.', { path: '/v1/people' });
                }
                return { id: id.trim(), email: email.trim() };
            });
        },
        async listClients() {
            const body = await request('/v1/clients', { method: 'GET' });
            if (!body || typeof body !== 'object' || !Array.isArray((body as { clients?: unknown }).clients)) {
                throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable client list.', { path: '/v1/clients' });
            }
            return (body as { clients: unknown[] }).clients.map(client => {
                if (!client || typeof client !== 'object') {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable client list.', { path: '/v1/clients' });
                }
                const id = (client as { id?: unknown }).id;
                const name = (client as { name?: unknown }).name;
                if (typeof id !== 'string' || !isCampaignDeskClientId(id.trim()) || id !== id.trim()) {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable client list.', { path: '/v1/clients' });
                }
                if (typeof name !== 'string' || name.trim() === '') {
                    throw new CampaignDeskRequestError(200, 'invalid_payload', 'Campaign Desk returned an unreadable client list.', { path: '/v1/clients' });
                }
                return { id, name: name.trim() };
            });
        },
        async upsertRun(payload) {
            parseStoredForecastPayload(payload);
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
