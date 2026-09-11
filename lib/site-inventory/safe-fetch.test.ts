import assert from 'node:assert/strict';
import test from 'node:test';

import { safeSiteFetch, type SafeFetchDependencies } from './safe-fetch.ts';
import { configuredSiteScope } from './url.ts';

function dependencies(responses: Array<{
    status: number;
    headers?: Record<string, string>;
    body?: string;
    remoteAddress?: string;
}> = [{ status: 200, body: '<html></html>' }]) {
    const requests: Array<{ url: string; address: string }> = [];
    const deps: SafeFetchDependencies = {
        resolve: async () => [{ address: '8.8.8.8', family: 4 }],
        request: async (url, address) => {
            requests.push({ url: url.toString(), address: address.address });
            const response = responses.shift();
            if (!response) throw new Error('No fixture response');
            return {
                status: response.status,
                headers: response.headers ?? { 'content-type': 'text/html' },
                body: Buffer.from(response.body ?? ''),
                remoteAddress: response.remoteAddress ?? address.address,
            };
        },
    };
    return { deps, requests };
}

test('pins the request to a DNS-vetted public address', async () => {
    const { deps, requests } = dependencies();
    const result = await safeSiteFetch('https://example.com/a', configuredSiteScope('example.com'), deps);
    assert.equal(result.status, 200);
    assert.deepEqual(requests, [{ url: 'https://example.com/a', address: '8.8.8.8' }]);
});

test('rejects mixed public/private DNS answers before transport', async () => {
    const { deps, requests } = dependencies();
    deps.resolve = async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
    ];
    await assert.rejects(safeSiteFetch('https://example.com/', configuredSiteScope('example.com'), deps), /public/i);
    assert.equal(requests.length, 0);
});

test('revalidates and follows an in-scope redirect', async () => {
    const { deps, requests } = dependencies([
        { status: 301, headers: { location: 'https://www.example.com/final' } },
        { status: 200, body: 'done' },
    ]);
    const result = await safeSiteFetch('https://example.com/start', configuredSiteScope('example.com'), deps);
    assert.equal(result.finalUrl, 'https://www.example.com/final');
    assert.deepEqual(result.redirects, ['https://www.example.com/final']);
    assert.equal(requests.length, 2);
});

test('rejects out-of-scope redirect, loops, and unexpected remote address', async () => {
    const outside = dependencies([{ status: 302, headers: { location: 'https://evil.example/a' } }]);
    await assert.rejects(safeSiteFetch('https://example.com/', configuredSiteScope('example.com'), outside.deps), /scope/i);

    const loop = dependencies([{ status: 302, headers: { location: '/again' } }, { status: 302, headers: { location: '/' } }]);
    await assert.rejects(safeSiteFetch('https://example.com/', configuredSiteScope('example.com'), loop.deps, { maxRedirects: 1 }), /redirect/i);

    const rebound = dependencies([{ status: 200, remoteAddress: '127.0.0.1' }]);
    await assert.rejects(safeSiteFetch('https://example.com/', configuredSiteScope('example.com'), rebound.deps), /remote address/i);
});

test('rejects transport bodies beyond the configured byte limit', async () => {
    const { deps } = dependencies([{ status: 200, body: '12345' }]);
    await assert.rejects(safeSiteFetch('https://example.com/', configuredSiteScope('example.com'), deps, { maxBytes: 4 }), /size/i);
});
