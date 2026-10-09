import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleReportSnapshot, chooseReportSnapshot, contentHash, gscMonthReadout, type SnapshotInput } from './versions';

function input(patch: Partial<SnapshotInput> = {}): SnapshotInput {
    return {
        reportId: '66666666-6666-4666-8666-666666666666',
        organizationId: '11111111-1111-4111-8111-111111111111',
        clientId: '33333333-3333-4333-8333-333333333333',
        reportMonth: '2026-09',
        title: 'September',
        executiveSummary: 'Google showed the business 37,906 times.',
        recommendations: 'Keep the Eastvale page.',
        sections: { version: 2, blocks: [{ id: 'ranks', type: 'keyword_rankings_table', props: {} }, { id: 'note', type: 'text', props: { text: '65 clicks.' } }] },
        capturedAt: '2026-10-08T17:00:00.000Z',
        reason: 'approval',
        correctionNote: null,
        amNote: null,
        metrics: [{
            source: 'gsc',
            metricMonth: '2026-09',
            data: { organic_clicks: 65, impressions: 37906, traffic: 999 },
            provenance: { finality: { final: true } },
            sourceType: 'auto',
            updatedAt: '2026-10-02T00:00:00.000Z',
        }, {
            source: 'gbp',
            metricMonth: '2026-09',
            data: { calls: null, direction_requests: 0 },
            provenance: null,
            sourceType: 'manual',
            updatedAt: null,
        }],
        gscDays: [],
        gscFinal: true,
        ledgerRows: [{
            id: 'row',
            title: 'Chino page',
            shippedOn: '2026-09-12',
            publishedUrl: 'https://example.com/chino',
            verdict: 'inconclusive',
            chip: 'Inconclusive',
            detail: 'Inconclusive: no 28-day baseline before Sep 12.',
            footnote: null,
        }],
        ...patch,
    };
}

test('the hash ignores key order and a missing metric stays missing', () => {
    const snapshot = assembleReportSnapshot(input());
    const reordered = { title: snapshot.title, schemaVersion: snapshot.schemaVersion, ...snapshot };
    assert.equal(contentHash(snapshot), contentHash(reordered));
    const gbp = snapshot.metrics.find(row => row.source === 'gbp');
    assert.equal(gbp?.data.calls, null);
    assert.equal(gbp?.data.direction_requests, 0);
    assert.equal(snapshot.metrics.find(row => row.source === 'gsc')?.data.traffic, undefined);
    const calls = snapshot.receipts.find(row => row.title === 'Call-button taps');
    const directions = snapshot.receipts.find(row => row.title === 'Directions');
    assert.equal(calls?.value, null);
    assert.equal(calls?.display, '—');
    assert.equal(directions?.value, 0);
    assert.equal(directions?.display, '0');
});

test('a saved day of zeros is a real zero, and a missing day is not filled in', () => {
    const readout = gscMonthReadout('2026-09', [
        { date: '2026-09-01', isIncomplete: false, property: { clicks: 0, impressions: 0 } },
    ]);
    assert.equal(readout.final, false);
    assert.equal(readout.clicks, 0);
    assert.equal(readout.impressions, 0);
    assert.equal(readout.series[0].clicks, 0);
    assert.equal(readout.series[1].present, false);
    assert.equal(readout.series[1].clicks, null);
    assert.equal(readout.series.length, 30);
});

test('the portal payload drops rank tables and shows the account-manager note', () => {
    const snapshot = assembleReportSnapshot(input({ amNote: 'No new pages this month.' }));
    const blocks = (snapshot.portal.sections as { blocks: { type: string }[] }).blocks;
    assert.equal(blocks.some(block => block.type === 'keyword_rankings_table'), false);
    assert.match(String(snapshot.portal.executiveSummary), /What we did/);
    assert.match(String(snapshot.portal.executiveSummary), /No new pages/);
    assert.equal(snapshot.copy.executiveSummary.includes('What we did'), false);
    assert.equal(snapshot.ledgerRows[0]?.title, 'Chino page');
});

test('an approved snapshot wins over a later live capture', () => {
    assert.deepEqual(chooseReportSnapshot({ clicks: 65 }, { clicks: 99 }), { clicks: 65 });
    assert.deepEqual(chooseReportSnapshot(null, { clicks: 99 }), { clicks: 99 });
});
