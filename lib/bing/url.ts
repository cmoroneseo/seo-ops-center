/** Read methods for one site snapshot. Crawl stats, SubmitUrl, and IndexNow stay out. */
export const BING_READ_METHODS = [
    'GetUserSites',
    'GetRankAndTrafficStats',
    'GetQueryStats',
    'GetPageStats',
] as const;

export type BingReadMethod = (typeof BING_READ_METHODS)[number];

const ALLOWED = new Set<string>(BING_READ_METHODS);

const API_ORIGIN = 'https://ssl.bing.com/webmaster/api.svc/json/';

export function bingApiUrl(method: string, apiKey: string, siteUrl?: string): string {
    if (!ALLOWED.has(method)) throw new Error('Bing Webmaster method is not allowed');
    if (apiKey.trim() === '') throw new Error('Bing Webmaster API key is missing');
    const url = new URL(method, API_ORIGIN);
    url.searchParams.set('apikey', apiKey);
    if (siteUrl !== undefined) url.searchParams.set('siteUrl', siteUrl);
    return url.toString();
}

/** Replace an API key or apikey query value. Use before any text leaves the process. */
export function redactBingSecret(text: string, apiKey?: string | null): string {
    let out = text.replace(/apikey=[^&\s#]*/gi, 'apikey=REDACTED');
    if (apiKey == null) return out;
    const trimmed = apiKey.trim();
    if (trimmed === '') return out;
    out = out.split(trimmed).join('REDACTED');
    out = out.split(encodeURIComponent(trimmed)).join('REDACTED');
    return out;
}
