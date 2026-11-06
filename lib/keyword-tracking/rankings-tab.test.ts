/**
 * Run with: node --import tsx --test lib/keyword-tracking/rankings-tab.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceNav } from '../../components/seo-plan/WorkspaceNav.tsx';
import { RankingsPanel, RankingsTab } from '../../components/workspace/RankingsTab.tsx';
import { keywordTrackingEnabled } from './flag.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function nav(rankings: boolean, active = 'overview') {
    return renderToStaticMarkup(createElement(WorkspaceNav, {
        active,
        vault: false,
        rankings,
        onSelect: () => {},
    }));
}

test('the rankings tab stays hidden for unset and false, and shows beside Search when true', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        assert.equal(nav(keywordTrackingEnabled()).includes('Rankings'), false);

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'false';
        const off = nav(keywordTrackingEnabled(), 'rankings');
        assert.equal(off.includes('Rankings'), false);

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const on = nav(keywordTrackingEnabled(), 'rankings');
        const searchAt = on.indexOf('>Search<');
        const rankingsAt = on.indexOf('>Rankings<');
        const moreAt = on.indexOf('>More<');
        assert.ok(searchAt >= 0 && rankingsAt > searchAt && moreAt > rankingsAt);
        assert.match(on, /aria-selected="true"[^>]*>Rankings</);
        assert.equal(on.includes('Site Inventory'), false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('workspace nav hides rankings unless the caller passes the flag', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, {
        active: 'overview',
        vault: true,
        onSelect: () => {},
    }));
    assert.equal(html.includes('Rankings'), false);
});

test('the rankings tab stays blank when the flag is off', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const html = renderToStaticMarkup(createElement(RankingsTab, {
            organizationId: 'org',
            clientId: 'client',
        }));
        assert.equal(html, '');
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('the rankings tab offers a paste box and lists keywords without rank metrics', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    try {
        const html = renderToStaticMarkup(createElement(RankingsTab, {
            organizationId: 'org',
            clientId: 'client',
        }));
        assert.match(html, /Paste keywords, one per line/);
        assert.match(html, /<textarea/);
        assert.match(html, /Add keywords/);
        assert.equal(html.includes('<table'), false);
        assert.equal(html.includes('Avg position'), false);
        assert.equal(html.includes('impressions'), false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a loaded rankings list shows keywords and the auto note, not a metrics table', () => {
    const empty = renderToStaticMarkup(createElement(RankingsPanel, {
        keywords: [],
        notes: [],
        cap: 50,
        draft: '',
        message: '',
        error: '',
        loading: false,
        busy: false,
        onDraft() {},
        onSubmit() {},
    }));
    assert.match(empty, /No tracked keywords yet/);
    assert.match(empty, /0 of 50/);

    const html = renderToStaticMarkup(createElement(RankingsPanel, {
        keywords: [{ id: 'k1', keyword: 'seo agency', source: 'gsc_promote', createdAt: '2026-11-06T00:00:00Z' }],
        notes: [{ id: 'n1', kind: 'keywords_changed', body: 'Tracked 1 keyword: seo agency.', createdAt: '2026-11-06T00:00:00Z' }],
        cap: 50,
        draft: '',
        message: '',
        error: '',
        loading: false,
        busy: false,
        onDraft() {},
        onSubmit() {},
    }));
    assert.equal(html.includes('No tracked keywords yet'), false);
    assert.match(html, /seo agency/);
    assert.match(html, /Search Insights/);
    assert.match(html, /Keywords changed/);
    assert.match(html, /Tracked 1 keyword: seo agency\./);
    assert.match(html, /1 of 50/);
    assert.equal(html.includes('<table'), false);
    assert.equal(html.includes('Avg position'), false);
});

test('the client workspace gates the rankings surface on the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../nav/staff-shell.ts', import.meta.url), 'utf8');
    assert.match(page, /import \{ keywordTrackingEnabled \} from '@\/lib\/keyword-tracking\/flag'/);
    assert.match(page, /if \(keywordTrackingEnabled\(\)\) knownTabs\.push\('rankings'\)/);
    assert.doesNotMatch(page, /'approvals', 'portal', 'rankings'/);
    assert.doesNotMatch(page, /setActiveTab\('rankings'\)/);
    assert.match(page, /keywordTrackingEnabled\(\) && activeTab === 'rankings' && organization && client\.organizationId === organization\.id && \(\s*<RankingsTab organizationId=\{organization\.id\} clientId=\{client\.id\} \/>/);
    assert.match(shell, /if \(options\.keywordTracking\) search\.push\(link\('rankings', 'Rankings', 'rankings'\)\)/);
});
