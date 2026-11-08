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
import { campaignIdentity, campaignLocalProfile, campaignSitewide, emptyLocalProfile, emptySitewide, type CampaignMeasurement, type CampaignPageSeries } from './sources.ts';
import { engagementFromClient, type ScopeEvidence } from './briefing.ts';

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
        engagement?: ReturnType<typeof engagementFromClient>;
        scope?: ScopeEvidence;
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
            engagement: extras.engagement,
            scope: extras.scope,
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
    assert.match(overview, /SEO Roadmap/);
    assert.match(overview, /Search Console/);
    assert.match(overview, /Not yet measurable/);
    assert.match(overview, /Not set/);
    assert.match(overview, /No initiatives yet/);
    assert.match(overview, /Content scope is not measured/);
    assert.match(overview, /Next milestone/);
    assert.match(overview, /Not set yet/);
    assert.equal(overview.includes('<path'), false);
    assert.equal(overview.includes('<polyline'), false);
    assert.equal(overview.includes('data-bar'), false);
    assert.equal(overview.includes('data-region="gsc-series"'), false);

    assert.match(roadmap, /No initiatives yet/);
    assert.match(roadmap, /there is no bar/);
    assert.equal(roadmap.includes('Phase not set'), false);
    assert.equal(roadmap.includes('No phase'), false);
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
    assert.match(overview, /data-metric="local-profile"[^>]*data-clicks="8"/);
    assert.equal(overview.includes('data-region="gsc-series"'), false);
    assert.match(overview, /Alex Kim/);
    assert.match(overview, /Mar 2, 2026/);
    assert.equal(overview.includes('2x/month'), false);
    assert.match(overview, /No initiatives yet/);
    assert.match(overview, /Not set yet/);
    assert.match(overview, /Content scope is not measured/);
    assert.match(results, /data-region="gsc-series"/);
    assert.match(results, /data-baseline="true"/);
    assert.match(results, /not a rolling series/);
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
            phase: null,
            category: null,
            targetMonth: null,
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
            phase: null,
            category: null,
            targetMonth: null,
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
            phase: null,
            category: null,
            targetMonth: null,
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
            phase: null,
            category: null,
            targetMonth: null,
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
            phase: null,
            category: null,
            targetMonth: null,
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

function sliceQuestion(html: string, question: string): string {
    const token = `data-question="${question}"`;
    const start = html.indexOf(token);
    assert.ok(start >= 0, question);
    const next = html.indexOf('data-question="', start + token.length);
    return html.slice(start, next === -1 ? undefined : next);
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
    assert.match(overview, /data-metric="local-profile"[^>]*data-clicks="8"/);
    assert.equal(overview.includes('data-clicks="3"'), false);
    assert.match(overview, /data-milestone="harbor-emergency"/);
    assert.match(overview, /Nov 20, 2026/);
    assert.match(overview, /Draft · After-hours draft/);
    assert.match(overview, /Emergency service page/);
    assert.match(overview, /Crawl access/);
    const verified = sliceQuestion(overview, 'verified');
    const progress = sliceQuestion(overview, 'in-progress');
    const staleOverview = sliceInitiative(verified, 'harbor-citations');
    assert.match(staleOverview, /Evidence stale — re-verify/);
    assert.equal(staleOverview.includes('15803d'), false);
    const incompleteOverview = sliceInitiative(progress, 'harbor-unproven');
    assert.match(incompleteOverview, /Verification incomplete/);
    assert.equal(incompleteOverview.includes('15803d'), false);
    assert.equal(incompleteOverview.includes('Completed &amp; Verified'), false);
    assert.equal(verified.includes('Unproven cleanup'), false);
    assert.equal(progress.includes('Profile categories'), false);

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
    assert.equal(roadmap.includes('data-phase-group'), false);
    assert.equal(roadmap.includes('No phase'), false);

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

test('roadmap phase, category, and target month stay off Overview and Results and are not a percent', () => {
    const initiatives = harborInitiatives();
    initiatives[0] = { ...initiatives[0], phase: 'growth', category: 'on_page', targetMonth: 5 };
    initiatives[1] = { ...initiatives[1], phase: 'foundation', category: 'technical', targetMonth: 1 };
    initiatives[2] = { ...initiatives[2], phase: 'scale', category: 'analytics_reporting', targetMonth: 12 };
    const extras = { snapshot: measuredSnapshot(), initiatives, today: '2026-11-07' };
    const overview = render('overview', true, extras);
    const roadmap = render('roadmap', true, extras);
    const results = render('results', true, extras);

    const foundation = roadmap.indexOf('Phase 1 · Foundation — 1 initiative');
    const growth = roadmap.indexOf('Phase 2 · Growth — 1 initiative');
    const scale = roadmap.indexOf('Phase 3 · Scale — 1 initiative');
    const unset = roadmap.indexOf('No phase');
    assert.ok(foundation >= 0 && foundation < growth && growth < scale && scale < unset);

    const crawl = sliceInitiative(roadmap, 'harbor-crawl');
    assert.match(crawl, /data-phase="foundation"/);
    assert.match(crawl, /data-category="technical"/);
    assert.match(crawl, />Technical</);
    assert.match(crawl, /data-target-month="1"/);
    assert.match(crawl, /title="Month 1 of engagement \(planned\)"/);
    assert.match(crawl, />M1</);
    assert.equal(crawl.includes('data-bar'), false);

    const emergency = sliceInitiative(roadmap, 'harbor-emergency');
    assert.equal(emergency.match(/data-bar=/g)?.length, 1);
    assert.match(emergency, />M5</);

    const profile = sliceInitiative(roadmap, 'harbor-profile');
    assert.match(profile, /Analytics &amp; Reporting/);
    assert.match(profile, />M12</);
    assert.match(profile, /title="Month 12 of engagement \(planned\)"/);

    const citations = sliceInitiative(roadmap, 'harbor-citations');
    assert.match(citations, /data-phase=""/);
    assert.match(citations, /data-category=""/);
    assert.match(citations, /data-target-month=""/);
    assert.match(citations, /data-empty="true"/);

    assert.match(roadmap, /aria-checked="false"[^>]*disabled/);
    assert.match(roadmap, /aria-checked="true"[^>]*>Timeline</);
    assert.match(roadmap, /Evidence stale — re-verify/);
    assert.match(roadmap, /Published work is delivery, not a measured result/);
    assert.equal(roadmap.includes('Phase Progress'), false);
    assert.equal(roadmap.includes('Overall Progress'), false);
    assert.equal(roadmap.includes('Roadmap Complete'), false);

    assert.equal(overview.includes('Phase 1 · Foundation'), false);
    assert.equal(overview.includes('No phase'), false);
    assert.equal(overview.includes('>M1<'), false);
    assert.equal(overview.includes('On-Page'), false);
    assert.equal(results.includes('Phase 3 · Scale'), false);
    assert.equal(results.includes('Analytics &amp; Reporting'), false);
    assert.equal(results.includes('>M12<'), false);
    assert.match(results, /Profile categories/);
    assert.match(results, /not a rank of zero/);

    const text = roadmap.replace(/<[^>]+>/g, ' ');
    assert.equal(text.includes('%'), false);
    assert.equal(/\d+ of \d+/.test(text), false);
    assert.equal(text.includes('Roadmap Complete'), false);

    const panel = readFileSync(new URL('../../components/campaign-workspace/RoadmapPanel.tsx', import.meta.url), 'utf8');
    assert.match(panel, />Phase</);
    assert.match(panel, />Category</);
    assert.match(panel, />Target</);
    assert.match(panel, />Target month</);
    assert.match(panel, /Planned engagement month\. Doesn't set dates — schedule uses Starts\/Ends\./);
    assert.match(panel, /<option value="">\{UNSET_MARK\}<\/option>/);
    assert.equal(panel.includes('NEXT_PUBLIC_'), false);
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
    assert.match(overview, /SEO Roadmap/);
    assert.equal(overview.includes('Monthly execution'), false);
});

test('the client page mounts Campaign only behind the flag helper', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /import \{ campaignWorkspaceEnabled \} from '@\/lib\/campaign-workspace\/flag'/);
    assert.match(page, /if \(campaignWorkspaceEnabled\(\)\) knownTabs\.push\(CAMPAIGN_WORKSPACE_TAB\)/);
    assert.match(page, /activeTab === 'campaign-workspace' && campaignWorkspaceEnabled\(\)/);
    assert.match(page, /<CampaignWorkspace/);
    assert.match(page, /identityFromClient\(client\)/);
    assert.match(page, /engagementFromClient\(client\)/);
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

test('overview answers the five client-services questions without mixing delivery and results', () => {
    const snapshot = measuredSnapshot();
    snapshot.pages = pageSeries(2);
    const initiatives = harborInitiatives();
    const overview = render('overview', true, {
        snapshot,
        initiatives,
        today: '2026-11-07',
        identity: campaignIdentity({ launchDateOverride: '2026-03-02', accountManager: 'Alex Kim' }),
        engagement: engagementFromClient({
            engagementModel: 'Retainer',
            retainerConfig: { monthlyHours: 10, recurringDeliverables: [], ...{ hoursUsed: 99 } },
        }),
        scope: {
            month: '2026-11',
            loggedHours: 4.5,
            cells: [{
                clientId: 'client-harbor',
                type: 'Content',
                promised: 2,
                promisedConfigured: true,
                generated: 2,
                delivered: 1,
                inProgress: 1,
                overdue: 0,
            }],
        },
    });
    const results = render('results', true, { snapshot, initiatives, today: '2026-11-07' });

    const roadmap = sliceQuestion(overview, 'roadmap');
    assert.match(roadmap, /SEO Roadmap/);
    assert.match(roadmap, /Emergency service page/);
    assert.match(roadmap, /Cover the after-hours visit/);
    assert.match(roadmap, /Alex Kim/);
    assert.match(roadmap, /https:\/\/harbor\.example\/services\/emergency/);
    assert.match(roadmap, /data-roadmap-row="harbor-emergency"/);
    assert.equal(roadmap.includes('After-hours draft'), false);
    assert.equal(roadmap.includes('todo'), false);
    assert.equal(roadmap.includes('data-initiative'), false);

    const verified = sliceQuestion(overview, 'verified');
    assert.match(verified, /Completed &amp; Verified/);
    assert.match(verified, /Profile categories/);
    assert.match(verified, /Citation consistency/);
    assert.match(verified, /Evidence stale — re-verify/);
    assert.equal(verified.includes('Unproven cleanup'), false);
    assert.equal(verified.includes('Emergency service page'), false);
    assert.equal(verified.includes('data-clicks'), false);

    const progress = sliceQuestion(overview, 'in-progress');
    assert.match(progress, /In progress/);
    assert.match(progress, /data-milestone="harbor-emergency"/);
    assert.match(progress, /Emergency service page/);
    assert.match(progress, /Crawl access/);
    assert.match(progress, /Unproven cleanup/);
    assert.match(progress, /Verification incomplete/);
    assert.match(progress, /Draft · After-hours draft/);
    assert.equal(progress.includes('Profile categories'), false);
    assert.equal(progress.includes('Citation consistency'), false);

    const scope = sliceQuestion(overview, 'scope');
    assert.match(scope, /Scope this period/);
    assert.match(scope, /data-hours-promised="10"/);
    assert.match(scope, /data-hours-used="4.5"/);
    assert.match(scope, /data-content="Content"/);
    assert.match(scope, /data-promised="2"/);
    assert.match(scope, /data-delivered="1"/);
    assert.match(scope, /not an SEO result/);
    assert.equal(scope.includes('99'), false);
    assert.equal(scope.includes('hoursUsed'), false);
    assert.equal(scope.includes('progressbar'), false);
    assert.equal(scope.includes('On track'), false);

    const performance = sliceQuestion(overview, 'performance');
    assert.match(performance, /Campaign performance/);
    assert.match(performance, /data-clicks="140"/);
    assert.match(performance, /data-clicks="8"/);
    assert.match(performance, /data-clicks="56"/);
    assert.match(performance, /Not added to Business Profile/);
    assert.match(performance, /Not added to Search Console/);
    assert.equal(performance.includes('Profile categories'), false);
    assert.equal(performance.includes('4.5'), false);
    assert.equal(performance.includes('data-region="gsc-series"'), false);
    assert.equal(performance.includes('data-clicks="196"'), false);
    assert.equal(performance.includes('data-clicks="148"'), false);
    assert.match(results, /data-region="gsc-series"/);
    assert.equal(overview.includes('Verified work'), false);
    assert.equal(overview.includes('progressbar'), false);
    assert.equal(overview.includes('On track'), false);
});

test('an empty initiative list stays an empty roadmap', () => {
    const overview = render('overview', true, { initiatives: [], today: '2026-11-07' });
    const roadmap = sliceQuestion(overview, 'roadmap');
    assert.match(roadmap, /No initiatives yet/);
    assert.equal(roadmap.includes('data-roadmap-row'), false);
    assert.equal(overview.includes('Publish the page'), false);
    assert.equal(overview.includes('Write the brief'), false);
});

test('unconfigured scope stays unknown and incomplete measurement stays unmeasured', () => {
    const snapshot = measuredSnapshot();
    snapshot.gsc = emptySitewide('incomplete');
    snapshot.gbp = emptyLocalProfile();
    snapshot.pages = pageSeries(2, (day, index) => { if (index === 40) day.isIncomplete = true; });
    const overview = render('overview', true, {
        snapshot,
        initiatives: harborInitiatives(),
        today: '2026-11-07',
        engagement: engagementFromClient({
            engagementModel: 'Retainer',
            retainerConfig: { monthlyHours: 0, recurringDeliverables: [] },
        }),
        scope: { month: '2026-11', loggedHours: null, cells: [] },
    });
    const scope = sliceQuestion(overview, 'scope');
    assert.match(scope, /data-hours-promised="unset"/);
    assert.match(scope, /data-hours-used="unset"/);
    assert.match(scope, /Not set/);
    assert.match(scope, /Not measured/);
    assert.match(scope, /Content scope is not set/);
    assert.equal(scope.includes('0 h'), false);
    const performance = sliceQuestion(overview, 'performance');
    assert.match(performance, /data-reason="incomplete"/);
    assert.match(performance, /Not yet measurable/);
    assert.match(performance, /A missing observation is not zero/);
    assert.match(performance, /data-page-result="harbor-emergency"/);
    assert.match(performance, /data-state="not_measurable"/);
    assert.equal(performance.includes('data-clicks'), false);
    assert.equal(performance.includes('>0<'), false);
    const verified = sliceQuestion(overview, 'verified');
    assert.equal(verified.includes('data-clicks'), false);
    assert.equal(verified.includes('not_measurable'), false);
});
