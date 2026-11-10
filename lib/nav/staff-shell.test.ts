import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reportsNavHref } from '../reports/close-nav.ts';
import { parseIdList, rememberClientId } from './recent-clients.ts';
import {
    agencyLinks,
    clientInitials,
    clientSections,
    clientStatusChip,
    isAgencyLinkActive,
    isClientLinkActive,
    switchClientHref,
    type StaffLink,
    type StaffSection,
} from './staff-shell.ts';

const flags = { keywordTracking: true, vault: true, campaignWorkspace: false };

test('client sections follow the approved groups and omit concept rows', () => {
    const on = clientSections('summit', { keywordTracking: true, vault: false, campaignWorkspace: false });
    assert.deepEqual(on.map(section => section.label), ['Client workspace', 'Search intelligence', 'More']);
    assert.deepEqual(on[0].links.map(link => link.label), [
        'Overview', 'SEO Plan', 'Tasks', 'Deliverables', 'Time', 'Reports',
    ]);
    assert.deepEqual(on[1].links.map(link => link.label), ['Search', 'Rankings']);
    assert.equal(on[1].links[0].href, '/workspace/summit?tab=insights');
    assert.equal(on[1].links[1].href, '/workspace/summit?tab=rankings');
    assert.ok(on[1].links.findIndex(link => link.label === 'Search') < on[1].links.findIndex(link => link.label === 'Rankings'));

    const off = clientSections('summit', { keywordTracking: false, vault: false, campaignWorkspace: false });
    assert.equal(off[1].links.some(link => link.label === 'Rankings'), false);
    assert.equal(off[2].overflow?.some(link => link.id === 'vault'), false);
    assert.equal(clientSections('summit', flags)[2].overflow?.some(link => link.id === 'vault'), true);

    const source = readFileSync(new URL('./staff-shell.ts', import.meta.url), 'utf8');
    for (const banned of ['AI Visibility', 'Research', 'Cannibalization', 'Distribution', 'OpenSEO', 'Semrush']) {
        assert.equal(source.includes(banned), false, banned);
    }
});

test('agency menu is the readable cross-client list, with the portfolio only when that flag is on', () => {
    const plain = agencyLinks({ agencyDashboard: false });
    assert.deepEqual(plain.map(link => link.label), [
        'Agency home', 'All clients', 'Tasks', 'Deliverables', 'Time', 'Planner', 'Reports',
    ]);
    assert.equal(plain.find(link => link.id === 'clients')?.dividerAfter, true);
    assert.equal(plain.find(link => link.id === 'home')?.href, '/dashboard');
    assert.equal(plain.find(link => link.id === 'clients')?.href, '/workspace');
    assert.equal(plain.find(link => link.id === 'tasks')?.href, '/tasks');
    assert.equal(plain.find(link => link.id === 'deliverables')?.href, '/deliverables');
    assert.equal(plain.find(link => link.id === 'time')?.href, '/timesheets');
    assert.equal(plain.find(link => link.id === 'planner')?.href, '/planner');
    assert.equal(plain.find(link => link.id === 'reports')?.href, reportsNavHref());
    assert.equal(plain.some(link => link.href === '/agency'), false);

    const flagged = agencyLinks({ agencyDashboard: true });
    assert.deepEqual(flagged.map(link => link.label), [
        'Agency home', 'Dashboard', 'All clients', 'Tasks', 'Deliverables', 'Time', 'Planner', 'Reports',
    ]);
    assert.equal(flagged.find(link => link.id === 'dashboard')?.href, '/agency');
});

test('switching clients keeps the module, and a closed rankings flag opens Overview', () => {
    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=rankings',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: false,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=rankings');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: '?tab=rankings',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=overview&navNotice=unavailable');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=campaign&planView=tasks',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=campaign&planView=tasks');

    assert.equal(switchClientHref({
        fromPathname: '/tasks',
        fromSearch: 'client=summit&task=old',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: true,
        campaignWorkspace: false,
    }), '/tasks?client=maya');

    assert.equal(switchClientHref({
        fromPathname: '/dashboard',
        fromSearch: '',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=overview');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=vault',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: false,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=overview&navNotice=unavailable');
});

test('active rows follow the workspace tab, and the client list is not every workspace url', () => {
    const sections = clientSections('summit', flags);
    const rankings = sections[1].links[1];
    const overview = sections[0].links[0];
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', rankings, flags), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', overview, flags), false);
    assert.equal(isClientLinkActive('/workspace/summit', '', overview, flags), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', overview, { keywordTracking: false, vault: true, campaignWorkspace: false }), true);
    assert.equal(isAgencyLinkActive('/workspace', '/workspace'), true);
    assert.equal(isAgencyLinkActive('/workspace/summit', '/workspace'), false);
    assert.equal(isAgencyLinkActive('/reports/close', '/reports/close?month=2026-09'), true);
    assert.equal(isAgencyLinkActive('/tasks/1', '/tasks'), true);
    assert.equal(isAgencyLinkActive('/dashboard', '/dashboard'), true);
});

test('campaign sits after Overview only while its flag is on, and a closed flag opens Overview', () => {
    const on = clientSections('summit', { keywordTracking: false, vault: false, campaignWorkspace: true });
    assert.deepEqual(on[0].links.map(link => link.label), [
        'Overview', 'Campaign', 'Tasks', 'Deliverables', 'Time', 'Reports',
    ]);
    assert.equal(on[0].links.some(link => link.label === 'SEO Plan' || link.tab === 'campaign'), false);
    assert.equal(on[0].links[1].href, '/workspace/summit?tab=campaign-workspace');
    assert.equal(on[0].links[1].tab, 'campaign-workspace');
    assert.ok(on[0].links.findIndex(link => link.label === 'Overview') < on[0].links.findIndex(link => link.label === 'Campaign'));
    assert.ok(on[0].links.findIndex(link => link.label === 'Campaign') < on[0].links.findIndex(link => link.label === 'Tasks'));

    const off = clientSections('summit', { keywordTracking: true, vault: true, campaignWorkspace: false });
    assert.equal(off[0].links.some(link => link.label === 'Campaign' || link.tab === 'campaign-workspace'), false);
    assert.deepEqual(off[0].links.map(link => link.label).slice(0, 3), ['Overview', 'SEO Plan', 'Tasks']);

    const flagsOn = { keywordTracking: true, vault: true, campaignWorkspace: true };
    const flagsOff = { ...flagsOn, campaignWorkspace: false };
    const campaign = on[0].links[1];
    const tasks = on[0].links[2];
    const overview = on[0].links[0];
    const plan = off[0].links[1];
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace&campaignView=roadmap', campaign, flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace&campaignView=work', campaign, flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace', tasks, flagsOn), false);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign', campaign, flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=plan&overviewMonth=2026-11', campaign, flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace', overview, flagsOff), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign', plan, flagsOff), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign', campaign, flagsOff), false);

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=campaign&planView=tasks&overviewMonth=2026-11&overviewTask=abc',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
        campaignWorkspace: true,
    }), '/workspace/maya?tab=campaign-workspace&campaignView=work&overviewMonth=2026-11&overviewTask=abc');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=campaign-workspace&campaignView=results',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
        campaignWorkspace: true,
    }), '/workspace/maya?tab=campaign-workspace&campaignView=results');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=campaign-workspace&campaignView=roadmap',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: true,
        campaignWorkspace: false,
    }), '/workspace/maya?tab=overview&navNotice=unavailable');
});

function workspaceLink(id: string, label: string, tab: string): StaffLink {
    return { id, label, href: `/workspace/summit?tab=${tab}`, tab };
}

function legacySections(options: { keywordTracking: boolean; vault: boolean; campaignWorkspace: boolean }): StaffSection[] {
    const search: StaffLink[] = [workspaceLink('search', 'Search', 'insights')];
    if (options.keywordTracking) search.push(workspaceLink('rankings', 'Rankings', 'rankings'));
    const overflow: StaffLink[] = [
        workspaceLink('inventory', 'Site Inventory', 'inventory'),
        workspaceLink('approvals', 'Approvals', 'approvals'),
        workspaceLink('portal', 'Portal management', 'portal'),
        workspaceLink('integrations', 'Integrations', 'integrations'),
    ];
    if (options.vault) overflow.push(workspaceLink('vault', 'Vault', 'vault'));
    const workspace: StaffLink[] = [workspaceLink('overview', 'Overview', 'overview')];
    if (options.campaignWorkspace) workspace.push(workspaceLink('campaign-workspace', 'Campaign', 'campaign-workspace'));
    else workspace.push(workspaceLink('plan', 'SEO Plan', 'campaign'));
    workspace.push(
        workspaceLink('tasks', 'Tasks', 'tasks'),
        workspaceLink('deliverables', 'Deliverables', 'deliverables'),
        { id: 'time', label: 'Time', href: '/timesheets' },
        { id: 'reports', label: 'Reports', href: reportsNavHref() },
    );
    return [
        { id: 'workspace', label: 'Client workspace', links: workspace },
        { id: 'search', label: 'Search intelligence', links: search },
        {
            id: 'more',
            label: 'More',
            links: [workspaceLink('topical-map', 'Topical Map', 'topical-map')],
            overflow,
        },
    ];
}

function flatLinks(sections: StaffSection[]): StaffLink[] {
    const links: StaffLink[] = [];
    for (const section of sections) {
        for (const link of section.links) {
            links.push(link);
            links.push(...(link.children ?? []));
        }
        links.push(...(section.overflow ?? []));
    }
    return links;
}

test('pipeline nav off matches today\'s client items exactly', () => {
    const combos = [
        { keywordTracking: false, vault: false, campaignWorkspace: false },
        { keywordTracking: true, vault: false, campaignWorkspace: false },
        { keywordTracking: true, vault: true, campaignWorkspace: false },
        { keywordTracking: false, vault: true, campaignWorkspace: true },
        { keywordTracking: true, vault: true, campaignWorkspace: true },
    ];
    for (const options of combos) {
        const expected = legacySections(options);
        assert.deepEqual(clientSections('summit', options), expected);
        assert.deepEqual(clientSections('summit', { ...options, pipelineNav: false }), expected);
    }
});

test('pipeline nav on regroups the same routes and omits Content', () => {
    const on = clientSections('summit', {
        keywordTracking: true,
        vault: true,
        campaignWorkspace: true,
        pipelineNav: true,
    });
    assert.deepEqual(on.map(section => section.label), ['Client', 'Pipeline', 'Delivery', 'More']);
    assert.deepEqual(on.map(section => section.id), ['client', 'pipeline', 'delivery', 'more']);

    assert.deepEqual(on[0].links.map(link => link.label), ['Overview']);
    assert.equal(on[0].links[0].href, '/workspace/summit?tab=overview');

    assert.deepEqual(on[1].links.map(link => link.label), ['Topical Map', 'Opportunities']);
    assert.equal(on[1].links[0].href, '/workspace/summit?tab=topical-map');
    const opportunities = on[1].links[1];
    assert.equal(opportunities.href, '/workspace/summit?tab=insights');
    assert.equal(opportunities.tab, 'insights');
    assert.deepEqual(opportunities.children?.map(link => link.label), ['Site Inventory', 'Rankings']);
    assert.equal(opportunities.children?.[0].href, '/workspace/summit?tab=inventory');
    assert.equal(opportunities.children?.[1].href, '/workspace/summit?tab=rankings');

    assert.deepEqual(on[2].links.map(link => ({ label: link.label, tab: link.tab, href: link.href })), [
        { label: 'Campaign', tab: 'campaign-workspace', href: '/workspace/summit?tab=campaign-workspace' },
        { label: 'Tasks', tab: 'tasks', href: '/workspace/summit?tab=tasks' },
        { label: 'Reports', tab: undefined, href: reportsNavHref() },
    ]);

    assert.deepEqual(on[3].links.map(link => link.label), [
        'Integrations', 'Portal', 'Deliverables', 'Vault', 'Time',
    ]);
    assert.equal(on[3].links[0].href, '/workspace/summit?tab=integrations');
    assert.equal(on[3].links[1].href, '/workspace/summit?tab=portal');
    assert.equal(on[3].links[1].label, 'Portal');
    assert.equal(on[3].links[2].href, '/workspace/summit?tab=deliverables');
    assert.equal(on[3].links[3].href, '/workspace/summit?tab=vault');
    assert.equal(on[3].links[4].href, '/timesheets');
    assert.equal(on[3].overflow, undefined);

    const labels = flatLinks(on).map(link => link.label);
    assert.equal(labels.includes('Content'), false);
    assert.equal(labels.includes('Search'), false);
    assert.equal(JSON.stringify(on).includes('tab=content'), false);
    assert.equal(labels.includes('Approvals'), false);

    const noRankings = clientSections('summit', {
        keywordTracking: false,
        vault: false,
        campaignWorkspace: false,
        pipelineNav: true,
    });
    assert.deepEqual(noRankings[1].links[1].children?.map(link => link.label), ['Site Inventory']);
    assert.equal(flatLinks(noRankings).some(link => link.label === 'Rankings' || link.id === 'vault'), false);
    assert.deepEqual(noRankings[2].links.map(link => link.label), ['SEO Plan', 'Tasks', 'Reports']);
    assert.equal(noRankings[2].links[0].href, '/workspace/summit?tab=campaign');
    assert.deepEqual(noRankings[3].links.map(link => link.label), [
        'Integrations', 'Portal', 'Deliverables', 'Time',
    ]);

    const flagsOn = { keywordTracking: true, vault: true, campaignWorkspace: true };
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=insights', opportunities, flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=inventory', opportunities, flagsOn), false);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=inventory', opportunities.children![0], flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', opportunities.children![1], flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace&campaignView=roadmap', on[2].links[0], flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace&campaignView=work', on[2].links[0], flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=campaign-workspace&campaignView=results', on[2].links[0], flagsOn), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', on[0].links[0], { ...flagsOn, keywordTracking: false }), true);

    const kept = [
        ['tab=insights', '/workspace/maya?tab=insights'],
        ['tab=inventory', '/workspace/maya?tab=inventory'],
        ['tab=topical-map', '/workspace/maya?tab=topical-map'],
        ['tab=approvals&approvalBatch=batch-1', '/workspace/maya?tab=approvals&approvalBatch=batch-1'],
        ['tab=deliverables', '/workspace/maya?tab=deliverables'],
        ['tab=portal', '/workspace/maya?tab=portal'],
        ['tab=integrations', '/workspace/maya?tab=integrations'],
        ['tab=tasks', '/workspace/maya?tab=tasks'],
        ['tab=campaign-workspace&campaignView=results', '/workspace/maya?tab=campaign-workspace&campaignView=results'],
        ['tab=campaign&planView=tasks', '/workspace/maya?tab=campaign-workspace&campaignView=work'],
        ['tab=vault', '/workspace/maya?tab=vault'],
        ['tab=rankings', '/workspace/maya?tab=rankings'],
    ] as const;
    for (const [fromSearch, href] of kept) {
        assert.equal(switchClientHref({
            fromPathname: '/workspace/summit',
            fromSearch,
            targetClientId: 'maya',
            keywordTracking: true,
            vaultEnabled: true,
            campaignWorkspace: true,
        }), href);
    }

    assert.deepEqual(
        agencyLinks({ agencyDashboard: true }).map(link => link.label),
        ['Agency home', 'Dashboard', 'All clients', 'Tasks', 'Deliverables', 'Time', 'Planner', 'Reports'],
    );
});

test('status stays a real chip and long names keep a short mark', () => {
    assert.equal(clientStatusChip({ engagementModel: 'Retainer', status: 'Active' }), 'Retainer · Active');
    assert.equal(clientInitials('Summit Dental'), 'SD');
    assert.equal(clientInitials('12 Volt Automotive'), '12');
    assert.equal(clientInitials('Acme'), 'AC');
    assert.equal(clientInitials('   '), '?');
});

test('recent client ids ignore junk and keep the newest first', () => {
    assert.deepEqual(parseIdList('nope'), []);
    assert.deepEqual(parseIdList(JSON.stringify(['a', '', 'a', 2, 'b'])), ['a', 'b']);
    assert.deepEqual(rememberClientId(['b', 'c'], 'a', 2), ['a', 'b']);
    assert.deepEqual(rememberClientId(['a', 'b'], 'b', 5), ['b', 'a']);
});
