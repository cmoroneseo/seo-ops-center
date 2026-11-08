/**
 * Run with: node --import tsx --test lib/campaign-workspace/ui.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CampaignWorkspace } from '../../components/campaign-workspace/CampaignWorkspace.tsx';
import { parseCampaignView, seoPlanWorkSearch } from './view.ts';
import { clientSections } from '../nav/staff-shell.ts';
import { dateOffset } from '@/lib/gsc/history.ts';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights.ts';
import type { CampaignInitiative } from './initiatives.ts';
import { campaignPageResults } from './pages.ts';
import { campaignIdentity, campaignLocalProfile, campaignSitewide, type CampaignMeasurement, type CampaignPageSeries } from './sources.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function render(
    view: 'overview' | 'roadmap' | 'work' | 'results',
    enabled: boolean,
    extras: {
        snapshot?: CampaignMeasurement;
        identity?: ReturnType<typeof campaignIdentity>;
        initiatives?: CampaignInitiative[];
        today?: string;
        monthlyBoard?: React.ReactNode;
    } = {},
) {
    const previous = process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
    process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = enabled ? 'true' : 'false';
    try {
        return renderToStaticMarkup(createElement(CampaignWorkspace, {
            clientName: 'Harbor Dental',
            view,
            onView() {},
            snapshot: extras.snapshot,
            identity: extras.identity,
            initiatives: extras.initiatives,
            today: extras.today,
            monthlyBoard: extras.monthlyBoard,
        }));
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        else process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = previous;
    }
}

function measuredSnapshot(): CampaignMeasurement {
    const end = '2026-10-28';
    const start = dateOffset(end, -55);
    const days: HistoryDay[] = [];
    const rows: HistoryRow[] = [];
    for (let index = 0; index < 56; index += 1) {
        const date = dateOffset(start, index);
        const id = `day-${date}`;
        days.push({ id, date, importedAt: `${date}T18:00:00Z`, pageLimited: false, queryLimited: false, isIncomplete: false });
        rows.push({ id: index + 1, dayId: id, page: '', query: '', clicks: index < 28 ? 4 : 5, impressions: 20, position: 6 });
    }
    return {
        gsc: campaignSitewide({ connected: true, days, rows, today: '2026-10-29' }),
        gbp: campaignLocalProfile([
            { metricMonth: '2026-10', data: { calls: 50 } },
            { metricMonth: '2026-09', data: { calls: 8 } },
            { metricMonth: '2026-08', data: { calls: 3 } },
        ], new Date('2026-10-29T20:00:00Z')),
        awaitingApproval: 2,
        pages: { status: 'missing', days: [], rows: [] },
    };
}

function pageSeries(clicks: number, mutate?: (day: HistoryDay, index: number) => void): CampaignPageSeries {
    const end = '2026-10-28';
    const start = dateOffset(end, -55);
    const days: HistoryDay[] = [];
    const rows: HistoryRow[] = [];
    for (let index = 0; index < 56; index += 1) {
        const date = dateOffset(start, index);
        const id = `page-${date}`;
        const day: HistoryDay = { id, date, importedAt: `${date}T18:00:00Z`, pageLimited: false, queryLimited: false, isIncomplete: false };
        mutate?.(day, index);
        days.push(day);
        rows.push({
            id: index + 1,
            dayId: id,
            page: 'https://harbor.example/services/emergency',
            query: '',
            clicks,
            impressions: 4,
            position: 3,
        });
        rows.push({
            id: 1000 + index,
            dayId: id,
            page: 'https://harbor.example/services/emergency?utm_medium=gbp',
            query: '',
            clicks: 9,
            impressions: 4,
            position: 2,
        });
    }
    return { status: 'ready', days, rows };
}

function selectedTab(html: string): string {
    const match = html.match(/<button[^>]*aria-selected="true"[^>]*>([^<]+)</);
    return match?.[1] ?? '';
}

function tabLabels(html: string): string[] {
    return [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map(match => match[1]);
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
    assert.equal(parseCampaignView('work'), 'work');
    assert.equal(parseCampaignView('results'), 'results');
});

test('an SEO Plan URL opens Campaign Work only while Campaign is on', () => {
    assert.equal(seoPlanWorkSearch('tab=campaign', false), null);
    assert.equal(seoPlanWorkSearch('tab=plan&planView=results', false), null);
    assert.equal(
        seoPlanWorkSearch('tab=campaign&planView=tasks&overviewMonth=2026-11&overviewTask=abc', true),
        'tab=campaign-workspace&campaignView=work&overviewMonth=2026-11&overviewTask=abc',
    );
    assert.equal(
        seoPlanWorkSearch('?tab=plan&phase=build&overviewMonth=2026-11', true),
        'tab=campaign-workspace&campaignView=work&overviewMonth=2026-11&phase=build',
    );
    assert.equal(seoPlanWorkSearch('tab=tasks', true), null);
    assert.equal(seoPlanWorkSearch('tab=campaign-workspace&campaignView=roadmap', true), null);
    assert.equal(seoPlanWorkSearch('tab=overview', true), null);
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

    assert.deepEqual(tabLabels(overview), ['Overview', 'Roadmap', 'Work', 'Results']);
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

test('stored Search Console and Business Profile render separately from empty work', () => {
    const snapshot = measuredSnapshot();
    assert.equal(snapshot.gsc.clicks, 140);
    assert.equal(snapshot.gbp.value, 8);
    const identity = campaignIdentity({
        launchDateOverride: '2026-03-02',
        accountManager: 'Alex Kim',
        seoHours: 10,
        deliverablesSpec: '2x/month',
    });
    const overview = render('overview', true, { snapshot, identity });
    const results = render('results', true, { snapshot, identity });
    const roadmap = render('roadmap', true, { snapshot, identity });

    assert.match(overview, /data-metric="organic-clicks"[^>]*data-clicks="140"/);
    assert.match(overview, /data-clicks="2"/);
    assert.match(overview, /data-region="gsc-series"/);
    assert.match(overview, /data-baseline="true"/);
    assert.match(overview, /not a rolling series/);
    assert.match(overview, /Alex Kim/);
    assert.match(overview, /Mar 2, 2026/);
    assert.match(overview, /2x\/month/);
    assert.match(overview, /No initiatives yet/);
    assert.match(overview, /No client action is waiting/);
    assert.match(overview, /Not set yet/);
    assert.match(results, /data-metric="local-profile"[^>]*data-clicks="8"/);
    assert.match(results, /Call-button taps/);
    assert.match(results, /are not summed/);
    assert.match(results, /Not summed with sitewide clicks/);
    assert.match(results, /not a rank of zero/);
    assert.match(results, /No completed delivery is recorded/);
    assert.match(results, /Not yet measurable/);
    assert.match(roadmap, /No initiatives yet/);
    assert.match(roadmap, /there is no bar/);
    assert.equal(roadmap.includes('data-bar'), false);
    assert.equal(roadmap.includes('data-region="gsc-series"'), false);

    for (const html of [overview, results, roadmap]) {
        assert.equal(html.includes('data-clicks="148"'), false);
        assert.equal(html.includes('>148<'), false);
        assert.equal(html.includes('241'), false);
        assert.equal(html.includes('186'), false);
        assert.equal(html.includes('Summit Dental'), false);
        assert.equal(html.includes('campaign_plans'), false);
        assert.equal(html.includes('Sheet connected'), false);
    }
});

function harborInitiatives(): CampaignInitiative[] {
    return [
        {
            id: 'harbor-emergency',
            organizationId: 'org-harbor',
            clientId: 'client-harbor',
            title: 'Emergency service page',
            purpose: 'Cover the after-hours visit',
            ownerName: 'Alex Kim',
            priority: 1,
            state: 'in_progress',
            startsOn: '2026-09-01',
            endsOn: '2026-11-20',
            pageUrl: 'https://harbor.example/services/emergency',
            successMetricLabel: 'Service page clicks',
            evidenceUrl: null,
            verifiedOn: null,
            items: [{
                id: 'harbor-draft',
                title: 'After-hours draft',
                contentState: 'draft',
                draftUrl: 'https://harbor.example/drafts/after-hours',
                liveUrl: null,
                publishedOn: null,
                position: 0,
            }],
        },
        {
            id: 'harbor-crawl',
            organizationId: 'org-harbor',
            clientId: 'client-harbor',
            title: 'Crawl access',
            purpose: 'Blocked URLs waste crawl',
            ownerName: 'Alex Kim',
            priority: 1,
            state: 'blocked',
            startsOn: null,
            endsOn: null,
            pageUrl: null,
            successMetricLabel: null,
            evidenceUrl: null,
            verifiedOn: null,
            items: [],
        },
        {
            id: 'harbor-profile',
            organizationId: 'org-harbor',
            clientId: 'client-harbor',
            title: 'Profile categories',
            purpose: 'Help patients recognize the practice',
            ownerName: 'Alex Kim',
            priority: 2,
            state: 'completed_verified',
            startsOn: '2026-10-03',
            endsOn: '2026-10-04',
            pageUrl: null,
            successMetricLabel: null,
            evidenceUrl: 'https://harbor.example/proof/profile',
            verifiedOn: '2026-10-04',
            items: [{
                id: 'harbor-categories',
                title: 'Category update',
                contentState: 'published',
                draftUrl: null,
                liveUrl: 'https://harbor.example/blog/categories',
                publishedOn: '2026-10-04',
                position: 0,
            }],
        },
        {
            id: 'harbor-citations',
            organizationId: 'org-harbor',
            clientId: 'client-harbor',
            title: 'Citation consistency',
            purpose: 'Keep the practice name consistent',
            ownerName: 'Alex Kim',
            priority: 2,
            state: 'completed_verified',
            startsOn: '2026-08-01',
            endsOn: '2026-08-01',
            pageUrl: null,
            successMetricLabel: null,
            evidenceUrl: 'https://harbor.example/proof/citations',
            verifiedOn: '2026-08-01',
            items: [],
        },
        {
            id: 'harbor-unproven',
            organizationId: 'org-harbor',
            clientId: 'client-harbor',
            title: 'Unproven cleanup',
            purpose: null,
            ownerName: null,
            priority: 2,
            state: 'completed_verified',
            startsOn: null,
            endsOn: null,
            pageUrl: null,
            successMetricLabel: null,
            evidenceUrl: null,
            verifiedOn: null,
            items: [],
        },
    ];
}

function sliceInitiative(html: string, id: string): string {
    const token = `data-initiative="${id}"`;
    const start = html.indexOf(token);
    assert.ok(start >= 0, id);
    const next = html.indexOf('data-initiative="', start + token.length);
    return html.slice(start, next === -1 ? undefined : next);
}

test('stored initiatives fill the roadmap without mixing delivery into measurement', () => {
    const initiatives = harborInitiatives();
    const extras = { snapshot: measuredSnapshot(), initiatives, today: '2026-11-07' };
    const overview = render('overview', true, extras);
    const roadmap = render('roadmap', true, extras);
    const results = render('results', true, extras);

    assert.match(overview, /data-metric="organic-clicks"[^>]*data-clicks="140"/);
    assert.match(overview, /data-clicks="2"/);
    assert.equal(overview.includes('data-clicks="3"'), false);
    assert.match(overview, /data-milestone="harbor-emergency"/);
    assert.match(overview, /Nov 20, 2026/);
    assert.match(overview, /Draft · After-hours draft/);
    assert.match(overview, /No client action is waiting/);
    assert.match(overview, /Not set yet/);
    assert.match(overview, /Emergency service page/);
    assert.match(overview, /Crawl access/);
    const staleOverview = sliceInitiative(overview, 'harbor-citations');
    assert.match(staleOverview, /Evidence stale — re-verify/);
    assert.equal(staleOverview.includes('15803d'), false);
    const incompleteOverview = sliceInitiative(overview, 'harbor-unproven');
    assert.match(incompleteOverview, /Verification incomplete/);
    assert.equal(incompleteOverview.includes('15803d'), false);
    assert.equal(incompleteOverview.includes('Completed &amp; Verified'), false);

    const crawl = sliceInitiative(roadmap, 'harbor-crawl');
    assert.match(crawl, /Dates not set/);
    assert.equal(crawl.includes('data-bar'), false);
    const emergency = sliceInitiative(roadmap, 'harbor-emergency');
    assert.match(emergency, /data-bar="span"/);
    const citations = sliceInitiative(roadmap, 'harbor-citations');
    assert.match(citations, /data-bar="point"/);
    assert.match(citations, /Evidence stale — re-verify/);
    assert.equal(citations.includes('15803d'), false);
    assert.match(roadmap, /data-measurement="not-yet"/);
    assert.match(roadmap, /Service page clicks/);
    assert.match(roadmap, /Not yet measurable/);
    assert.equal(roadmap.includes('data-region="gsc-series"'), false);
    assert.equal(roadmap.includes('data-clicks'), false);
    assert.match(roadmap, /aria-checked="false"[^>]*disabled/);
    assert.match(roadmap, /aria-checked="true"[^>]*>Timeline</);

    const measured = results.slice(results.indexOf('data-region="measured"'), results.indexOf('data-region="completed"'));
    const completed = results.slice(results.indexOf('data-region="completed"'));
    const sitewide = measured.slice(measured.indexOf('data-region="sitewide"'), measured.indexOf('data-metric="local-profile"'));
    const pageUrl = measured.slice(measured.indexOf('data-region="page-url"'), measured.indexOf('Secondary signal'));
    assert.match(measured, /data-clicks="8"/);
    assert.match(measured, /Not yet measurable/);
    assert.match(measured, /not a rank of zero/);
    assert.match(pageUrl, /data-page-urls="1"/);
    assert.match(pageUrl, /data-state="not_measurable"/);
    assert.match(pageUrl, /https:\/\/harbor\.example\/services\/emergency/);
    assert.equal(pageUrl.includes('data-clicks'), false);
    assert.equal(sitewide.includes('harbor.example'), false);
    assert.equal(sitewide.includes('services/emergency'), false);
    assert.equal(measured.includes('Profile categories'), false);
    assert.equal(measured.includes('data-clicks="148"'), false);
    assert.equal(measured.includes('>148<'), false);
    assert.match(completed, /Profile categories/);
    assert.match(completed, /https:\/\/harbor\.example\/blog\/categories/);
    assert.match(completed, /Citation consistency/);
    assert.match(completed, /Evidence stale — re-verify/);
    assert.equal(completed.includes('Unproven cleanup'), false);
    assert.equal(completed.includes('data-clicks'), false);
    assert.equal(completed.includes('>140<'), false);
    assert.equal(completed.includes('>8<'), false);
    const staleDelivery = completed.slice(completed.indexOf('data-verification="stale"'), completed.indexOf('data-verification="fresh"'));
    assert.equal(staleDelivery.includes('15803d'), false);
    const freshDelivery = completed.slice(completed.indexOf('data-verification="fresh"'));
    assert.match(freshDelivery, /15803d/);
    assert.match(freshDelivery, /Completed &amp; Verified/);

    for (const html of [overview, roadmap, results]) {
        assert.equal(html.includes('241'), false);
        assert.equal(html.includes('186'), false);
        assert.equal(html.includes('Summit Dental'), false);
        assert.equal(html.includes('campaign_plans'), false);
        assert.equal(html.includes('progressbar'), false);
        assert.equal(html.includes('completion'), false);
        assert.equal(html.includes('On track'), false);
    }
});

test('a stored page URL shows its own Search Console clicks and leaves sitewide and profile unchanged', () => {
    const snapshot = measuredSnapshot();
    snapshot.pages = pageSeries(2);
    const initiatives = harborInitiatives();
    const page = campaignPageResults({ series: snapshot.pages, initiatives, today: '2026-10-29' })[0];
    assert.equal(page.clicks, 56);
    assert.equal(snapshot.gsc.clicks, 140);
    assert.equal(snapshot.gbp.value, 8);
    const results = render('results', true, { snapshot, initiatives, today: '2026-11-07' });
    const measured = results.slice(results.indexOf('data-region="measured"'), results.indexOf('data-region="completed"'));
    const sitewide = measured.slice(measured.indexOf('data-region="sitewide"'), measured.indexOf('data-metric="local-profile"'));
    const local = measured.slice(measured.indexOf('data-metric="local-profile"'), measured.indexOf('data-region="page-url"'));
    const pageUrl = measured.slice(measured.indexOf('data-region="page-url"'), measured.indexOf('Secondary signal'));
    assert.match(sitewide, /140/);
    assert.match(local, /data-clicks="8"/);
    assert.match(pageUrl, /data-page-result="harbor-emergency"/);
    assert.match(pageUrl, /data-clicks="56"/);
    assert.match(pageUrl, /data-surface="organic"/);
    assert.match(pageUrl, /None set/);
    assert.match(pageUrl, /do not prove this page/);
    assert.equal(pageUrl.includes('data-clicks="9"'), false);
    assert.equal(pageUrl.includes('data-clicks="65"'), false);
    assert.equal(sitewide.includes('data-clicks="56"'), false);
    assert.equal(sitewide.includes('harbor.example'), false);
    assert.equal(local.includes('data-clicks="56"'), false);
    assert.equal(local.includes('data-clicks="64"'), false);
    assert.equal(measured.includes('data-clicks="196"'), false);
    assert.equal(measured.includes('data-clicks="148"'), false);
    assert.match(measured, /not a rank of zero/);
    assert.match(results, /data-region="completed"/);
    assert.match(results, /Profile categories/);

    snapshot.pages = pageSeries(2, (day, index) => { if (index === 40) day.isIncomplete = true; });
    const gapped = render('results', true, { snapshot, initiatives, today: '2026-11-07' });
    const gappedPage = gapped.slice(gapped.indexOf('data-region="page-url"'), gapped.indexOf('Secondary signal'));
    assert.match(gappedPage, /data-state="not_measurable"/);
    assert.match(gappedPage, /data-reason="incomplete"/);
    assert.equal(gappedPage.includes('data-clicks'), false);
    assert.match(gapped, /data-clicks="140"|140/);
    assert.match(gapped, /data-clicks="8"/);
});

test('Work mounts the monthly board and leaves the other Campaign views alone', () => {
    const work = render('work', true, {
        monthlyBoard: React.createElement('div', { 'data-campaign-monthly-board': 'live' }, 'Monthly execution'),
    });
    assert.equal(selectedTab(work), 'Work');
    assert.deepEqual(tabLabels(work), ['Overview', 'Roadmap', 'Work', 'Results']);
    assert.match(work, /not the client-facing roadmap/);
    assert.match(work, /data-campaign-monthly-board="live"/);
    assert.equal(work.includes('Back to Workspace'), false);
    assert.equal(work.includes('Organic clicks'), false);
    assert.equal(work.includes('No initiatives yet'), false);
    assert.equal(work.includes('National Search Console'), false);
    assert.equal(work.includes('Add initiative'), false);

    const overview = render('overview', true, {
        monthlyBoard: React.createElement('div', { 'data-campaign-monthly-board': 'live' }, 'Monthly execution'),
    });
    assert.equal(overview.includes('data-campaign-monthly-board'), false);
    assert.match(overview, /Organic clicks/);
});

test('the client page mounts Campaign only behind the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /import \{ campaignWorkspaceEnabled \} from '@\/lib\/campaign-workspace\/flag'/);
    assert.match(page, /if \(campaignWorkspaceEnabled\(\)\) knownTabs\.push\(CAMPAIGN_WORKSPACE_TAB\)/);
    assert.match(page, /activeTab === 'campaign-workspace' && campaignWorkspaceEnabled\(\)/);
    assert.match(page, /<CampaignWorkspace/);
    assert.match(page, /identityFromClient\(client\)/);
    assert.match(page, /clientId=\{client.id\}/);
    assert.match(page, /tab === CAMPAIGN_WORKSPACE_TAB && !campaignWorkspaceEnabled\(\)/);
    assert.match(page, /seoPlanWorkSearch\(searchKey, campaignWorkspaceEnabled\(\)\)/);
    assert.match(page, /setCampaignViewState\('work'\)/);
    assert.match(page, /monthlyBoard=\{stageListOn \? monthlyBoard/);
    assert.match(page, /<StagePlanList/);
    assert.match(page, /activeTab === 'campaign' && stageListOn && monthlyBoard/);
    assert.doesNotMatch(page, /NEXT_PUBLIC_CAMPAIGN_WORKSPACE\s*=\s*'true'/);
    assert.doesNotMatch(page, /campaign_plans|campaign-plans/);
});
