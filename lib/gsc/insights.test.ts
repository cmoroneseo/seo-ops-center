import test from 'node:test';
import assert from 'node:assert/strict';
import { insightsRange, loadHistory, rankingCandidates, safePageUrl, summarizePerformance, type HistoryRow } from './insights';
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
