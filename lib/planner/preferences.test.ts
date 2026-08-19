/** Run with:  node --test lib/planner/preferences.test.ts */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    DEFAULT_PREFERENCES,
    MAX_RECENT_PROJECTS,
    withRecentProject,
    type PlannerPreferences,
} from './preferences.ts';

const base = (recents: { id: string; name: string }[] = []): PlannerPreferences =>
    ({ ...DEFAULT_PREFERENCES, recentBasecampProjects: recents });

const P = (n: number) => ({ id: String(n), name: `Project ${n}` });

test('a newly used project goes to the front of the shortcuts', () => {
    const next = withRecentProject(base([P(1), P(2)]), P(3));
    assert.deepEqual(next.recentBasecampProjects.map(p => p.id), ['3', '1', '2']);
});

test('re-using a project promotes it rather than duplicating it', () => {
    const next = withRecentProject(base([P(1), P(2), P(3)]), P(3));
    assert.deepEqual(next.recentBasecampProjects.map(p => p.id), ['3', '1', '2']);
});

test('recents are capped so the picker never grows unbounded', () => {
    let prefs = base();
    for (let i = 1; i <= MAX_RECENT_PROJECTS + 3; i++) prefs = withRecentProject(prefs, P(i));
    assert.equal(prefs.recentBasecampProjects.length, MAX_RECENT_PROJECTS);
    // Most recent first, oldest dropped.
    assert.equal(prefs.recentBasecampProjects[0].id, String(MAX_RECENT_PROJECTS + 3));
});

test('a renamed project keeps one entry, with the new name', () => {
    const next = withRecentProject(base([{ id: '1', name: 'Old name' }]), { id: '1', name: 'New name' });
    assert.equal(next.recentBasecampProjects.length, 1);
    assert.equal(next.recentBasecampProjects[0].name, 'New name');
});

test('other preferences are left alone', () => {
    const prefs = { ...base(), dayStartHour: 6, showWeekends: false };
    const next = withRecentProject(prefs, P(1));
    assert.equal(next.dayStartHour, 6);
    assert.equal(next.showWeekends, false);
});

test('recent Basecamp projects remain shortcuts and are not auto-selected', () => {
    const source = readFileSync(
        new URL('../../components/planner/EventDetailPanel.tsx', import.meta.url),
        'utf8',
    );
    assert.match(source, /useState<BasecampProject \| undefined>\(undefined\)/);
    assert.doesNotMatch(source, /useState<BasecampProject \| undefined>\(recentProjects\[0\]\)/);
});
