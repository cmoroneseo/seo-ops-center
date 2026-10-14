export interface Ga4PropertySummary {
    id: string;
    displayName: string;
    account: string;
}

/** Numeric id, with the Analytics Admin `properties/` prefix removed. */
export function ga4PropertyId(id: string): string {
    return id.replace(/^properties\//, '');
}

/**
 * Case-insensitive match on display name, account name, and property id.
 * Order is unchanged. A leading "ID:" is ignored so a pasted label still matches.
 * Selection stays with the caller; this never clears it.
 */
export function filterGa4Properties<T extends Ga4PropertySummary>(properties: T[], query: string): T[] {
    const needle = query.trim().toLowerCase().replace(/^id:\s*/, '');
    if (!needle) return properties;
    return properties.filter(property => {
        const numericId = ga4PropertyId(property.id);
        return [property.displayName, property.account, property.id, numericId]
            .some(field => field.toLowerCase().includes(needle));
    });
}

export function ga4SearchEmptyMessage(query: string): string {
    return `No properties match "${query.trim()}"`;
}

/** Account summaries are paged. 200 is the Admin API maximum. */
export const GA4_ACCOUNT_SUMMARIES_PAGE_SIZE = 200;
const GA4_ACCOUNT_SUMMARIES_MAX_PAGES = 50;

export class Ga4PropertiesError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

export function sortGa4Properties<T extends Ga4PropertySummary>(properties: T[]): T[] {
    return [...properties].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

function propertiesFromAccountSummaries(accounts: unknown[]): Ga4PropertySummary[] {
    const properties: Ga4PropertySummary[] = [];
    for (const account of accounts) {
        if (!account || typeof account !== 'object') continue;
        const record = account as { displayName?: unknown; propertySummaries?: unknown };
        const accountName = typeof record.displayName === 'string' ? record.displayName : '';
        if (!Array.isArray(record.propertySummaries)) continue;
        for (const property of record.propertySummaries) {
            if (!property || typeof property !== 'object') continue;
            const row = property as { property?: unknown; displayName?: unknown };
            if (typeof row.property !== 'string' || typeof row.displayName !== 'string') continue;
            properties.push({ id: row.property, displayName: row.displayName, account: accountName });
        }
    }
    return properties;
}

/**
 * Follow every accountSummaries page. Logs only the HTTP status — never the
 * body, the page token, or the access token.
 */
export async function readGa4Properties(
    token: string,
    request: typeof fetch = fetch,
    log: (status: number) => void = status => { console.error('GA4 accountSummaries request failed', { status }); },
): Promise<Ga4PropertySummary[]> {
    const collected: Ga4PropertySummary[] = [];
    const seen = new Set<string>();
    let pageToken = '';

    for (let page = 0; page < GA4_ACCOUNT_SUMMARIES_MAX_PAGES; page++) {
        const url = new URL('https://analyticsadmin.googleapis.com/v1beta/accountSummaries');
        url.searchParams.set('pageSize', String(GA4_ACCOUNT_SUMMARIES_PAGE_SIZE));
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        let response: Response;
        try {
            response = await request(url, {
                headers: { Authorization: `Bearer ${token}` },
                cache: 'no-store',
                signal: AbortSignal.timeout(15000),
            });
        } catch {
            log(0);
            throw new Ga4PropertiesError('Unable to list Analytics properties. Check Google access or reconnect.', 502);
        }

        if (!response.ok) {
            log(response.status);
            const status = response.status === 401 || response.status === 403 ? response.status : 502;
            throw new Ga4PropertiesError('Unable to list Analytics properties. Check Google access or reconnect.', status);
        }

        const data = await response.json().catch(() => null);
        if (!data || typeof data !== 'object' || (data.accountSummaries !== undefined && !Array.isArray(data.accountSummaries))) {
            log(response.status);
            throw new Ga4PropertiesError('Unable to list Analytics properties. Check Google access or reconnect.', 502);
        }

        collected.push(...propertiesFromAccountSummaries(data.accountSummaries ?? []));
        const next = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
        if (!next || seen.has(next)) return sortGa4Properties(collected);
        if (page === GA4_ACCOUNT_SUMMARIES_MAX_PAGES - 1) log(0);
        seen.add(next);
        pageToken = next;
    }

    return sortGa4Properties(collected);
}
