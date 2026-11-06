/**
 * Run with: node --import tsx --test lib/keyword-tracking/rankings-tab.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceNav } from '../../components/seo-plan/WorkspaceNav.tsx';
import { RankingsTab } from '../../components/workspace/RankingsTab.tsx';
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

test('the rankings tab is an empty state with no keyword table', () => {
    const html = renderToStaticMarkup(createElement(RankingsTab));
    assert.match(html, /No tracked keywords yet/);
    assert.match(html, /Keyword tracking for this client lands in a later update/);
    assert.equal(html.includes('<table'), false);
    assert.equal(html.includes('<input'), false);
});

test('the client workspace gates the rankings tab on the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /import \{ keywordTrackingEnabled \} from '@\/lib\/keyword-tracking\/flag'/);
    assert.equal(page.match(/rankings=\{keywordTrackingEnabled\(\)\}/g)?.length, 2);
    assert.match(page, /if \(keywordTrackingEnabled\(\)\) knownTabs\.push\('rankings'\)/);
    assert.doesNotMatch(page, /'approvals', 'portal', 'rankings'/);
    assert.match(page, /keywordTrackingEnabled\(\) && \(\s*<button[\s\S]*?setActiveTab\('rankings'\)[\s\S]*?>Rankings<\/button>/);
    assert.match(page, /keywordTrackingEnabled\(\) && activeTab === 'rankings' && client\.organizationId === organization\?\.id && \(\s*<RankingsTab/);
});
