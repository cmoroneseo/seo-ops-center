/** Admin API keyEvents.list. The override is null when the client has not chosen a subset. */

export const GA4_KEY_EVENTS_PAGE_SIZE = 200;
const GA4_KEY_EVENTS_MAX_PAGES = 20;
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export interface Ga4KeyEvent {
    eventName: string;
}

export class Ga4KeyEventsError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
    }
}

export function isGa4EventName(name: string): boolean {
    return EVENT_NAME.test(name);
}

/**
 * Null override uses every listed key event. An explicit list is intersected
 * with the property's current key events. An empty result is null, not zero.
 */
export function resolveGa4KeyEvents(listed: readonly string[], override: readonly string[] | null): string[] | null {
    const known = [...new Set(listed.filter(isGa4EventName))];
    if (override == null) return known.length > 0 ? known : null;
    const allowed = new Set(known);
    const chosen = [...new Set(override.filter(name => allowed.has(name)))];
    return chosen.length > 0 ? chosen : null;
}

function namesFromPage(body: unknown): { names: string[]; next: string } {
    if (!body || typeof body !== 'object') return { names: [], next: '' };
    const record = body as { keyEvents?: unknown; nextPageToken?: unknown };
    const names: string[] = [];
    if (Array.isArray(record.keyEvents)) {
        for (const event of record.keyEvents) {
            if (!event || typeof event !== 'object') continue;
            const name = (event as { eventName?: unknown }).eventName;
            if (typeof name === 'string' && isGa4EventName(name)) names.push(name);
        }
    }
    const next = typeof record.nextPageToken === 'string' ? record.nextPageToken : '';
    return { names, next };
}

/**
 * Follow every keyEvents page. Logs only the HTTP status.
 */
export async function readGa4KeyEvents(
    token: string,
    propertyId: string,
    request: typeof fetch = fetch,
    log: (status: number) => void = status => { console.error('GA4 keyEvents request failed', { status }); },
): Promise<Ga4KeyEvent[]> {
    if (!/^properties\/[0-9]+$/.test(propertyId)) {
        throw new Ga4KeyEventsError('GA4 property is not selected.', 400);
    }
    const names: string[] = [];
    const seen = new Set<string>();
    let pageToken = '';
    for (let page = 0; page < GA4_KEY_EVENTS_MAX_PAGES; page++) {
        const url = new URL(`https://analyticsadmin.googleapis.com/v1beta/${propertyId}/keyEvents`);
        url.searchParams.set('pageSize', String(GA4_KEY_EVENTS_PAGE_SIZE));
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
            throw new Ga4KeyEventsError('Unable to list Analytics key events. Reconnect to add Analytics.', 502);
        }
        if (!response.ok) {
            log(response.status);
            const status = response.status === 401 || response.status === 403 ? response.status : 502;
            throw new Ga4KeyEventsError('Unable to list Analytics key events. Reconnect to add Analytics.', status);
        }
        const parsed = namesFromPage(await response.json().catch(() => null));
        names.push(...parsed.names);
        if (!parsed.next || seen.has(parsed.next)) break;
        if (page === GA4_KEY_EVENTS_MAX_PAGES - 1) log(0);
        seen.add(parsed.next);
        pageToken = parsed.next;
    }
    return [...new Set(names)].sort().map(eventName => ({ eventName }));
}
