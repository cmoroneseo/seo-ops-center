import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { SyncBingButton } from '../../components/settings/SyncBingButton.tsx';
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
