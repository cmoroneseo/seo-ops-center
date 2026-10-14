import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { exampleDashboard } from './fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const model = exampleDashboard();

function render(view: 'grid' | 'list' = 'grid'): string {
    return renderToStaticMarkup(createElement(AgencyDashboardView, { model, initialView: view }));
}

test('the grid shows honest gaps, the color signal, and the detail links', () => {
    const html = render();
    assert.match(html, /data-dashboard="agency"/);
    assert.match(html, />Dashboard</);
    assert.match(html, /Northline Plumbing/);
    assert.match(html, /Harbor Dental/);
    assert.match(html, /of 6 clients/);
    assert.match(html, /vs /);
    assert.match(html, /imported /);
    assert.match(html, /Not synced/);
    assert.match(html, /No data in this range/);
    assert.match(html, /emergency plumber/);
    assert.match(html, /Search Insights/);
    assert.match(html, /SEO Plan/);
    assert.match(html, /Open in GSC/);
    assert.match(html, /href="\/workspace\/north\?tab=insights"/);
    assert.match(html, /href="\/workspace\/north\?tab=campaign"/);
    assert.match(html, /Month 3/);
    assert.match(html, /data-tone="down"/);
    assert.match(html, /data-tone="up"/);
    assert.match(html, /aria-label="Color signal"/);
    assert.match(html, /Biggest declines/);
    assert.equal(html.includes('>0<'), false);
    const fresh = html.slice(html.indexOf('Fresh Start Co'), html.indexOf('Fresh Start Co') + 500);
    assert.match(fresh, /Not synced/);
    assert.match(fresh, /—/);
});

test('the list view is a table of the same clients', () => {
    const html = render('list');
    assert.match(html, /<table/);
    assert.match(html, />Clicks</);
    assert.match(html, />Impressions</);
    assert.match(html, />Position</);
    assert.match(html, /Northline Plumbing/);
    assert.match(html, /Not synced/);
    assert.match(html, /Search Insights/);
});
