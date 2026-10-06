import { test } from 'node:test';
import assert from 'node:assert/strict';
import { first90Days, metricNumber, percentChange, portalDate, portalToday, upcomingWeeks } from './dashboard.ts';
import type { PortalPlanItem } from './progress';
const item = (id: string, dueDate?: string, status: 'todo' | 'done' = 'todo'): PortalPlanItem => ({ id, stepKey: 'content', title: id, status, sortOrder: 0, dueDate });

test('milestones follow exact launch-date windows, not calendar months or fabricated completion', () => {
    const milestones = first90Days([item('before', '2026-08-31'), item('first', '2026-09-01', 'done'), item('last-first', '2026-09-30'), item('second', '2026-10-01'), item('third', '2026-10-31'), item('outside', '2026-11-30'), item('unknown')], '2026-09-01')!;
    assert.deepEqual(milestones.map(window => window.items.map(entry => entry.id)), [['first', 'last-first'], ['second'], ['third']]);
    assert.equal(milestones[0].completed, 1);
    assert.equal(milestones[2].end, '2026-11-29');
    assert.equal(first90Days([], 'invalid'), null);
    assert.equal(first90Days([], undefined), null);
});

test('upcoming weeks include only scheduled unfinished work and keep overdue work separate', () => {
    const weeks = upcomingWeeks([item('today', '2026-10-06'), item('last', '2026-10-12'), item('next', '2026-10-13'), item('past', '2026-10-05'), item('done', '2026-10-06', 'done'), item('undated')], '2026-10-06');
    assert.equal(weeks.length, 5);
    assert.deepEqual(weeks[0].items.map(entry => entry.id), ['today', 'last']);
    assert.deepEqual(weeks[1].items.map(entry => entry.id), ['next']);
    assert.deepEqual(upcomingWeeks([], 'invalid'), []);
});

test('missing measurements and a zero baseline do not imply growth', () => {
    assert.equal(metricNumber(undefined), null);
    assert.equal(metricNumber('25'), null);
    assert.equal(metricNumber(NaN), null);
    assert.equal(metricNumber(-1), null);
    assert.equal(metricNumber(0), 0);
    assert.equal(percentChange(100, 0), null);
    assert.equal(percentChange(null, 20), null);
    assert.equal(percentChange(0, 100), -100);
    assert.equal(percentChange(104, 100), 4);
    assert.equal(portalDate('2026-09-01'), 'Sep 1, 2026');
});

test('portal calendar dates follow the agency timezone at a UTC month boundary', () => {
    assert.equal(portalToday(new Date('2026-11-01T02:00:00Z')), '2026-10-31');
});
