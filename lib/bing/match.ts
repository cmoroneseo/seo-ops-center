import { hostKey } from './host';
import type { BingSite } from './map';

export interface BingClientRow {
    id: string;
    organizationId: string;
    domain: string | null;
    /** Search Console property URL. Used only when domain has no host. */
    gscSiteUrl: string | null;
    status: string;
}

export interface BingIntegrationRow {
    clientId: string;
    organizationId: string;
    syncStatus: string;
    siteUrl: string | null;
}

export type BingMapAction =
    | { kind: 'markUnverified'; organizationId: string; clientId: string; siteUrl: string }
    | { kind: 'enqueue'; organizationId: string; clientId: string }
    | { kind: 'insert'; organizationId: string; clientId: string; siteUrl: string };

const ENQUEUE_STATUSES = new Set(['active', 'error']);

/**
 * Match verified Bing hosts to a client host. A stored domain wins. When it
 * has no host, the Search Console property URL is the fallback. The stored
 * value is the exact URL Bing returned. Unverified and ambiguous hosts are
 * never chosen. An existing row with a different URL is left alone.
 * Disconnected rows are not revived. Only an active client is inserted or
 * enqueued.
 */
export function planBingAutoMap(input: {
    sites: BingSite[];
    clients: BingClientRow[];
    integrations: BingIntegrationRow[];
}): BingMapAction[] {
    const verifiedUrls = new Set<string>();
    const urlsByHost = new Map<string, Set<string>>();
    for (const site of input.sites) {
        if (!site.verified) continue;
        const siteUrl = site.siteUrl.trim();
        if (siteUrl === '') continue;
        verifiedUrls.add(siteUrl);
        const host = hostKey(siteUrl);
        if (!host) continue;
        const urls = urlsByHost.get(host) ?? new Set<string>();
        urls.add(siteUrl);
        urlsByHost.set(host, urls);
    }

    const activeByHost = new Map<string, BingClientRow[]>();
    const clientsById = new Map<string, BingClientRow>();
    for (const client of input.clients) {
        clientsById.set(client.id, client);
        if (client.status !== 'active') continue;
        const host = hostKey(client.domain) ?? hostKey(client.gscSiteUrl);
        if (!host) continue;
        const group = activeByHost.get(host) ?? [];
        group.push(client);
        activeByHost.set(host, group);
    }

    const integrationByClient = new Map<string, BingIntegrationRow>();
    for (const integration of input.integrations) {
        if (!integrationByClient.has(integration.clientId)) {
            integrationByClient.set(integration.clientId, integration);
        }
    }

    const actions: BingMapAction[] = [];
    for (const integration of integrationByClient.values()) {
        if (integration.syncStatus === 'disconnected') continue;
        const siteUrl = integration.siteUrl?.trim() ?? '';
        if (siteUrl === '') continue;
        if (!verifiedUrls.has(siteUrl)) {
            actions.push({
                kind: 'markUnverified',
                organizationId: integration.organizationId,
                clientId: integration.clientId,
                siteUrl,
            });
            continue;
        }
        const client = clientsById.get(integration.clientId);
        if (client?.status === 'active' && ENQUEUE_STATUSES.has(integration.syncStatus)) {
            actions.push({
                kind: 'enqueue',
                organizationId: integration.organizationId,
                clientId: integration.clientId,
            });
        }
    }

    const claimed = new Set(integrationByClient.keys());
    const hosts = [...urlsByHost.keys()].sort();
    for (const host of hosts) {
        const urls = urlsByHost.get(host);
        if (!urls || urls.size !== 1) continue;
        const matches = activeByHost.get(host) ?? [];
        if (matches.length !== 1) continue;
        const client = matches[0];
        if (claimed.has(client.id)) continue;
        const siteUrl = [...urls][0];
        actions.push({
            kind: 'insert',
            organizationId: client.organizationId,
            clientId: client.id,
            siteUrl,
        });
    }
    return actions;
}
