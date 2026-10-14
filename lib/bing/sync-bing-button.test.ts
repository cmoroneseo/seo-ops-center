import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { finishBingSync, SyncBingButton } from '../../components/settings/SyncBingButton.tsx';
import { exampleDashboard } from '../agency-dashboard/fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('the sync button is a short label with no card rank', () => {
    for (const variant of ['settings', 'toolbar'] as const) {
        const html = renderToStaticMarkup(createElement(SyncBingButton, { variant }));
        assert.match(html, /Sync Bing now/);
        assert.match(html, /aria-label="Sync Bing now"/);
        assert.doesNotMatch(html, /data-rank/);
        assert.doesNotMatch(html, /apiKey/);
    }
});

test('the dashboard toolbar shows the button only for an admin', () => {
    const hidden = renderToStaticMarkup(createElement(AgencyDashboardView, { model: exampleDashboard() }));
    const shown = renderToStaticMarkup(createElement(AgencyDashboardView, { model: exampleDashboard(), canSyncBing: true }));
    assert.doesNotMatch(hidden, /Sync Bing now/);
    assert.match(hidden, /aria-label="Filters"/);
    assert.match(shown, /Sync Bing now/);
    assert.match(shown, /aria-label="Filters"/);
    assert.doesNotMatch(shown, /data-rank="bing"/);
});

const SYNCED = { sitesMapped: 2, sitesSynced: 1, remaining: 3, errors: [429], skipped: null };

test('a finished sync refreshes, and a skip or a failed POST does not', async () => {
    const original = globalThis.fetch;
    try {
        let calls = 0;
        globalThis.fetch = async () => Response.json(SYNCED);
        const message = await finishBingSync(() => { calls += 1; });
        assert.equal(calls, 1);
        assert.match(message, /Mapped 2/);
        assert.match(message, /Synced 1/);

        globalThis.fetch = async () => Response.json({ ...SYNCED, sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped: 'flag_off' });
        const skipped = await finishBingSync(() => { calls += 1; });
        assert.equal(calls, 1);
        assert.equal(skipped, 'Bing sync is off.');

        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'no' }), { status: 500 });
        const failed = await finishBingSync(() => { calls += 1; });
        assert.equal(calls, 1);
        assert.equal(failed, 'Bing sync did not run.');

        globalThis.fetch = async () => { throw new Error('network'); };
        const thrown = await finishBingSync(() => { calls += 1; });
        assert.equal(calls, 1);
        assert.equal(thrown, 'Bing sync did not run.');
    } finally {
        globalThis.fetch = original;
    }
});

test('the toolbar button refreshes the dashboard after a sync', () => {
    const dashboard = readFileSync(new URL('../../components/agency-dashboard/AgencyDashboard.tsx', import.meta.url), 'utf8');
    const button = readFileSync(new URL('../../components/settings/SyncBingButton.tsx', import.meta.url), 'utf8');
    assert.match(dashboard, /<SyncBingButton variant="toolbar" onSynced=\{onRefresh\} \/>/);
    assert.match(button, /finishBingSync\(onSynced\)/);
    assert.equal(button.split('onSynced?.()').length, 2);
});
