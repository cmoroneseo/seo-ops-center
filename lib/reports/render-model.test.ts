import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_BLOCK_KINDS } from './client-blocks';
import { scottColeReport, scottColeSnapshot } from './client-fixture';
import { findClientCopyViolations } from './copy-rules';
import {
    clientReportFromSnapshot,
    everyBlockKindIsAllowed,
    formatClientCount,
    headlineRepeatedLater,
    partialMonthTooltip,
    renderedStrings,
    type ClientBlock,
    type Piece,
} from './render-model';

const GSC = ['gsc', 'organic_clicks', 'impressions'] as const;

function hero(model: { summary: ClientBlock[] }) {
    const block = model.summary.find(item => item.kind === 'hero');
    assert.ok(block && block.kind === 'hero');
    return block;
}

function glance(model: { summary: ClientBlock[] }) {
    const block = model.summary.find(item => item.kind === 'at_a_glance');
    assert.ok(block && block.kind === 'at_a_glance');
    return block;
}

function valueDisplay(pieces: Piece[], index: number) {
    const values = pieces.filter(piece => piece.kind === 'value');
    assert.equal(values[index]?.kind, 'value');
    return values[index].kind === 'value' ? values[index].display : '';
}

test('the Scott Cole fixture is month one, with an em dash for missing calls and no invented zero', () => {
    const model = scottColeReport('client');
    const opening = hero(model);
    assert.equal(opening.lede, "This is your first report built on Google's own data, so there's nothing to compare with yet. October's report will show what changed.");
    assert.equal(valueDisplay(opening.pieces, 0), '37,906');
    assert.equal(valueDisplay(opening.pieces, 1), '65');
    const reaching = glance(model).rows.find(row => row.question === 'Are they reaching out?');
    assert.ok(reaching);
    assert.match(reaching.pieces.map(piece => piece.kind === 'text' ? piece.text : piece.display).join(''), /We can't see phone calls/);
    assert.equal(formatClientCount(null), '—');
    assert.equal(formatClientCount(0), '0');
    assert.equal(model.detail.some(block => block.kind === 'what_changed'), false);
    assert.equal(glance(model).rows.some(row => row.id === 'did'), false);
});

test('a missing impression is an em dash, and a real zero stays zero', () => {
    const missingSnapshot = scottColeSnapshot();
    const missingMetrics = missingSnapshot.metrics as Array<{ data: { impressions: number | null } }>;
    missingMetrics[0].data.impressions = null;
    const missing = clientReportFromSnapshot(missingSnapshot);
    assert.equal(valueDisplay(hero(missing!).pieces, 0), '—');

    const zeroSnapshot = scottColeSnapshot();
    const zeroMetrics = zeroSnapshot.metrics as Array<{ data: { impressions: number | null } }>;
    zeroMetrics[0].data.impressions = 0;
    const zero = clientReportFromSnapshot(zeroSnapshot);
    assert.equal(valueDisplay(hero(zero!).pieces, 0), '0');
});

test('headline numbers are not repeated after At a glance, and modeled traffic never renders', () => {
    const model = scottColeReport('staff');
    assert.deepEqual(headlineRepeatedLater(model), []);
    const snapshot = scottColeSnapshot();
    const metrics = snapshot.metrics as unknown[];
    metrics.push({ source: 'ga4', metricMonth: '2026-09', data: { organic_sessions: 99999 } });
    const next = clientReportFromSnapshot(snapshot);
    assert.equal(JSON.stringify(next).includes('99999'), false);
});

test('partial months are disabled with the review tooltip, and internal chores never reach the client', () => {
    const model = scottColeReport('client');
    const august = model.switcher.find(month => month.month === '2026-08');
    assert.ok(august);
    assert.equal(august.disabled, true);
    assert.equal(august.label, 'Aug');
    assert.equal(august.tooltip, partialMonthTooltip('August'));
    assert.equal(renderedStrings(model).some(text => /16 months|extend search history/i.test(text)), false);
    assert.equal(model.detail.some(block => block.kind === 'whats_next'), false);
    assert.equal(renderedStrings(scottColeReport('staff')).some(text => /AM writes this/.test(text)), true);
});

test('every rendered string of the fixture passes the client copy lint', () => {
    for (const audience of ['client', 'staff'] as const) {
        const model = scottColeReport(audience);
        for (const sentence of renderedStrings(model)) {
            assert.deepEqual(findClientCopyViolations(sentence, GSC), [], sentence);
        }
        for (const block of [...model.summary, ...model.detail]) {
            const pieces = piecesIn(block);
            for (const piece of pieces) {
                if (piece.kind !== 'value') continue;
                const receiptText = [piece.receipt.title, piece.receipt.freshness, piece.receipt.source, piece.receipt.dates, piece.receipt.note ?? ''].join('. ');
                assert.deepEqual(findClientCopyViolations(receiptText, piece.receipt.metricSources), [], receiptText);
            }
        }
    }
});

test('client blocks are the allowlist', () => {
    const model = scottColeReport('client');
    assert.equal(everyBlockKindIsAllowed(model), true);
    for (const block of [...model.summary, ...model.detail]) assert.ok(CLIENT_BLOCK_KINDS.includes(block.kind));
    const serialized = JSON.stringify(model).toLowerCase();
    for (const banned of ['keyword_rankings_table', 'grid_comparison', 'spot_check', 'modeled_traffic', 'share_bar']) {
        assert.equal(serialized.includes(banned), false, banned);
    }
});

test('hours are stripped from shipped work, and a prior month can show a struck comparison', () => {
    const snapshot = scottColeSnapshot();
    snapshot.ledgerRows = [{ title: 'Service page', publishedUrl: 'https://example.com/service', shippedOn: '2026-09-12', verdict: 'Shipped after 2 hours of writing.', detail: 'Live on the site.' }];
    snapshot.clientReport = {
        ...(snapshot.clientReport as Record<string, unknown>),
        comparablePrior: true,
        comparison: { priorShown: 31000, reason: 'The website was down for two days.' },
    };
    const model = clientReportFromSnapshot(snapshot);
    assert.ok(model);
    assert.equal(hero(model).lede, null);
    assert.equal(hero(model).comparison?.prior, '31,000');
    assert.equal(model.detail.some(block => block.kind === 'what_changed'), true);
    const work = model.detail.find(block => block.kind === 'work_completed');
    assert.ok(work && work.kind === 'work_completed');
    assert.equal(JSON.stringify(work).includes('2 hours'), false);
});

function piecesIn(block: ClientBlock): Piece[] {
    switch (block.kind) {
        case 'hero':
            return block.pieces;
        case 'at_a_glance':
            return block.rows.flatMap(row => row.pieces);
        case 'where_you_show_up':
            return block.cities.flatMap(city => [...city.mapPieces, ...city.websitePieces]);
        default:
            return [];
    }
}
