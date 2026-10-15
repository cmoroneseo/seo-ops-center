import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { createForecastClientLinksGet, createForecastClientLinksPut } from './client-map-http.ts';
import { campaignDeskBaseUrl, campaignDeskReady, campaignDeskSyncV2, campaignDeskToken } from './flags.ts';
import {
    campaignDeskClientFrom,
    createForecastPreviewGet,
    createForecastStatusGet,
    createForecastSyncPost,
    createForecastUndoPost,
    type ForecastHttpDependencies,
} from './http.ts';
import {
    clearForecastClientLink,
    createForecastRunStore,
    listForecastSeoClients,
    loadForecastClientLinks,
    loadForecastSource,
    rememberForecastClientNameMatches,
    saveForecastClientLink,
} from './source.ts';

const disabledClient: ForecastHttpDependencies['client'] = {
    async listPeople() {
        throw new Error('Campaign Desk sync is turned off.');
    },
    async listClients() {
        throw new Error('Campaign Desk sync is turned off.');
    },
    async upsertRun() {
        throw new Error('Campaign Desk sync is turned off.');
    },
    async deleteRun() {
        throw new Error('Campaign Desk sync is turned off.');
    },
};

function liveClient(): ForecastHttpDependencies['client'] {
    const baseUrl = campaignDeskBaseUrl();
    const token = campaignDeskToken();
    if (!baseUrl || !token) return disabledClient;
    return campaignDeskClientFrom(baseUrl, token);
}

function dependencies(): ForecastHttpDependencies {
    const client = liveClient();
    return {
        now: () => new Date(),
        newRunId: () => crypto.randomUUID(),
        async authorize(organizationId) {
            const result = await requireOrganizationAdmin(organizationId);
            if (!result.ok) return { ok: false, status: result.status, error: result.error };
            return {
                ok: true,
                userId: result.userId,
                actorName: result.actorName,
                organizationId: result.organizationId,
                role: result.role,
            };
        },
        load: loadForecastSource,
        readiness: organizationId => campaignDeskReady(organizationId),
        listPeople: () => client.listPeople(),
        payloadVersion: () => campaignDeskSyncV2() ? 2 : 1,
        listClients: () => client.listClients(),
        loadClientLinks: loadForecastClientLinks,
        rememberNameMatches: rememberForecastClientNameMatches,
        store: createForecastRunStore(),
        client,
    };
}

const wired = dependencies();

export const forecastPreviewGet = createForecastPreviewGet(wired);
export const forecastStatusGet = createForecastStatusGet(wired);
export const forecastSyncPost = createForecastSyncPost(wired);
export const forecastUndoPost = createForecastUndoPost(wired);

const clientMap = {
    authorize: wired.authorize,
    readiness: wired.readiness,
    payloadVersion: wired.payloadVersion,
    listSeoClients: listForecastSeoClients,
    loadClientLinks: wired.loadClientLinks,
    listDeskClients: wired.listClients,
    saveClientLink: saveForecastClientLink,
    clearClientLink: clearForecastClientLink,
};

export const forecastClientLinksGet = createForecastClientLinksGet(clientMap);
export const forecastClientLinksPut = createForecastClientLinksPut(clientMap);
