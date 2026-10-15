import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaignDeskClient, CampaignDeskRequestError } from './client.ts';
import { parseForecastPayload } from './contract.ts';

const TOKEN = 'synthetic-campaign-desk-token';
const RUN = '11111111-1111-4111-8111-111111111111';

function payload() {
    return parseForecastPayload({
        runId: RUN,
        source: 'seo-ops-center',
        organizationId: '22222222-2222-4222-8222-222222222222',
        weeks: [{
            weekStart: '2026-10-12',
            basis: 'actual',
            allocations: [],
        }],
    });
}

test('the client sends the bearer secret and never copies it into an error', async () => {
    const calls: { url: string; method: string; authorization: string | null; body: string | null }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
            url: String(url),
            method: init?.method ?? 'GET',
            authorization: headers.get('authorization'),
            body: typeof init?.body === 'string' ? init.body : null,
        });
        if (String(url).endsWith('/v1/people')) {
            return new Response(JSON.stringify({
                people: [{ id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' }],
            }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: 'unavailable', message: TOKEN }), { status: 500 });
    };
    const client = createCampaignDeskClient({
        baseUrl: 'https://desk.example.test',
        token: TOKEN,
        fetch: fetchImpl,
    });

    const people = await client.listPeople();
    assert.equal(people[0].id, 'desk_carlos');
    await assert.rejects(client.upsertRun(payload()), (error: unknown) => {
        assert.ok(error instanceof CampaignDeskRequestError);
        assert.equal(error.message.includes(TOKEN), false);
        assert.match(error.message, /could not complete the sync/i);
        return true;
    });
    assert.equal(calls[0].url, 'https://desk.example.test/v1/people');
    assert.equal(calls[0].authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[1].method, 'PUT');
    assert.equal(calls[1].url, `https://desk.example.test/v1/forecast-runs/${RUN}`);
    assert.equal(calls[1].body?.includes(TOKEN), false);
});

test('delete and idempotent accept are read from the response', async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
        if (init?.method === 'DELETE') {
            return new Response(JSON.stringify({ runId: RUN, status: 'deleted', idempotent: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ runId: RUN, status: 'accepted', idempotent: false }), { status: 200 });
    };
    const client = createCampaignDeskClient({
        baseUrl: 'https://desk.example.test/',
        token: TOKEN,
        fetch: fetchImpl,
    });
    assert.deepEqual(await client.upsertRun(payload()), { runId: RUN, idempotent: false });
    assert.deepEqual(await client.deleteRun(RUN), { runId: RUN, idempotent: true });
});
