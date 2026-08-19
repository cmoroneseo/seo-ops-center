/** Run with:  node --test lib/planner/preferences.test.ts */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_PREFERENCES,
    MAX_RECENT_PROJECTS,
    recentProjectsForOrganization,
    sanitizePreferences,
    withRecentProject,
    type PlannerPreferences,
} from './preferences.ts';

const base = (): PlannerPreferences => ({ ...DEFAULT_PREFERENCES });

const P = (n: number) => ({ id: String(n), name: `Project ${n}` });

test('a newly used project goes to the front of the shortcuts', () => {
    let prefs = withRecentProject(base(), 'org-a', P(2));
    prefs = withRecentProject(prefs, 'org-a', P(1));
    const next = withRecentProject(prefs, 'org-a', P(3));
    assert.deepEqual(next.recentBasecampProjectsByOrganization['org-a'].map(p => p.id), ['3', '1', '2']);
});

test('re-using a project promotes it rather than duplicating it', () => {
    let prefs = withRecentProject(base(), 'org-a', P(3));
    prefs = withRecentProject(prefs, 'org-a', P(2));
    prefs = withRecentProject(prefs, 'org-a', P(1));
    const next = withRecentProject(prefs, 'org-a', P(3));
    assert.deepEqual(next.recentBasecampProjectsByOrganization['org-a'].map(p => p.id), ['3', '1', '2']);
});

test('recents are capped so the picker never grows unbounded', () => {
    let prefs = base();
    for (let i = 1; i <= MAX_RECENT_PROJECTS + 3; i++) {
        prefs = withRecentProject(prefs, 'org-a', P(i));
    }
    assert.equal(prefs.recentBasecampProjectsByOrganization['org-a'].length, MAX_RECENT_PROJECTS);
    // Most recent first, oldest dropped.
    assert.equal(prefs.recentBasecampProjectsByOrganization['org-a'][0].id, String(MAX_RECENT_PROJECTS + 3));
});

test('a renamed project keeps one entry, with the new name', () => {
    let prefs = withRecentProject(base(), 'org-a', { id: '1', name: 'Old name' });
    prefs = withRecentProject(prefs, 'org-a', { id: '1', name: 'New name' });
    assert.equal(prefs.recentBasecampProjectsByOrganization['org-a'].length, 1);
    assert.equal(prefs.recentBasecampProjectsByOrganization['org-a'][0].name, 'New name');
});

test('other preferences are left alone', () => {
    const prefs = { ...base(), dayStartHour: 6, showWeekends: false };
    const next = withRecentProject(prefs, 'org-a', P(1));
    assert.equal(next.dayStartHour, 6);
    assert.equal(next.showWeekends, false);
});

test('recent projects are isolated by organization', () => {
    let prefs = withRecentProject(base(), 'org-a', P(1));
    prefs = withRecentProject(prefs, 'org-b', P(2));

    assert.deepEqual(prefs.recentBasecampProjectsByOrganization['org-a'], [P(1)]);
    assert.deepEqual(prefs.recentBasecampProjectsByOrganization['org-b'], [P(2)]);
    assert.deepEqual(recentProjectsForOrganization(prefs, 'org-a'), [P(1)]);
    assert.deepEqual(recentProjectsForOrganization(prefs, 'org-c'), []);
});

test('legacy global recents are discarded because their organization cannot be proven', () => {
    const sanitized = sanitizePreferences({
        ...DEFAULT_PREFERENCES,
        recentBasecampProjects: [P(999)],
    } as Partial<PlannerPreferences> & { recentBasecampProjects: ReturnType<typeof P>[] });

    assert.deepEqual(sanitized.recentBasecampProjectsByOrganization, {});
});

test('recent Basecamp projects remain shortcuts and are not auto-selected', () => {
    const source = readFileSync(
        new URL('../../components/planner/EventDetailPanel.tsx', import.meta.url),
        'utf8',
    );
    assert.match(source, /useState<BasecampProject \| undefined>\(undefined\)/);
    assert.doesNotMatch(source, /useState<BasecampProject \| undefined>\(recentProjects\[0\]\)/);
});
