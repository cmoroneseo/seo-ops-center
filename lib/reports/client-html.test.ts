import test from 'node:test';
import assert from 'node:assert/strict';
import { CLIENT_REPORT_PRINT_CSS, renderClientReportHtml } from './client-html';
import { scottColeReport } from './client-fixture';
import { findClientCopyViolations } from './copy-rules';
import { htmlText, stripAmOnly } from './strip-am-only';

const GSC = ['gsc', 'organic_clicks', 'impressions'] as const;

test('the Scott Cole client document is two Letter pages and contains no AM-only copy', () => {
    const html = renderClientReportHtml(scottColeReport('staff'), { audience: 'client' });
    assert.equal(html.includes('size: Letter'), true);
    assert.equal(html.includes('0.6in'), true);
    assert.equal(html.includes('max-width: 720px'), true);
    assert.equal(html.includes('26px'), true);
    assert.equal((html.match(/data-page="/g) ?? []).length, 2);
    assert.equal(html.includes('No September work is recorded'), false);
    assert.equal(html.includes('AM writes this'), false);
    assert.equal(html.includes('Extend Search history'), false);
    assert.equal(html.includes('37,906'), true);
    assert.equal(html.includes('65'), true);
    assert.equal(html.includes('Eastvale'), true);
    assert.equal(CLIENT_REPORT_PRINT_CSS.includes('.amonly-block'), true);
    assert.deepEqual(findClientCopyViolations(htmlText(html), GSC), []);
});

test('stripping is server-side: the AM sentences exist before the strip and are gone after', () => {
    const staff = renderClientReportHtml(scottColeReport('staff'), { audience: 'staff' });
    assert.equal(staff.includes('No September work is recorded'), true);
    assert.equal(staff.includes('AM writes this'), true);
    const client = stripAmOnly(staff);
    assert.equal(client.includes('No September work is recorded'), false);
    assert.equal(client.includes('AM writes this'), false);
    assert.equal(client.includes('37,906'), true);
});

test('the email body is the summary page only', () => {
    const html = renderClientReportHtml(scottColeReport('client'), { audience: 'client', pages: 'summary' });
    assert.equal((html.match(/data-page="/g) ?? []).length, 1);
    assert.equal(html.includes('Eastvale'), false);
    assert.equal(html.includes('37,906'), true);
});
