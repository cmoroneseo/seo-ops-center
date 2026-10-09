import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeywordResearchHandler, loadKeywordResearchTarget } from './keyword-research-route';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function handler(fetchImpl: typeof fetch, role: 'member' | 'viewer' = 'member') {
    return createKeywordResearchHandler({
        requireClientOrgMember: async (clientId) => clientId === client
            ? { ok: true, userId: 'user', organizationId: org, clientId: client, role }
            : { ok: false, status: 403, error: 'Forbidden' },
        loadKey: async () => 'test-key',
        loadTarget: async () => ({ domain: 'client.example', siteUrl: 'sc-domain:gsc.example' }),
        fetch: fetchImpl,
    });
}

test('a client in another organization never reaches Ahrefs', async () => {
    let called = false;
    const api = handler(async () => { called = true; return Response.json({}); });
    const response = await api.GET(new Request(`https://app.test/api/campaign/keyword-research?clientId=${foreign}&mode=domain`));
    assert.equal(response.status, 403);
    assert.equal(called, false);
});

test('competitor hosts are normalized and rejected when they are not hostnames', async () => {
    const api = handler(async () => Response.json({ keywords: [] }));
    assert.equal((await api.GET(new Request(`https://app.test/api/campaign/keyword-research?clientId=${client}&mode=competitor&competitor=not a host`))).status, 400);
    const response = await api.GET(new Request(`https://app.test/api/campaign/keyword-research?clientId=${client}&mode=competitor&competitor=https://Rival.Example/path`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).domain, 'rival.example');
});

test('missing keyword stats stay null and an upstream failure hides the response body', async () => {
    const ok = handler(async () => Response.json({ keywords: [{ keyword: 'seo', keyword_difficulty: 12 }] }));
    const body = await (await ok.GET(new Request(`https://app.test/api/campaign/keyword-research?clientId=${client}&mode=domain`))).json();
    assert.equal(body.keywords[0].volume, null);
    assert.equal(body.keywords[0].traffic, null);
    assert.equal(body.keywords[0].difficulty, 12);
    assert.equal(body.domain, 'client.example');
    const failed = handler(async () => new Response('secret upstream body', { status: 500 }));
    const response = await failed.GET(new Request(`https://app.test/api/campaign/keyword-research?clientId=${client}&mode=domain`));
    assert.equal(response.status, 502);
    const error = await response.json();
    assert.equal(error.error, 'Ahrefs request failed (HTTP 500)');
    assert.doesNotMatch(JSON.stringify(error), /secret upstream/);
});

test('the domain loader reads clients.domain and never website_url', async () => {
    const selected: string[] = [];
    const admin = {
        from(table: string) {
            const api = {
                select(columns: string) { selected.push(`${table}:${columns}`); return api; },
                eq() { return api; },
                async maybeSingle() {
                    return table === 'clients'
                        ? { data: { domain: 'from-column.example' }, error: null }
                        : { data: { credentials: { site_url: 'sc-domain:fallback.example' } }, error: null };
                },
            };
            return api;
        },
    };
    const target = await loadKeywordResearchTarget(client, org, admin as never);
    assert.deepEqual(selected, ['clients:domain', 'client_integrations:credentials']);
    assert.equal(selected.some(item => item.includes('website_url')), false);
    assert.equal(target.domain, 'from-column.example');
});
