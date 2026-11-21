import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INITIATIVE_STATES, type CampaignInitiative } from '@/lib/campaign-workspace/initiatives';
import {
    activeSidebarProjectId,
    buildSidebarProjects,
    isProjectsGridActive,
    notifyProjectsChanged,
    PROJECT_DOT_CLASS,
    PROJECT_STATUS,
    SIDEBAR_PROJECTS_LIMIT,
} from './sidebar-projects';

function project(id: string, overrides: Partial<CampaignInitiative> = {}): CampaignInitiative {
    return {
        id, title: id, clientId: 'summit', organizationId: 'org', state: 'planned',
        priority: 2, startsOn: null, endsOn: null, purpose: null, ownerName: null,
        phase: null, category: null, targetMonth: null, pageUrl: null, successMetricLabel: null,
        evidenceUrl: null, verifiedOn: null, items: [],
        ...overrides,
    };
}

test('projects are ordered by priority, date, name, and ID', () => {
    const rows = [
        project('undated'),
        project('later', { startsOn: '2026-11-20' }),
        project('b', { endsOn: '2026-11-10', title: 'Alpha' }),
        project('z', { startsOn: '2026-11-10', title: 'Zebra' }),
        project('a', { startsOn: '2026-11-10', title: 'Alpha' }),
        project('priority', { priority: 1 }),
    ];
    assert.deepEqual(buildSidebarProjects(rows).visible.map(row => row.id), [
        'priority', 'a', 'b', 'z', 'later', 'undated',
    ]);
    assert.equal(rows[0].id, 'undated');
});

test('the sidebar caps the list at eight and tracks overflow', () => {
    const rows = Array.from({ length: 9 }, (_, index) => project(String(index)));
    const result = buildSidebarProjects(rows);
    assert.equal(SIDEBAR_PROJECTS_LIMIT, 8);
    assert.equal(result.visible.length, 8);
    assert.equal(result.total, 9);
    assert.equal(result.hasMore, true);
    assert.equal(buildSidebarProjects(rows.slice(0, 8)).hasMore, false);
    assert.equal(buildSidebarProjects(rows, 2).visible.length, 2);
});

test('project and grid activity match the exact client workspace and tab', () => {
    const path = '/workspace/summit';
    const detail = '?tab=projects&projectId=alpha';
    assert.equal(activeSidebarProjectId(path, detail, 'summit'), 'alpha');
    assert.equal(isProjectsGridActive(path, detail, 'summit'), false);
    assert.equal(activeSidebarProjectId(path, 'tab=projects', 'summit'), null);
    assert.equal(isProjectsGridActive(path, 'tab=projects&newProject=1', 'summit'), true);
    for (const [pathname, search] of [
        ['/workspace/maya', detail], ['/workspace/summit/extra', detail],
        [path, 'tab=tasks&projectId=alpha'],
    ]) {
        assert.equal(activeSidebarProjectId(pathname, search, 'summit'), null);
        assert.equal(isProjectsGridActive(pathname, search, 'summit'), false);
    }
    assert.equal(isProjectsGridActive('/workspace/maya', 'tab=projects', 'summit'), false);
});

test('every project state has a status color and label', () => {
    assert.deepEqual(INITIATIVE_STATES.map(state => PROJECT_DOT_CLASS[state]), [
        'bg-zinc-400', 'bg-blue-500', 'bg-amber-500', 'bg-rose-500', 'bg-zinc-500', 'bg-emerald-500',
    ]);
    for (const state of INITIATIVE_STATES) assert.ok(PROJECT_STATUS[state].label);
    assert.doesNotThrow(() => notifyProjectsChanged('summit'));
});

test('both menus mount the project section and expose project, grid, and create links', () => {
    const section = readFileSync('components/dashboard/SidebarProjects.tsx', 'utf8');
    assert.match(section, /visible\.map\(project/);
    assert.match(section, /projectsHref\(clientId, \{ projectId: project\.id \}\)/);
    assert.match(section, /PROJECT_DOT_CLASS\[project\.state\]/);
    assert.match(section, /aria-current=\{active \? 'page' : undefined\}/);
    assert.match(section, /No projects yet/);
    assert.match(section, /All projects/);
    assert.match(section, /projectsHref\(clientId, \{ create: true \}\)/);
    assert.match(section, /aria-label="New project"/);
    assert.match(section, /<Plus /);
    for (const menu of ['Sidebar', 'MobileNav']) {
        const source = readFileSync(`components/dashboard/${menu}.tsx`, 'utf8');
        assert.match(source, /section\.id === \(pipelineNav \? 'delivery' : 'workspace'\)/);
        assert.match(source, /<SidebarProjects/);
    }
});

import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SidebarProjectsList } from '../../components/dashboard/SidebarProjects';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('SidebarProjectsList renders ordered items, cap, active highlight, status dots, and empty state', () => {
    const nine = Array.from({ length: 9 }, (_, i) => project(`p-${i}`, {
        title: `Project ${i}`,
        priority: i === 8 ? 1 : 2,
        state: i === 8 ? 'blocked' : 'in_progress',
    }));
    const html = renderToStaticMarkup(createElement(SidebarProjectsList, {
        clientId: 'summit',
        projects: nine,
        pathname: '/workspace/summit',
        search: '?tab=projects&projectId=p-8',
    }));
    // Priority 1 item (p-8) sorts first; 9th item (p-7) is capped out of the sidebar list.
    assert.match(html, /<a[^>]*aria-current="page"[^>]*href="\/workspace\/summit\?tab=projects&amp;projectId=p-8"/);
    assert.match(html, /bg-rose-500/);
    assert.match(html, /Project 8/);
    assert.equal(html.includes('Project 7'), false);
    assert.match(html, /<a[^>]*aria-label="New project"[^>]*href="\/workspace\/summit\?tab=projects&amp;newProject=1"/);
    assert.match(html, /href="\/workspace\/summit\?tab=projects"[^>]*>All projects<\/a>/);

    const gridHtml = renderToStaticMarkup(createElement(SidebarProjectsList, {
        clientId: 'summit',
        projects: [],
        pathname: '/workspace/summit',
        search: '?tab=projects',
    }));
    assert.match(gridHtml, /No projects yet/);
    assert.match(gridHtml, /<a[^>]*aria-current="page"[^>]*href="\/workspace\/summit\?tab=projects"[^>]*>All projects<\/a>/);
});
