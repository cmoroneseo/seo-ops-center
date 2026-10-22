import assert from 'node:assert/strict';
import test from 'node:test';

import { completedLeavesInMonth } from '../seo-plan/done-this-month.ts';
import type { StageListTask } from '../seo-plan/stage-list.ts';
import {
    acceptedCompletionInstant,
    completionCalendarDay,
    resolveCompletionInstant,
} from './completion-date.ts';

const NOW = new Date('2026-10-21T18:00:00.000Z');
const ZONE = 'America/Los_Angeles';

function leaf(completedAt: string, id = 'seo'): StageListTask {
    return {
        id,
        title: 'September SEO Content',
        status: 'done',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-09-01T15:00:00.000Z',
        category: 'content',
        basecamp: false,
        recurring: false,
        completedAt,
    };
}

test('today is the default and uses the current instant', () => {
    const resolved = resolveCompletionInstant({ choice: { kind: 'today' }, now: NOW, timeZone: ZONE });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.day, '2026-10-21');
    assert.equal(resolved.completedAt, '2026-10-21T18:00:00.000Z');
    assert.equal(completionCalendarDay(new Date(resolved.completedAt), ZONE), '2026-10-21');
});

test('yesterday and a backdated day land at midday in the user zone', () => {
    const yesterday = resolveCompletionInstant({ choice: { kind: 'yesterday' }, now: NOW, timeZone: ZONE });
    assert.equal(yesterday.ok, true);
    if (!yesterday.ok) return;
    assert.equal(yesterday.day, '2026-10-20');
    assert.equal(yesterday.completedAt, '2026-10-20T19:00:00.000Z');

    const september = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-09-30' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.equal(september.ok, true);
    if (!september.ok) return;
    assert.equal(september.day, '2026-09-30');
    assert.equal(september.completedAt, '2026-09-30T19:00:00.000Z');
    assert.equal(completionCalendarDay(new Date(september.completedAt), ZONE), '2026-09-30');
});

test('a date input of today uses the current instant, and future or invalid days are rejected', () => {
    const today = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-10-21' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.equal(today.ok, true);
    if (today.ok) assert.equal(today.completedAt, NOW.toISOString());

    const future = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-10-22' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.deepEqual(future, { ok: false, error: 'Pick today or a past day.' });

    const impossible = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-02-31' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.equal(impossible.ok, false);
    if (!impossible.ok) assert.equal(impossible.error, 'Enter a real date.');

    assert.equal(acceptedCompletionInstant('2026-09-30T19:00:00.000Z', NOW.toISOString()), '2026-09-30T19:00:00.000Z');
    assert.equal(acceptedCompletionInstant('2026-10-21T18:01:00.000Z', NOW.toISOString()), '2026-10-21T18:01:00.000Z');
    assert.equal(acceptedCompletionInstant('2026-10-21T18:30:00.000Z', NOW.toISOString()), null);
    assert.equal(acceptedCompletionInstant('not-a-date', NOW.toISOString()), null);
});

test('a backdated completion counts in the month it was finished', () => {
    const finished = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-09-30' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.equal(finished.ok, true);
    if (!finished.ok) return;
    const tasks = [leaf(finished.completedAt)];
    assert.deepEqual(completedLeavesInMonth(tasks, '2026-09', ZONE).map(task => task.id), ['seo']);
    assert.deepEqual(completedLeavesInMonth(tasks, '2026-10', ZONE).map(task => task.id), []);

    const lateEvening = leaf('2026-10-01T06:30:00.000Z', 'late');
    assert.deepEqual(completedLeavesInMonth([lateEvening], '2026-09', ZONE).map(task => task.id), ['late']);
    assert.deepEqual(completedLeavesInMonth([lateEvening], '2026-10', ZONE).map(task => task.id), []);
});
