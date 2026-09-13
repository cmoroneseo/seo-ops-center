import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware.ts';
import { GET as scriptGet } from '../../app/api/attribution/s.js/route.ts';
import { POST as collect, OPTIONS } from '../../app/api/attribution/collect/route.ts';

const originalFetch = globalThis.fetch;
const env = { ...process.env };
const siteId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const site = { id: siteId, organization_id: 'org-a', client_id: 'client-a', domain: 'example.com', is_active: true };
before(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://attribution-test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});
after(() => {
    globalThis.fetch = originalFetch;
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
        if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
});

test('the exact script and collector paths bypass session middleware for anonymous/auth-cookie requests including OPTIONS', async () => {
    globalThis.fetch = async () => { throw new Error('Public attribution must not refresh authentication'); };
    for (const [path, methods] of [['s.js', ['GET', 'OPTIONS']], ['collect', ['POST', 'OPTIONS']]] as const) {
        for (const method of methods) {
            for (const cookie of ['', 'sb-test-auth-token=ignored']) {
                const response = await middleware(new NextRequest(`https://app.test/api/attribution/${path}`, { method, headers: { cookie } }));
                assert.equal(response.status, 200);
                assert.equal(response.headers.get('x-middleware-next'), '1');
                assert.equal(response.headers.get('location'), null);
            }
        }
    }
    for (const path of ['/api/attribution/private', '/api/attribution/collect/extra', '/workspace/a']) {
        const response = await middleware(new NextRequest(`https://app.test${path}`));
        assert.equal(response.status, 307);
        assert.equal(response.headers.get('location'), 'https://app.test/login');
    }
});

async function trackingPage(storage: Map<string, string>, referrer: string, path: string, search = '', storageBlocked = false) {
    const posted: { url: string; options: RequestInit; events: Record<string, unknown>[] }[] = [];
    const listeners: Record<string, (event?: unknown) => void> = {};
    const windowListeners: Record<string, () => void> = {};
    const script = await (await scriptGet()).text();
    const context = {
        document: {
            currentScript: { src: 'https://app.test/api/attribution/s.js', getAttribute: () => siteId },
            referrer,
            visibilityState: 'hidden',
            addEventListener: (name: string, callback: (event?: unknown) => void) => { listeners[name] = callback; },
        },
        location: { origin: 'https://example.com', pathname: path, search },
        navigator: { userAgent: 'Desktop', sendBeacon: () => { throw new Error('Credentials-bearing Beacon must not be used'); } },
        window: { addEventListener: (name: string, callback: () => void) => { windowListeners[name] = callback; } },
        URLSearchParams,
        get sessionStorage() {
            if (storageBlocked) throw new Error('Storage disabled');
            return { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value) };
        },
        setInterval: () => 1,
        fetch: async (url: string, options: RequestInit) => {
            posted.push({ url, options, events: JSON.parse(options.body as string).events });
            return new Response('{}');
        },
    };
    runInNewContext(script, context);
    return { posted, listeners, windowListeners };
}

test('the real script uses anonymous keepalive fetch and its JSON preflight is accepted', async () => {
    const page = await trackingPage(new Map(), 'https://google.com/', '/services');
    page.listeners.visibilitychange();
    assert.equal(page.posted.length, 1);
    assert.equal(page.posted[0].url, 'https://app.test/api/attribution/collect');
    assert.equal(page.posted[0].options.method, 'POST');
    assert.equal(page.posted[0].options.credentials, 'omit');
    assert.equal(page.posted[0].options.mode, 'cors');
    assert.equal(page.posted[0].options.keepalive, true);
    const preflight = await OPTIONS();
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
    assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /POST/);
    assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /Content-Type/);
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
});

test('real script navigation preserves the initial paid UTMs, landing page and selected HDYHAU radio', async () => {
    const storage = new Map<string, string>();
    const first = await trackingPage(storage, 'https://google.com/', '/services', '?utm_source=google&utm_medium=cpc&utm_campaign=initial');
    first.windowListeners.pagehide();
    const second = await trackingPage(storage, 'https://example.com/services', '/contact', '?utm_medium=organic&utm_campaign=later');
    second.listeners.submit({ target: { tagName: 'FORM', querySelectorAll: (selector: string) => {
        const radios = [{ name: 'how_did_you_hear', value: 'unchecked-first', checked: false },
            { name: 'how_did_you_hear', value: 'selected-answer', checked: true }];
        return selector.includes(':checked') ? radios.filter(radio => radio.checked) : radios;
    } } });
    const conversion = second.posted[0].events[1];
    assert.equal(conversion.event_type, 'form_submit');
    assert.equal(conversion.hdyhau_value, 'selected-answer');
    assert.equal(conversion.landing_page, 'https://example.com/services');
    assert.equal(conversion.initial_referrer, 'https://google.com/');
    assert.equal(conversion.initial_utm_medium, 'cpc');
    assert.equal(conversion.initial_utm_campaign, 'initial');
    assert.equal(conversion.session_id, first.posted[0].events[0].session_id);
});

test('direct sessions stay explicitly direct and blocked sessionStorage does not stop collection', async () => {
    const storage = new Map<string, string>();
    await trackingPage(storage, '', '/');
    const next = await trackingPage(storage, 'https://example.com/', '/contact');
    next.windowListeners.pagehide();
    assert.equal(next.posted[0].events[0].initial_referrer, '');
    const blocked = await trackingPage(new Map(), '', '/', '', true);
    blocked.windowListeners.pagehide();
    assert.equal(blocked.posted.length, 1);
});

function collectorRequest(events: unknown[], headers: Record<string, string> = { origin: 'https://example.com' }) {
    return new NextRequest('https://app.test/api/attribution/collect', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ site_id: siteId, events }) });
}

test('collector sends one atomic exact event batch with server-derived org and first-touch categories', async () => {
    const writes: Record<string, unknown>[][] = [];
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (url.pathname.endsWith('/attribution_sites') && request.method === 'GET') return Response.json(site);
        assert.equal(request.method, 'POST');
        assert.ok(url.pathname.endsWith('/attribution_events'), 'No conversion lookup by visitor or separate conversion writes');
        writes.push(await request.json());
        return new Response(null, { status: 201 });
    };
    const response = await collect(collectorRequest([
        { event_type: 'form_submit', referrer: 'https://example.com/internal', initial_referrer: 'https://google.com/',
            initial_utm_medium: 'cpc', initial_utm_source: 'google', initial_utm_campaign: 'original',
            landing_page: '/services', page_url: '/form', organization_id: 'attacker', source_category: 'attacker' },
        { event_type: 'tel_click', referrer: 'https://example.com/internal', initial_referrer: '', page_url: '/phone' },
    ]));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].map(row => [row.organization_id, row.site_id, row.site_domain, row.source_category, row.page_url]), [
        ['org-a', siteId, 'example.com', 'paid', 'https://example.com/form'],
        ['org-a', siteId, 'example.com', 'direct', 'https://example.com/phone'],
    ]);
    assert.equal(writes[0][0].utm_campaign, 'original');
    assert.equal(writes[0][0].referrer_domain, 'google.com');
});

test('collector fails closed on missing/foreign origins, foreign landing hosts, invalid events and failed storage', async () => {
    let writes = 0;
    globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (request.method === 'GET') return Response.json(site);
        writes++;
        return Response.json({ message: 'database rejected event batch', code: 'P0001' }, { status: 400 });
    };
    for (const headers of [{}, { origin: 'null' }, { origin: 'https://example.com.evil.test' }]) {
        const response = await collect(collectorRequest([{ event_type: 'pageview' }], headers));
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('access-control-allow-origin'), '*');
    }
    assert.equal((await collect(collectorRequest([{ event_type: 'form_submit', landing_page: 'https://other.test/a' }]))).status, 400);
    assert.equal((await collect(collectorRequest([{ event_type: 'attacker' }]))).status, 400);
    assert.equal((await collect(collectorRequest([{ event_type: 'pageview', initial_referrer: {} }]))).status, 400);
    assert.equal(writes, 0);
    const failure = await collect(collectorRequest([{ event_type: 'form_submit' }]));
    assert.equal(failure.status, 500);
    assert.equal(failure.headers.get('access-control-allow-origin'), '*');
    assert.equal(writes, 1);
});
