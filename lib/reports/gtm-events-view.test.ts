import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { GtmEventsReport } from '../../components/reports/GtmEventsReport.tsx';
import { kentinaOctoberFixture } from './gtm-events-fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const forbidden = /\(not set\)|\(other\)|\bNone\b|customEvent:|custom dimension|tagmanager\.readonly/i;

test('the client report hides sentinel labels and shows an em dash for a zero prior month', () => {
    const report = kentinaOctoberFixture();
    report.outbound?.byProperty.push({
        label: '(not set)',
        detail: '(other)',
        destination: 'example.com',
        current: 1,
        prior: 0,
    });
    const html = renderToStaticMarkup(createElement(GtmEventsReport, { report, showChrome: true }));
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
    assert.match(body, /3,010/);
    assert.match(body, /GTM Event Report/);
    assert.match(body, /De Portola Wine Trail/);
    assert.match(body, /—/);
    assert.match(body, /Nov 9, 2026/);
    assert.equal(body.match(forbidden), null);
    assert.equal(html.includes('email_click'), true);
    assert.match(html, /Only events with an October count are listed/);
});

test('public link storage keeps the hash and does not add a raw token column', () => {
    const sql = readFileSync(new URL('../../migrations/122_report_public_links.sql', import.meta.url), 'utf8');
    assert.match(sql, /token_hash text not null/);
    assert.equal(/^\s*token text/m.test(sql), false);
    assert.match(sql, /revoke all on public\.report_public_links from public, anon, authenticated/);
    assert.match(sql, /NOT APPLIED/);
});
