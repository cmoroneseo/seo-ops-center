import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceIsComplete, filterOverlapCandidates, filterPageCandidates, filterRankingCandidates, filterVisibilityCandidates, insightsRange, loadHistory, loadSearchInsights, parseSearchInsightsAggregate, rankingCandidates, safePageUrl, summarizePerformance, type Candidate, type HistoryDay, type HistoryRow, type OverlapCandidate, type PageCandidate } from './insights';
const rows = (query = 'backyard putting green', page = 'https://example.com/service'): HistoryRow[] => [1, 2, 3].map(id => ({ id, dayId: String(id), query, page, clicks: 1, impressions: 50, position: 8 }));
test('performance weights position by impressions and handles zero demand', () => {
    assert.deepEqual(summarizePerformance([]), { clicks: 0, impressions: 0, ctr: null, position: null });
    const values = rows(); values[0].impressions = 100; values[0].position = 2;
    assert.equal(summarizePerformance(values).position, 5);
    assert.equal(summarizePerformance(values).ctr, 3 / 200);
});
test('ranking candidates require repeated evidence and suppress brand and utility pages', () => {
    assert.equal(rankingCandidates(rows(), 'Ecoworkz').length, 1);
    assert.equal(rankingCandidates(rows('Eco Workz installation'), 'Ecoworkz').length, 0);
    assert.equal(rankingCandidates(rows('service', 'https://example.com/terms-of-use'), '').length, 0);
    assert.equal(rankingCandidates(rows().slice(0, 2), '').length, 0);
    assert.equal(rankingCandidates(rows().map(row => ({ ...row, impressions: 10 })), '').length, 0);
    assert.equal(rankingCandidates(rows().map(row => ({ ...row, position: 2 })), '').length, 0);
    assert.equal(safePageUrl('javascript:alert(1)'), undefined);
});
test('seven-day range ends at finalized Pacific date', () => {
    assert.deepEqual(insightsRange(7, new Date('2026-09-11T00:00:00Z')), { start: '2026-09-01', end: '2026-09-07' });
});
test('loader follows pagination and pins exact property', async () => {
    const urls: string[] = [];
    const result = await loadHistory('client', { start: '2026-09-01', end: '2026-09-07' }, 'query_page', new AbortController().signal, async url => {
        urls.push(String(url));
        return Response.json({ property: 'sc-domain:example.com', days: [], rows: [rows()[urls.length - 1]], nextOffset: urls.length === 1 ? 500 : null });
    });
    assert.equal(result.rows.length, 2); assert.equal(result.truncated, false);
    assert.match(urls[1], /property=sc-domain%3Aexample.com/);
});
test('loader rejects changing snapshots and login HTML instead of showing false zeros', async () => {
    let calls = 0;
    await assert.rejects(loadHistory('client', { start: '', end: '' }, 'query_page', new AbortController().signal, async () => Response.json({ property: 'same', days: [{ id: ++calls }], rows: [], nextOffset: calls === 1 ? 500 : null })), /changed/);
    await assert.rejects(loadHistory('client', { start: '', end: '' }, 'property', new AbortController().signal, async () => new Response('<html>login</html>')), /session/);
});
test('loader marks bounded reads partial and rejects repeated rows', async () => {
    let calls = 0;
    const result = await loadHistory('client', { start: '', end: '' }, 'query_page', new AbortController().signal, async () => Response.json({ property: 'same', days: [], rows: [{ ...rows()[0], id: ++calls }], nextOffset: calls * 500 }));
    assert.equal(calls, 40); assert.equal(result.truncated, true);
    await assert.rejects(loadHistory('client', { start: '', end: '' }, 'query_page', new AbortController().signal, async () => Response.json({ property: 'same', days: [], rows: [rows()[0]], nextOffset: 500 })), /changed/);
});

test('Search Insights loader gets the complete server aggregate in one request', async () => {
    const urls: string[] = [];
    const payload = {
        property: 'sc-domain:example.com', start: '2026-09-01', end: '2026-09-07',
        days: [], missingDates: [], propertyRows: [], queryPageRollups: [], pageRollups: [], visibilityRollups: [], overlapRollups: [],
        expandedEvidenceAvailable: true,
        coverageNote: 'Observed top rows only.',
    };
    const result = await loadSearchInsights('client', { start: payload.start, end: payload.end }, new AbortController().signal, async url => {
        urls.push(String(url));
        return Response.json(payload);
    });
    assert.deepEqual(result, payload);
    assert.deepEqual(urls, ['/api/integrations/google/gsc/insights?clientId=client&start=2026-09-01&end=2026-09-07']);
});

test('Search Insights loader preserves session and API failure states', async () => {
    const signal = new AbortController().signal;
    await assert.rejects(loadSearchInsights('client', { start: '', end: '' }, signal, async () => new Response('<html>login</html>')), /session has expired/);
    await assert.rejects(loadSearchInsights('client', { start: '', end: '' }, signal, async () => Response.json({ error: 'Unable to aggregate evidence' }, { status: 500 })), /Unable to aggregate evidence/);
});

test('server rollups still receive client-specific brand and utility filtering', () => {
    const candidate = (query: string, page: string, impressions: number): Candidate => ({ query, page, impressions, clicks: 1, position: 8, ctr: 0.01, observedDays: 3 });
    const result = filterRankingCandidates([
        candidate('patio contractor', 'https://example.com/patios', 120),
        candidate('Eco Workz landscaping', 'https://example.com/', 400),
        candidate('legal page', 'https://example.com/privacy-policy', 500),
        candidate('invalid URL', 'javascript:alert(1)', 600),
        candidate('putting green', 'https://example.com/greens', 300),
    ], 'Ecoworkz');
    assert.deepEqual(result.map(item => item.query), ['putting green', 'patio contractor']);
});

test('database aggregate payload fails closed when its shape is invalid', () => {
    const valid = { days: [], propertyRows: [], queryPageRollups: [], pageRollups: [], visibilityRollups: [], overlapRollups: [] };
    assert.deepEqual(parseSearchInsightsAggregate(valid), { ...valid, expandedEvidenceAvailable: true });
    assert.throws(() => parseSearchInsightsAggregate({ days: [], propertyRows: [] }), /Invalid Search Insights aggregate/);
    assert.deepEqual(parseSearchInsightsAggregate({ days: [], propertyRows: [], queryPageRollups: [] }), {
        days: [], propertyRows: [], queryPageRollups: [], pageRollups: [], visibilityRollups: [], overlapRollups: [], expandedEvidenceAvailable: false,
    });
    assert.throws(() => parseSearchInsightsAggregate({ ...valid, overlapRollups: undefined }), /Invalid Search Insights aggregate/);
    assert.throws(() => parseSearchInsightsAggregate({ ...valid, days: [{}] }), /Invalid Search Insights aggregate/);
    assert.throws(() => parseSearchInsightsAggregate({ ...valid, queryPageRollups: [{ query: 'x', page: 'https://example.com', clicks: 1, impressions: -1, position: 8, ctr: 0, observedDays: 3 }] }), /Invalid Search Insights aggregate/);
});

test('page evidence excludes unsafe and utility URLs and orders observed demand', () => {
    const page = (url: string, impressions: number): PageCandidate => ({ page: url, impressions, clicks: 2, position: 18, ctr: 0.02, observedDays: 4 });
    const result = filterPageCandidates([
        page('https://example.com/services/patios', 300),
        page('javascript:alert(1)', 900),
        page('https://example.com/privacy-policy', 800),
        page('https://example.com/services/putting-greens', 600),
    ]);
    assert.deepEqual(result.map(item => item.page), [
        'https://example.com/services/putting-greens',
        'https://example.com/services/patios',
    ]);
});

test('deeper visibility evidence keeps only safe nonbrand query and page pairs', () => {
    const candidate = (query: string, page: string, impressions: number): Candidate => ({ query, page, impressions, clicks: 1, position: 28, ctr: 0.01, observedDays: 3 });
    const result = filterVisibilityCandidates([
        candidate('putting green installer', 'https://example.com/greens', 120),
        candidate('Ecoworkz landscaping', 'https://example.com/', 500),
        candidate('patio contractor', 'https://example.com/terms-of-use', 400),
        candidate('landscape design', 'https://example.com/design', 300),
    ], 'Ecoworkz');
    assert.deepEqual(result.map(item => item.query), ['landscape design', 'putting green installer']);
});

test('overlap evidence requires two retained URLs and recomputes totals after exclusions', () => {
    const page = (url: string, impressions: number, clicks = 1, observedDays = 3): Candidate => ({ query: 'landscape design', page: url, impressions, clicks, position: 24, ctr: clicks / impressions, observedDays });
    const overlap: OverlapCandidate = {
        query: 'landscape design', clicks: 8, impressions: 250, position: 24, ctr: 8 / 250, observedDays: 8,
        pages: [page('https://example.com/design', 80, 3), page('https://example.com/landscaping', 70, 4), page('https://example.com/privacy-policy', 100, 1, 8)],
    };
    const result = filterOverlapCandidates([
        overlap,
        { ...overlap, query: 'Ecoworkz landscaping' },
        { ...overlap, query: 'single safe page', pages: [page('https://example.com/design', 80), page('javascript:alert(1)', 200)] },
    ], 'Ecoworkz');
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
        query: 'landscape design', clicks: 7, impressions: 150, position: 24, ctr: 7 / 150, observedDays: 3,
        pages: [page('https://example.com/design', 80, 3), page('https://example.com/landscaping', 70, 4)],
    });
});

test('page and query evidence honor their own import caps', () => {
    const day = (pageLimited: boolean, queryLimited: boolean): HistoryDay => ({ id: 'day', date: '2026-09-01', importedAt: '2026-09-05T00:00:00Z', pageLimited, queryLimited });
    assert.equal(evidenceIsComplete([day(false, false)], [], 'page'), true);
    assert.equal(evidenceIsComplete([day(true, false)], [], 'page'), false);
    assert.equal(evidenceIsComplete([day(false, true)], [], 'query'), false);
    assert.equal(evidenceIsComplete([day(true, false)], [], 'query'), true);
    assert.equal(evidenceIsComplete([day(false, false)], ['2026-09-02'], 'page'), false);
});
