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
import { rankingsDisplayRows } from './rankings.ts';
import type { KeywordGscWindow } from './gsc-read.ts';

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

function measured(position: number, clicks: number, impressions: number, bestUrl: string): KeywordGscWindow {
    return { status: 'measured', clicks, impressions, avgPosition: position, bestUrl };
}

function unmeasured(): KeywordGscWindow {
    return { status: 'not measurable', clicks: null, impressions: null, avgPosition: null, bestUrl: null };
}

test('a loaded rankings list shows the GSC table, bands, and change without zeroing a missing window', () => {
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
    assert.equal(empty.includes('<table'), false);

    const keywords = [
        { id: 'quiet', keyword: 'quiet term', source: 'gsc_promote' as const, createdAt: '2026-11-06T00:00:00Z' },
        { id: 'meg', keyword: 'digital marketing agency', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
        { id: 'missing', keyword: 'never returned', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
    ];
    const rows = rankingsDisplayRows(keywords, [
        {
            id: 'meg',
            keyword: 'digital marketing agency',
            normalizedKey: 'digital marketing agency',
            current: measured(25, 2, 51, 'https://www.marketingempiregroup.com/'),
            compare: measured(33.6, 0, 399, 'https://www.marketingempiregroup.com/'),
        },
        {
            id: 'quiet',
            keyword: 'quiet term',
            normalizedKey: 'quiet term',
            current: measured(8, 0, 12, 'https://www.marketingempiregroup.com/seo-services'),
            compare: unmeasured(),
        },
        {
            id: 'missing',
            keyword: 'never returned',
            normalizedKey: 'never returned',
            current: unmeasured(),
            compare: unmeasured(),
        },
    ]);
    const html = renderToStaticMarkup(createElement(RankingsPanel, {
        keywords,
        notes: [{ id: 'n1', kind: 'keywords_changed', body: 'Tracked 1 keyword: seo agency.', createdAt: '2026-11-06T00:00:00Z' }],
        rows,
        cap: 50,
        draft: '',
        message: '',
        error: '',
        periodLabel: 'Last 28 days · Oct 1 – Oct 28, 2026',
        compareLabel: 'Sep 3 – Sep 30, 2026',
        loading: false,
        busy: false,
        onDraft() {},
        onSubmit() {},
    }));
    assert.equal(html.includes('No tracked keywords yet'), false);
    assert.match(html, /Average Google position, all locations and devices/);
    assert.equal(html.includes('GSC avg position'), false);
    assert.match(html, /Last 28 days · Oct 1 – Oct 28, 2026/);
    assert.match(html, /vs Sep 3 – Sep 30, 2026/);
    assert.match(html, /Not measurable keywords are not in a band/);
    assert.match(html, /<table/);
    assert.match(html, /Keywords changed/);
    assert.match(html, /3 of 50/);

    const quiet = html.slice(html.indexOf('data-keyword="quiet term"'), html.indexOf('data-keyword="digital marketing agency"'));
    const meg = html.slice(html.indexOf('data-keyword="digital marketing agency"'), html.indexOf('data-keyword="never returned"'));
    const missing = html.slice(html.indexOf('data-keyword="never returned"'));
    assert.match(quiet, /data-change="New"/);
    assert.match(quiet, /data-band="4–10"/);
    assert.match(quiet, /data-metric="position">8\.0/);
    assert.match(quiet, /data-metric="clicks">0</);
    assert.match(quiet, /data-metric="impressions">12</);
    assert.match(meg, /data-change="Improved"/);
    assert.match(meg, /data-band="21–50"/);
    assert.match(meg, /data-metric="position">25\.0/);
    assert.match(meg, /data-metric="clicks">2</);
    assert.match(meg, /data-metric="impressions">51</);
    assert.equal(meg.includes('href="https://www.marketingempiregroup.com/"'), true);
    assert.match(missing, /data-change="none"/);
    assert.match(missing, /data-band="none"/);
    assert.match(missing, /data-metric="position">not measurable/);
    assert.match(missing, /data-metric="clicks">not measurable/);
    assert.match(missing, /data-metric="impressions">not measurable/);
    assert.match(missing, /data-metric="url">not measurable/);
    assert.equal(missing.includes('1–3'), false);
    assert.equal(missing.includes('>0<'), false);
    assert.equal(html.includes('>Distribution<'), false);
    assert.match(html, /data-distribution="1-3"[\s\S]*?>0</);
    assert.match(html, /data-distribution="4-10"[\s\S]*?>1</);
    assert.match(html, /data-distribution="21-50"[\s\S]*?>1</);
});

test('the rankings tab asks for GSC only after the flag check', () => {
    const source = readFileSync(new URL('../../components/workspace/RankingsTab.tsx', import.meta.url), 'utf8');
    const refresh = source.slice(source.indexOf('const refresh = useCallback'), source.indexOf('useEffect(() =>'));
    assert.match(refresh, /if \(!keywordTrackingEnabled\(\)\) return;/);
    assert.ok(refresh.indexOf('loadRankingWindows(') > refresh.indexOf('keywordTrackingEnabled()'));
    assert.ok(refresh.indexOf('loadTrackedKeywordGsc(') > refresh.indexOf('loadRankingWindows('));
    assert.match(source, /useEffect\(\(\) => \{\s*if \(!enabled\) return;/);
    assert.equal(source.includes('createClient('), false);
});

test('the client workspace gates the rankings surface on the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    const tab = readFileSync(new URL('../../components/opportunities/OpportunitiesTab.tsx', import.meta.url), 'utf8');
    const shell = readFileSync(new URL('../nav/staff-shell.ts', import.meta.url), 'utf8');
    assert.match(page, /import \{ keywordTrackingEnabled \} from '@\/lib\/keyword-tracking\/flag'/);
    assert.match(page, /if \(keywordTrackingEnabled\(\)\) knownTabs\.push\('rankings'\)/);
    assert.match(page, /readOpportunityRoute\(searchKey, \{ keywordTracking: keywordTrackingEnabled\(\) \}\)/);
    assert.doesNotMatch(page, /'approvals', 'portal', 'rankings'/);
    assert.doesNotMatch(page, /setActiveTab\('rankings'\)/);
    assert.match(tab, /const tracking = keywordTrackingEnabled\(\)/);
    assert.match(tab, /selected === 'rankings' && tracking \? \(\s*<RankingsTab organizationId=\{organizationId\} clientId=\{clientId\} \/>/);
    assert.match(shell, /if \(options\.keywordTracking\) search\.push\(link\('rankings', 'Rankings', 'rankings'\)\)/);
});
