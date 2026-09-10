/** Exact Google property identifiers are retained; display labels are never keys. */
export interface GscSite { siteUrl: string; permissionLevel: string; logoUrl?: string }

export function describeProperty(scope: string) {
    const domain = scope.startsWith('sc-domain:');
    let label = domain ? scope.slice(10) : scope;
    if (!domain) { try { label = new URL(scope).host; } catch { /* retain original */ } }
    return { label, type: domain ? 'Domain property' : 'URL-prefix property', scope };
}

export function permissionLabel(permission: string) {
    return ({ siteOwner: 'Owner', siteFullUser: 'Full access', siteRestrictedUser: 'Restricted access' } as Record<string, string>)[permission] ?? 'Access unavailable';
}

export function isClientMatch(siteUrl: string, website?: string) {
    if (!website) return false;
    try {
        const client = new URL(website.includes('://') ? website : `https://${website}`).hostname.toLowerCase().replace(/^www\./, '');
        const property = siteUrl.startsWith('sc-domain:') ? siteUrl.slice(10).toLowerCase() : new URL(siteUrl).hostname.toLowerCase();
        return property.replace(/^www\./, '') === client;
    } catch { return false; }
}

export function filterProperties(sites: GscSite[], query: string, website?: string) {
    return sites.filter(s => s.siteUrl.toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => Number(isClientMatch(b.siteUrl, website)) - Number(isClientMatch(a.siteUrl, website)) || a.siteUrl.localeCompare(b.siteUrl));
}

export function selectGscProperty(sites: GscSite[], selection: unknown): GscSite | null {
    if (typeof selection !== 'string') return null;
    return sites.find(s => s.siteUrl === selection && ['siteOwner', 'siteFullUser', 'siteRestrictedUser'].includes(s.permissionLevel)) ?? null;
}

export class GscError extends Error {
    constructor(message: string, public status = 502) { super(message); }
}

export async function readGscSites(token: string, request: typeof fetch = fetch): Promise<GscSite[]> {
    const response = await request('https://www.googleapis.com/webmasters/v3/sites', {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    if (response.status === 401) throw new GscError('Google authorization expired. Reconnect Search Console.', 401);
    if (response.status === 403) throw new GscError('Google denied permission to list Search Console properties. Check account access or reconnect.', 403);
    if (!response.ok) throw new GscError('Google could not load properties. Try refreshing the list.');
    const data = await response.json();
    if (data.siteEntry !== undefined && !Array.isArray(data.siteEntry)) throw new GscError('Google returned an invalid property list. Try again.');
    return (data.siteEntry ?? []).filter((s: GscSite) => typeof s?.siteUrl === 'string' && typeof s.permissionLevel === 'string');
}

/** Preserve resource choices for review, but never mix tokens from different grants. */
export function reconnectCredentials(previous: Record<string, unknown>, tokens: Record<string, unknown>): Record<string, unknown> {
    const retained = Object.fromEntries(['site_url', 'property_id', 'display_name', 'location_name', 'location_title', 'location_address']
        .filter(key => previous[key] !== undefined).map(key => [key, previous[key]]));
    return { ...retained, ...tokens };
}
