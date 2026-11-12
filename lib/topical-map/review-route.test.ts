import test from 'node:test';
import assert from 'node:assert/strict';

import { createReviewHandlers, searchGroupsFromFacts, type ReviewFacts, type ReviewRouteDeps } from './review-route.ts';
import type { ReviewEvidence } from './review.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const client = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';

function api(overrides: Partial<ReviewRouteDeps> = {}, facts: ReviewFacts = { connected: true, days: 28, facts: [] }) {
    const calls = { facts: 0 };
    const deps: ReviewRouteDeps = {
        authorize: async clientId => clientId === client
            ? { ok: true, organizationId: org, clientId: client }
            : { ok: false, status: 403, error: 'Forbidden' },
        loadTargetQueries: async () => ['cracked tooth what to do'],
        loadFacts: async () => {
            calls.facts += 1;
            return facts;
        },
        ...overrides,
    };
    return { handlers: createReviewHandlers(deps), calls };
}

const get = (clientId: string) => new Request(`https://app.test/api/topical-map/review?clientId=${clientId}`);

test('another organization cannot read the evidence', async () => {
    const { handlers, calls } = api();
    const response = await handlers.get(get('someone-else'));
    assert.equal(response.status, 403);
    assert.equal(calls.facts, 0);
});

test('returns Search Console evidence for the map’s target searches only', async () => {
    const { handlers } = api({}, {
        connected: true,
        days: 28,
        facts: [
            { date: '2026-11-01', query: 'Cracked tooth what to do', page: 'https://example.com/a', clicks: 2, impressions: 420, position: 14, grain: 'query_page' },
            { date: '2026-11-01', query: 'unrelated', page: 'https://example.com/b', clicks: 2, impressions: 999, position: 3, grain: 'query_page' },
        ],
    });
    const response = await handlers.get(get(client));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as { evidence: ReviewEvidence };
    assert.equal(body.evidence.connected, true);
    assert.equal(body.evidence.days, 28);
    assert.deepEqual(body.evidence.queries.map(query => [query.query, query.impressions]), [['cracked tooth what to do', 420]]);
});

test('also returns every search grouped by intent, for the map check, from the same facts', async () => {
    const fact = (query: string, page: string, impressions: number, position: number) =>
        ({ date: '2026-11-01', query, page, clicks: 1, impressions, position, grain: 'query_page' as const });
    const { handlers, calls } = api({}, {
        connected: true,
        days: 28,
        facts: [
            fact('hardscape contractor', 'https://example.com/', 3000, 50),
            fact('hardscape contractors', 'https://example.com/pavers/', 1498, 56),
            fact('pet turf', 'https://example.com/pets/', 570, 31),
        ],
    });
    const body = await (await handlers.get(get(client))).json() as { evidence: ReviewEvidence };
    assert.equal(calls.facts, 1);
    assert.deepEqual(body.evidence.groups?.map(group => [group.query, group.variants, group.impressions, Math.round(group.position ?? 0), group.page]), [
        ['hardscape contractor', ['hardscape contractors'], 4498, 52, 'https://example.com/'],
        ['pet turf', [], 570, 31, 'https://example.com/pets/'],
    ]);
});

test('searchGroupsFromFacts keeps the biggest groups only', () => {
    const facts = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((query, index) => ({
        date: '2026-11-01', query, page: 'https://example.com/x', clicks: 0, impressions: 10 + index, position: 5, grain: 'query_page' as const,
    }));
    assert.deepEqual(searchGroupsFromFacts(facts, 2).map(group => group.query), ['echo', 'delta']);
});

test('a map with no ideas skips the Search Console read', async () => {
    const { handlers, calls } = api({ loadTargetQueries: async () => [] });
    const body = await (await handlers.get(get(client))).json() as { evidence: ReviewEvidence };
    assert.deepEqual(body.evidence, { connected: false, days: 0, queries: [] });
    assert.equal(calls.facts, 0);
});

test('without a Search Console connection every idea stays without data', async () => {
    const { handlers } = api({}, { connected: false, days: 0, facts: [] });
    const body = await (await handlers.get(get(client))).json() as { evidence: ReviewEvidence };
    assert.equal(body.evidence.connected, false);
    assert.deepEqual(body.evidence.queries, []);
});
