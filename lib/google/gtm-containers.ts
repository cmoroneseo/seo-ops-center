/**
 * Google Tag Manager container catalog.
 *
 * Read-only. The OAuth grant is tagmanager.readonly. This module never
 * creates, edits, or publishes a container.
 *
 * Kentina Hospitality, for setup notes only (not seeded):
 * GA4 property 542058119, GTM account 6361320998,
 * container 255732081, public id GTM-W8Q8SC6V.
 */

export { GTM_READONLY_SCOPE } from './account';

export interface GtmContainerChoice {
    accountId: string;
    accountName: string;
    containerId: string;
    name: string;
    publicId: string;
}

export class GtmContainersError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

const ACCOUNT_ID = /^\d{4,20}$/;
const PUBLIC_ID = /^GTM-[A-Z0-9]+$/;
const MAX_PAGES = 20;

export function gtmContainerKey(container: Pick<GtmContainerChoice, 'accountId' | 'containerId'>): string {
    return `${container.accountId}/${container.containerId}`;
}

export function filterGtmContainers(containers: GtmContainerChoice[], query: string): GtmContainerChoice[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return containers;
    return containers.filter(container =>
        [container.name, container.accountName, container.publicId, container.accountId, container.containerId, gtmContainerKey(container)]
            .some(field => field.toLowerCase().includes(needle)));
}

export function sortGtmContainers(containers: GtmContainerChoice[]): GtmContainerChoice[] {
    return [...containers].sort((a, b) =>
        a.accountName.localeCompare(b.accountName, 'en', { sensitivity: 'base' })
        || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
        || a.publicId.localeCompare(b.publicId));
}

/** The container must be in the live catalog. The caller's ids are not trusted on their own. */
export function selectGtmContainer(
    containers: GtmContainerChoice[],
    accountId: unknown,
    containerId: unknown,
): GtmContainerChoice | null {
    if (typeof accountId !== 'string' || typeof containerId !== 'string') return null;
    if (!ACCOUNT_ID.test(accountId) || !ACCOUNT_ID.test(containerId)) return null;
    return containers.find(container => container.accountId === accountId && container.containerId === containerId) ?? null;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function accountsFrom(body: unknown): { accountId: string; name: string }[] {
    if (!body || typeof body !== 'object') return [];
    const rows = (body as { account?: unknown }).account;
    if (!Array.isArray(rows)) return [];
    const accounts: { accountId: string; name: string }[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as { accountId?: unknown; name?: unknown; path?: unknown };
        const accountId = text(record.accountId) || text(record.path).split('/')[1] || '';
        if (!ACCOUNT_ID.test(accountId)) continue;
        const name = text(record.name).replace(/^accounts\/\d+$/, '') || accountId;
        accounts.push({ accountId, name: name || accountId });
    }
    return accounts;
}

function containersFrom(body: unknown, account: { accountId: string; name: string }): GtmContainerChoice[] {
    if (!body || typeof body !== 'object') return [];
    const rows = (body as { container?: unknown }).container;
    if (!Array.isArray(rows)) return [];
    const containers: GtmContainerChoice[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as { accountId?: unknown; containerId?: unknown; publicId?: unknown; name?: unknown };
        const accountId = text(record.accountId) || account.accountId;
        const containerId = text(record.containerId);
        const publicId = text(record.publicId);
        const name = text(record.name);
        if (accountId !== account.accountId || !ACCOUNT_ID.test(containerId) || !PUBLIC_ID.test(publicId) || !name) continue;
        containers.push({ accountId, accountName: account.name, containerId, name, publicId });
    }
    return containers;
}

async function getJson(
    url: string,
    token: string,
    request: typeof fetch,
    log: (status: number) => void,
): Promise<{ status: number; body: unknown; next: string }> {
    let response: Response;
    try {
        response = await request(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        log(0);
        throw new GtmContainersError('Unable to list Tag Manager containers. Check Google access or reconnect.', 502);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        log(response.status);
        const status = response.status === 401 || response.status === 403 ? response.status : 502;
        throw new GtmContainersError('Unable to list Tag Manager containers. Check Google access or reconnect.', status);
    }
    const next = body && typeof body === 'object' && typeof (body as { nextPageToken?: unknown }).nextPageToken === 'string'
        ? (body as { nextPageToken: string }).nextPageToken
        : '';
    return { status: response.status, body, next };
}

/**
 * Every account the grant can see, then each account's containers.
 * Logs only HTTP status. Never the token, the page token, or the body.
 */
export async function readGtmContainers(
    token: string,
    request: typeof fetch = fetch,
    log: (status: number) => void = status => { console.error('Tag Manager container list failed', { status }); },
): Promise<GtmContainerChoice[]> {
    const accounts: { accountId: string; name: string }[] = [];
    const seenAccounts = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < MAX_PAGES; page++) {
        const url = new URL('https://tagmanager.googleapis.com/tagmanager/v2/accounts');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const result = await getJson(url.toString(), token, request, log);
        accounts.push(...accountsFrom(result.body));
        if (!result.next || seenAccounts.has(result.next)) break;
        seenAccounts.add(result.next);
        pageToken = result.next;
    }

    const containers: GtmContainerChoice[] = [];
    for (const account of accounts) {
        const seenPages = new Set<string>();
        let containerPage = '';
        for (let page = 0; page < MAX_PAGES; page++) {
            const url = new URL(`https://tagmanager.googleapis.com/tagmanager/v2/accounts/${account.accountId}/containers`);
            if (containerPage) url.searchParams.set('pageToken', containerPage);
            const result = await getJson(url.toString(), token, request, log);
            containers.push(...containersFrom(result.body, account));
            if (!result.next || seenPages.has(result.next)) break;
            seenPages.add(result.next);
            containerPage = result.next;
        }
    }
    return sortGtmContainers(containers);
}

export interface GtmEventTag {
    name: string;
    eventName: string;
    paused: boolean;
}

function parameterValue(parameter: unknown, key: string): string {
    if (!Array.isArray(parameter)) return '';
    for (const entry of parameter) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as { key?: unknown; value?: unknown };
        if (row.key !== key) continue;
        if (typeof row.value === 'string') return row.value.trim();
    }
    return '';
}

/** GA4 Event tags (`gaawe`) on a live container version. Other tag types are ignored. */
export function gtmEventTagsFromVersion(body: unknown): GtmEventTag[] {
    const version = body && typeof body === 'object' && (body as { containerVersion?: unknown }).containerVersion
        ? (body as { containerVersion: unknown }).containerVersion
        : body;
    if (!version || typeof version !== 'object') return [];
    const tags = (version as { tag?: unknown }).tag;
    if (!Array.isArray(tags)) return [];
    const parsed: GtmEventTag[] = [];
    for (const tag of tags) {
        if (!tag || typeof tag !== 'object') continue;
        const row = tag as { type?: unknown; name?: unknown; parameter?: unknown; paused?: unknown };
        if (row.type !== 'gaawe') continue;
        const eventName = parameterValue(row.parameter, 'eventName');
        if (!eventName) continue;
        parsed.push({
            name: text(row.name) || eventName,
            eventName,
            paused: row.paused === true,
        });
    }
    return parsed;
}

export async function readLiveGtmEventTags(
    token: string,
    accountId: string,
    containerId: string,
    request: typeof fetch = fetch,
    log: (status: number) => void = status => { console.error('Tag Manager live version failed', { status }); },
): Promise<GtmEventTag[]> {
    if (!ACCOUNT_ID.test(accountId) || !ACCOUNT_ID.test(containerId)) {
        throw new GtmContainersError('Tag Manager container is not selected.', 400);
    }
    const url = `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}/versions:live`;
    let response: Response;
    try {
        response = await request(url, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });
    } catch {
        log(0);
        throw new GtmContainersError('Unable to read Tag Manager tags. Check Google access or reconnect.', 502);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        log(response.status);
        const status = response.status === 401 || response.status === 403 ? response.status : 502;
        throw new GtmContainersError('Unable to read Tag Manager tags. Check Google access or reconnect.', status);
    }
    return gtmEventTagsFromVersion(body);
}
