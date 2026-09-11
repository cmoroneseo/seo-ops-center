import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { assertPublicAddress, isPublicAddress } from './network-policy.ts';
import { isUrlInSiteScope, normalizeSiteUrl, type SiteScope } from './url.ts';

export interface ResolvedAddress {
    address: string;
    family: 4 | 6;
}

interface TransportResponse {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
    remoteAddress: string;
}

export interface SafeFetchDependencies {
    resolve(hostname: string): Promise<ResolvedAddress[]>;
    request(
        url: URL,
        address: ResolvedAddress,
        options: { timeoutMs: number; maxBytes: number; userAgent: string },
    ): Promise<TransportResponse>;
}

export interface SafeFetchOptions {
    maxRedirects?: number;
    maxBytes?: number;
    timeoutMs?: number;
    userAgent?: string;
}

export interface SafeFetchResult extends TransportResponse {
    requestedUrl: string;
    finalUrl: string;
    redirects: string[];
}

function comparableAddress(address: string) {
    const unscoped = address.split('%')[0].toLowerCase();
    return unscoped.startsWith('::ffff:') ? unscoped.slice(7) : unscoped;
}

export function createPinnedLookup(address: ResolvedAddress) {
    return (
        _hostname: string,
        lookupOptions: { all?: boolean },
        callback: (...args: unknown[]) => void,
    ) => {
        if (lookupOptions?.all) {
            callback(null, [{ address: address.address, family: address.family }]);
            return;
        }
        callback(null, address.address, address.family);
    };
}

async function nodeRequest(
    url: URL,
    address: ResolvedAddress,
    options: { timeoutMs: number; maxBytes: number; userAgent: string },
) {
    return new Promise<TransportResponse>((resolve, reject) => {
        const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            reject(error);
        };
        const req = request(url, {
            method: 'GET',
            headers: {
                accept: 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.9,*/*;q=0.1',
                'accept-encoding': 'identity',
                'user-agent': options.userAgent,
            },
            lookup: createPinnedLookup(address) as never,
            ...(url.protocol === 'https:' ? { servername: url.hostname } : {}),
        }, response => {
            const remoteAddress = response.socket.remoteAddress ?? '';
            if (!isPublicAddress(remoteAddress) || comparableAddress(remoteAddress) !== comparableAddress(address.address)) {
                response.destroy();
                fail(new Error('Connected remote address did not match the vetted public address'));
                return;
            }
            const chunks: Buffer[] = [];
            let length = 0;
            response.on('data', chunk => {
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                length += buffer.length;
                if (length > options.maxBytes) {
                    response.destroy();
                    fail(new Error('Response exceeded the configured size limit'));
                    return;
                }
                chunks.push(buffer);
            });
            response.on('error', fail);
            response.on('end', () => {
                if (settled) return;
                settled = true;
                const headers = Object.fromEntries(Object.entries(response.headers).flatMap(([key, value]) => {
                    if (value === undefined) return [];
                    return [[key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)]];
                }));
                resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks), remoteAddress });
            });
        });
        req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Request timed out')));
        req.on('error', fail);
        req.end();
    });
}

const defaultDependencies: SafeFetchDependencies = {
    resolve: async hostname => (await lookup(hostname, { all: true, verbatim: true })) as ResolvedAddress[],
    request: nodeRequest,
};

function redirectLocation(response: TransportResponse) {
    return response.status >= 300 && response.status < 400 ? response.headers.location : undefined;
}

export async function safeSiteFetch(
    input: string,
    scope: SiteScope,
    dependencies: SafeFetchDependencies = defaultDependencies,
    options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
    const settings = {
        maxRedirects: options.maxRedirects ?? 5,
        maxBytes: options.maxBytes ?? 2_000_000,
        timeoutMs: options.timeoutMs ?? 10_000,
        userAgent: options.userAgent ?? 'SEO-Ops-Center-Crawler/1.0',
    };
    const requestedUrl = normalizeSiteUrl(input);
    let current = requestedUrl;
    const redirects: string[] = [];
    const deadline = Date.now() + settings.timeoutMs;

    for (;;) {
        if (!isUrlInSiteScope(current, scope)) throw new Error('URL is outside the configured site scope');
        const url = new URL(current);
        const addresses = await dependencies.resolve(url.hostname);
        assertPublicAddress(addresses.map(item => item.address));
        const selected = addresses[0];
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('Request timed out');
        const response = await dependencies.request(url, selected, { ...settings, timeoutMs: remainingMs });
        if (!isPublicAddress(response.remoteAddress) || comparableAddress(response.remoteAddress) !== comparableAddress(selected.address)) {
            throw new Error('Connected remote address did not match the vetted public address');
        }
        if (response.body.length > settings.maxBytes) throw new Error('Response exceeded the configured size limit');

        const location = redirectLocation(response);
        if (!location) return { ...response, requestedUrl, finalUrl: current, redirects };
        if (redirects.length >= settings.maxRedirects) throw new Error('Redirect limit exceeded');
        const next = normalizeSiteUrl(new URL(location, current).toString());
        if (!isUrlInSiteScope(next, scope)) throw new Error('Redirect left the configured site scope');
        redirects.push(next);
        current = next;
    }
}
