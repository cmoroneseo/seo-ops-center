import { isCampaignDeskClientId, nameMatchesToRemember, presentClientMap, type ForecastClientLink, type ForecastDeskClient, type ForecastSeoClient } from './clients.ts';
import type { ForecastAdminAuth, ForecastAuthFailure } from './http.ts';
import type { ForecastReadiness } from './flags.ts';
import { ForecastClientMapUnavailable } from './store.ts';

/**
 * Admin map from an SEO Ops client to a Campaign Desk client.
 * Writes go through the service role after this route checks the caller
 * is an owner or admin of the organization. The browser does not write the table.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ForecastClientMapDependencies {
    authorize(organizationId: string): Promise<ForecastAdminAuth | ForecastAuthFailure>;
    readiness(organizationId: string): ForecastReadiness;
    payloadVersion(): 1 | 2;
    listSeoClients(organizationId: string): Promise<ForecastSeoClient[]>;
    loadClientLinks(organizationId: string): Promise<ForecastClientLink[]>;
    listDeskClients(): Promise<ForecastDeskClient[]>;
    saveClientLink(input: {
        organizationId: string;
        clientId: string;
        campaignDeskClientId: string;
        matchedBy: 'manual' | 'name';
        updatedBy: string;
    }): Promise<void>;
    clearClientLink(organizationId: string, clientId: string): Promise<void>;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

async function authorize(deps: ForecastClientMapDependencies, organizationId: string) {
    if (!organizationId.trim() || !UUID.test(organizationId.trim())) {
        return { error: json({ error: 'Missing organizationId' }, 400) };
    }
    const auth = await deps.authorize(organizationId.trim());
    if (!auth.ok) return { error: json({ error: auth.error }, auth.status) };
    return { auth };
}

async function deskClients(deps: ForecastClientMapDependencies, connection: ForecastReadiness) {
    if (!connection.enabled) return { clients: null as ForecastDeskClient[] | null, error: connection.reason };
    try {
        return { clients: await deps.listDeskClients(), error: null as string | null };
    } catch {
        return { clients: null, error: 'Campaign Desk clients could not be loaded.' };
    }
}

function view(
    deps: ForecastClientMapDependencies,
    auth: ForecastAdminAuth,
    seoClients: ForecastSeoClient[],
    links: ForecastClientLink[],
    desk: { clients: ForecastDeskClient[] | null; error: string | null },
    connection: ForecastReadiness,
) {
    const presented = presentClientMap({
        seoClients,
        links,
        deskClients: desk.clients,
    });
    return {
        storageReady: true,
        payloadVersion: deps.payloadVersion(),
        connectionEnabled: connection.enabled,
        deskError: desk.error,
        unmatched: presented.unmatched,
        deskClients: desk.clients ?? [],
        rows: presented.rows,
        organizationId: auth.organizationId,
    };
}

export function createForecastClientLinksGet(deps: ForecastClientMapDependencies) {
    return async function getForecastClientLinks(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const gate = await authorize(deps, params.get('organizationId') ?? '');
        if ('error' in gate && gate.error) return gate.error;
        const { auth } = gate as { auth: ForecastAdminAuth };
        const connection = deps.readiness(auth.organizationId);
        let seoClients: ForecastSeoClient[];
        try {
            seoClients = await deps.listSeoClients(auth.organizationId);
        } catch {
            return json({ error: 'Clients could not be loaded.' }, 500);
        }
        let links: ForecastClientLink[];
        try {
            links = await deps.loadClientLinks(auth.organizationId);
        } catch (error) {
            if (error instanceof ForecastClientMapUnavailable) {
                return json({
                    storageReady: false,
                    payloadVersion: deps.payloadVersion(),
                    connectionEnabled: connection.enabled,
                    deskError: null,
                    unmatched: 0,
                    deskClients: [],
                    rows: [],
                    message: 'Client mapping storage is not set up. Apply migration 099 before saving matches.',
                });
            }
            throw error;
        }
        const desk = await deskClients(deps, connection);
        return json(view(deps, auth, seoClients, links, desk, connection));
    };
}

export function createForecastClientLinksPut(deps: ForecastClientMapDependencies) {
    return async function putForecastClientLinks(request: Request): Promise<Response> {
        let body: Record<string, unknown>;
        try {
            const parsed = await request.json() as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return json({ error: 'Invalid JSON' }, 400);
            }
            body = parsed as Record<string, unknown>;
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }
        const gate = await authorize(deps, typeof body.organizationId === 'string' ? body.organizationId : '');
        if ('error' in gate && gate.error) return gate.error;
        const { auth } = gate as { auth: ForecastAdminAuth };
        const connection = deps.readiness(auth.organizationId);

        let seoClients: ForecastSeoClient[];
        let links: ForecastClientLink[];
        try {
            seoClients = await deps.listSeoClients(auth.organizationId);
            links = await deps.loadClientLinks(auth.organizationId);
        } catch (error) {
            if (error instanceof ForecastClientMapUnavailable) {
                return json({ error: 'Client mapping storage is not set up. Apply migration 099 before saving matches.' }, 503);
            }
            throw error;
        }

        if (body.applyNameMatches === true) {
            const desk = await deskClients(deps, connection);
            if (!desk.clients) return json({ error: desk.error ?? 'Campaign Desk clients could not be loaded.' }, 409);
            const matches = nameMatchesToRemember(seoClients, new Map(links.map(link => [link.clientId, link.campaignDeskClientId])), desk.clients);
            for (const match of matches) {
                await deps.saveClientLink({
                    organizationId: auth.organizationId,
                    clientId: match.clientId,
                    campaignDeskClientId: match.campaignDeskClientId,
                    matchedBy: 'name',
                    updatedBy: auth.userId,
                });
            }
            const saved = await deps.loadClientLinks(auth.organizationId);
            return json(view(deps, auth, seoClients, saved, { clients: desk.clients, error: null }, connection));
        }

        const clientId = typeof body.clientId === 'string' ? body.clientId.trim().toLowerCase() : '';
        if (!UUID.test(clientId)) return json({ error: 'Missing clientId' }, 400);
        if (!seoClients.some(client => client.id.toLowerCase() === clientId)) {
            return json({ error: 'Client not found.' }, 404);
        }
        if (body.campaignDeskClientId === null) {
            await deps.clearClientLink(auth.organizationId, clientId);
        } else if (typeof body.campaignDeskClientId === 'string' && isCampaignDeskClientId(body.campaignDeskClientId)) {
            const desk = await deskClients(deps, connection);
            if (!desk.clients) return json({ error: desk.error ?? 'Campaign Desk clients could not be loaded.' }, 409);
            if (!desk.clients.some(client => client.id === body.campaignDeskClientId)) {
                return json({ error: 'That Campaign Desk client is not in the list.' }, 422);
            }
            await deps.saveClientLink({
                organizationId: auth.organizationId,
                clientId,
                campaignDeskClientId: body.campaignDeskClientId,
                matchedBy: 'manual',
                updatedBy: auth.userId,
            });
        } else {
            return json({ error: 'campaignDeskClientId must be a Campaign Desk client id or null.' }, 400);
        }

        const saved = await deps.loadClientLinks(auth.organizationId);
        const desk = await deskClients(deps, connection);
        return json(view(deps, auth, seoClients, saved, desk, connection));
    };
}
