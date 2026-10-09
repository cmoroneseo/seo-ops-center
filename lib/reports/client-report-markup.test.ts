import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientReport } from '../../components/client-report/ClientReport.tsx';
import { scottColeReport } from './client-fixture';
import { findClientCopyViolations } from './copy-rules';
import { htmlText } from './strip-am-only';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const GSC = ['gsc', 'organic_clicks', 'impressions'] as const;

test('the client component renders the fixture without AM copy or banned words', () => {
    const html = renderToStaticMarkup(React.createElement(ClientReport, { model: scottColeReport('client'), audience: 'client' }));
    assert.equal(html.includes('37,906'), true);
    assert.equal(html.includes('No September work is recorded'), false);
    assert.equal(html.includes('AM writes this'), false);
    assert.equal(html.includes('Extend Search history'), false);
    assert.equal(html.includes('August is only partly covered'), true);
    assert.equal((html.match(/data-page="/g) ?? []).length, 2);
    assert.deepEqual(findClientCopyViolations(htmlText(html), GSC), []);
});

test('the renderer source stays on the client block allowlist', () => {
    const component = readFileSync(new URL('../../components/client-report/ClientReport.tsx', import.meta.url), 'utf8');
    const portal = readFileSync(new URL('../../components/portal/PortalPages.tsx', import.meta.url), 'utf8');
    const loader = readFileSync(new URL('./client-report-load.ts', import.meta.url), 'utf8');
    for (const banned of ['keyword_rankings', 'grid_comparison', 'spot_check', 'share_bar', 'modeled_traffic']) {
        assert.equal(component.includes(banned), false, banned);
    }
    assert.equal(portal.includes('searchReportingEnabled'), true);
    assert.equal(portal.includes('ClientReport'), true);
    assert.equal(loader.includes(".eq('client_id', contact.clientId)"), true);
    assert.equal(loader.includes(".eq('organization_id', contact.organizationId)"), true);
});
