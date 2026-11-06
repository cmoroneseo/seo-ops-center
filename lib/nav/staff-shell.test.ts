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
} from './staff-shell.ts';

const flags = { keywordTracking: true, vault: true };

test('client sections follow the approved groups and omit concept rows', () => {
    const on = clientSections('summit', { keywordTracking: true, vault: false });
    assert.deepEqual(on.map(section => section.label), ['Client workspace', 'Search intelligence', 'More']);
    assert.deepEqual(on[0].links.map(link => link.label), [
        'Overview', 'SEO Plan', 'Tasks', 'Deliverables', 'Time', 'Reports',
    ]);
    assert.deepEqual(on[1].links.map(link => link.label), ['Search', 'Rankings']);
    assert.equal(on[1].links[0].href, '/workspace/summit?tab=insights');
    assert.equal(on[1].links[1].href, '/workspace/summit?tab=rankings');
    assert.ok(on[1].links.findIndex(link => link.label === 'Search') < on[1].links.findIndex(link => link.label === 'Rankings'));

    const off = clientSections('summit', { keywordTracking: false, vault: false });
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
    }), '/workspace/maya?tab=rankings');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: '?tab=rankings',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
    }), '/workspace/maya?tab=overview&navNotice=unavailable');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=campaign&planView=tasks',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
    }), '/workspace/maya?tab=campaign&planView=tasks');

    assert.equal(switchClientHref({
        fromPathname: '/tasks',
        fromSearch: 'client=summit&task=old',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: true,
    }), '/tasks?client=maya');

    assert.equal(switchClientHref({
        fromPathname: '/dashboard',
        fromSearch: '',
        targetClientId: 'maya',
        keywordTracking: false,
        vaultEnabled: false,
    }), '/workspace/maya?tab=overview');

    assert.equal(switchClientHref({
        fromPathname: '/workspace/summit',
        fromSearch: 'tab=vault',
        targetClientId: 'maya',
        keywordTracking: true,
        vaultEnabled: false,
    }), '/workspace/maya?tab=overview&navNotice=unavailable');
});

test('active rows follow the workspace tab, and the client list is not every workspace url', () => {
    const sections = clientSections('summit', flags);
    const rankings = sections[1].links[1];
    const overview = sections[0].links[0];
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', rankings, flags), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', overview, flags), false);
    assert.equal(isClientLinkActive('/workspace/summit', '', overview, flags), true);
    assert.equal(isClientLinkActive('/workspace/summit', 'tab=rankings', overview, { keywordTracking: false, vault: true }), true);
    assert.equal(isAgencyLinkActive('/workspace', '/workspace'), true);
    assert.equal(isAgencyLinkActive('/workspace/summit', '/workspace'), false);
    assert.equal(isAgencyLinkActive('/reports/close', '/reports/close?month=2026-09'), true);
    assert.equal(isAgencyLinkActive('/tasks/1', '/tasks'), true);
    assert.equal(isAgencyLinkActive('/dashboard', '/dashboard'), true);
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
