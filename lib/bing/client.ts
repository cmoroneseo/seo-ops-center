import { bingApiUrl, type BingReadMethod } from './url';

export class BingRequestError extends Error {
    readonly status: number;

    constructor(status: number) {
        super(`Bing Webmaster request failed (HTTP ${status})`);
        this.name = 'BingRequestError';
        this.status = status;
    }
}

export function isBingBackoffError(error: unknown): boolean {
    return error instanceof BingRequestError && (error.status === 429 || error.status === 503);
}

export interface BingJsonRequest {
    method: BingReadMethod;
    apiKey: string;
    siteUrl?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}

async function discard(response: Response): Promise<void> {
    try {
        await response.body?.cancel();
    } catch {
        // The body can echo the request URL. Leave it unread.
    }
}

/**
 * GET one Bing JSON method. The API key stays in the query string and is
 * never copied into an error. Redirects are not followed.
 */
export async function bingJson(input: BingJsonRequest): Promise<unknown> {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    const url = bingApiUrl(input.method, input.apiKey, input.siteUrl);
    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'manual',
            signal: input.signal,
            headers: { accept: 'application/json' },
            cache: 'no-store',
        });
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Bing Webmaster request was aborted');
        }
        throw new Error('Bing Webmaster request failed');
    }
    if (response.status >= 300 && response.status < 400) {
        await discard(response);
        throw new BingRequestError(response.status);
    }
    if (!response.ok) {
        await discard(response);
        throw new BingRequestError(response.status);
    }
    try {
        return await response.json();
    } catch {
        throw new Error('Bing Webmaster response was not JSON');
    }
}
