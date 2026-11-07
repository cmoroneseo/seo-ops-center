/**
 * Run with: node --import tsx --test lib/campaign-workspace/ui.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignWorkspace } from '../../components/campaign-workspace/CampaignWorkspace.tsx';
import { parseCampaignView } from './view.ts';
import { clientSections } from '../nav/staff-shell.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(view: 'overview' | 'roadmap' | 'results', enabled: boolean) {
    const previous = process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
    process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = enabled ? 'true' : 'false';
    try {
        return renderToStaticMarkup(createElement(CampaignWorkspace, {
            clientName: 'Harbor Dental',
            view,
            onView() {},
        }));
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        else process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = previous;
    }
}

function selectedTab(html: string): string {
    const match = html.match(/<button[^>]*aria-selected="true"[^>]*>([^<]+)</);
    return match?.[1] ?? '';
}

const BANNED = [
    '241',
    '186',
    '30%',
    'Summit Dental',
    'Jordan Hale',
    'On track',
    'On Track',
    'completion',
    'progressbar',
];

test('an unknown campaign view stays on Overview', () => {
    assert.equal(parseCampaignView(null), 'overview');
    assert.equal(parseCampaignView('board'), 'overview');
    assert.equal(parseCampaignView('roadmap'), 'roadmap');
    assert.equal(parseCampaignView('results'), 'results');
});

test('the campaign shell stays hidden when the flag is off', () => {
    const previous = process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
    try {
        delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        const html = renderToStaticMarkup(createElement(CampaignWorkspace, {
            clientName: 'Harbor Dental',
            view: 'overview',
            onView() {},
        }));
        assert.equal(html, '');
        assert.equal(render('roadmap', false), '');
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        else process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = previous;
    }

    const off = clientSections('summit', { keywordTracking: true, vault: false, campaignWorkspace: false });
    assert.equal(off[0].links.some(link => link.label === 'Campaign'), false);
});

test('flag-on empty states keep measurement, delivery, and dates unset', () => {
    const overview = render('overview', true);
    const roadmap = render('roadmap', true);
    const results = render('results', true);

    assert.equal(selectedTab(overview), 'Overview');
    assert.equal(selectedTab(roadmap), 'Roadmap');
    assert.equal(selectedTab(results), 'Results');
    assert.match(overview, /Harbor Dental/);
    assert.match(overview, /Organic clicks/);
    assert.match(overview, /Not yet measurable/);
    assert.match(overview, /Not set yet/);
    assert.match(overview, /No initiatives yet/);
    assert.match(overview, /No client action is waiting/);
    assert.match(overview, /Next milestone/);
    assert.equal(overview.includes('<path'), false);
    assert.equal(overview.includes('<polyline'), false);
    assert.equal(overview.includes('data-bar'), false);

    assert.match(roadmap, /No initiatives yet/);
    assert.match(roadmap, /there is no bar/);
    assert.match(roadmap, /aria-checked="false"[^>]*disabled/);
    assert.match(roadmap, /aria-checked="true"[^>]*>Timeline</);
    assert.match(roadmap, /Board is not available yet/);
    assert.equal(roadmap.includes('data-bar'), false);
    assert.equal(roadmap.includes('<rect'), false);

    assert.match(results, /data-region="measured"/);
    assert.match(results, /data-region="completed"/);
    assert.match(results, /National Search Console/);
    assert.match(results, /Local Business Profile/);
    assert.match(results, /are not summed/);
    assert.match(results, /No completed delivery is recorded/);
    assert.match(results, /not a rank of zero/);
    const measured = results.slice(results.indexOf('data-region="measured"'), results.indexOf('data-region="completed"'));
    assert.equal(measured.includes('No completed delivery'), false);

    for (const html of [overview, roadmap, results]) {
        for (const banned of BANNED) assert.equal(html.includes(banned), false, banned);
        assert.equal(html.includes('>0<'), false);
    }
});

test('the client page mounts Campaign only behind the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /import \{ campaignWorkspaceEnabled \} from '@\/lib\/campaign-workspace\/flag'/);
    assert.match(page, /if \(campaignWorkspaceEnabled\(\)\) knownTabs\.push\(CAMPAIGN_WORKSPACE_TAB\)/);
    assert.match(page, /activeTab === 'campaign-workspace' && campaignWorkspaceEnabled\(\)/);
    assert.match(page, /<CampaignWorkspace/);
    assert.match(page, /tab === CAMPAIGN_WORKSPACE_TAB && !campaignWorkspaceEnabled\(\)/);
    assert.doesNotMatch(page, /NEXT_PUBLIC_CAMPAIGN_WORKSPACE\s*=\s*'true'/);
});
