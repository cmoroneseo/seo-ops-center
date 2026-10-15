/**
 * SEO Ops client → Campaign Desk client.
 *
 * A saved link wins. Otherwise one exact name match (trimmed, case-sensitive)
 * is the suggestion. Zero or several matches stay unmatched. The run is still
 * sent; Campaign Desk shows the sender's name with an unmatched badge.
 */

export interface ForecastDeskClient {
    id: string;
    name: string;
}

export interface ForecastSeoClient {
    id: string;
    name: string;
    domain: string | null;
}

export interface ForecastClientLink {
    clientId: string;
    campaignDeskClientId: string;
    matchedBy: 'manual' | 'name';
}

export interface ForecastClientMapRow {
    clientId: string;
    name: string;
    domain: string | null;
    savedId: string | null;
    matchedBy: 'manual' | 'name' | null;
    suggestionId: string | null;
    suggestionName: string | null;
    effectiveId: string | null;
}

const MAX_CLIENT_KEY = 64;

export function isCampaignDeskClientId(value: string): boolean {
    return value.length >= 1
        && value.length <= MAX_CLIENT_KEY
        && value === value.trim()
        && !/[\u0000-\u001f]/.test(value);
}

/** Exactly one Campaign Desk client whose trimmed name equals `name`. */
export function suggestCampaignDeskClientId(
    name: string,
    clients: readonly ForecastDeskClient[],
): string | null {
    const trimmed = name.trim();
    if (!trimmed || trimmed === 'Internal') return null;
    const hits = clients.filter(client =>
        client.name.trim() === trimmed && isCampaignDeskClientId(client.id));
    if (hits.length !== 1) return null;
    return hits[0].id;
}

export function resolveCampaignDeskClientId(input: {
    seoClientId: string;
    name: string;
    links: ReadonlyMap<string, string>;
    deskClients: readonly ForecastDeskClient[] | null;
}): { id: string | null; suggested: boolean } {
    const saved = input.links.get(input.seoClientId);
    if (saved && isCampaignDeskClientId(saved)) return { id: saved, suggested: false };
    if (!input.deskClients) return { id: null, suggested: false };
    const suggested = suggestCampaignDeskClientId(input.name, input.deskClients);
    return { id: suggested, suggested: suggested != null };
}

export function presentClientMap(input: {
    seoClients: readonly ForecastSeoClient[];
    links: readonly ForecastClientLink[];
    deskClients: readonly ForecastDeskClient[] | null;
}): { rows: ForecastClientMapRow[]; unmatched: number } {
    const links = new Map(input.links.map(link => [link.clientId.toLowerCase(), link]));
    const rows = input.seoClients.map(client => {
        const clientId = client.id.toLowerCase();
        const saved = links.get(clientId);
        const savedId = saved && isCampaignDeskClientId(saved.campaignDeskClientId)
            ? saved.campaignDeskClientId
            : null;
        const suggestionId = savedId ? null : (
            input.deskClients ? suggestCampaignDeskClientId(client.name, input.deskClients) : null
        );
        const suggestionName = suggestionId
            ? input.deskClients?.find(desk => desk.id === suggestionId)?.name ?? null
            : null;
        return {
            clientId,
            name: client.name,
            domain: client.domain,
            savedId,
            matchedBy: savedId ? saved?.matchedBy ?? null : null,
            suggestionId,
            suggestionName,
            effectiveId: savedId ?? suggestionId,
        };
    });
    return {
        rows,
        unmatched: rows.filter(row => row.effectiveId == null).length,
    };
}

export function nameMatchesToRemember(
    seoClients: readonly ForecastSeoClient[],
    links: ReadonlyMap<string, string>,
    deskClients: readonly ForecastDeskClient[],
): { clientId: string; campaignDeskClientId: string }[] {
    const stored = new Map<string, string>();
    for (const [id, value] of links) stored.set(id.toLowerCase(), value);
    const matches: { clientId: string; campaignDeskClientId: string }[] = [];
    for (const client of seoClients) {
        const clientId = client.id.toLowerCase();
        if (stored.has(clientId)) continue;
        const suggested = suggestCampaignDeskClientId(client.name, deskClients);
        if (suggested) matches.push({ clientId, campaignDeskClientId: suggested });
    }
    return matches;
}
