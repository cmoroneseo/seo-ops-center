import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationNeedsReply, deliveryTiming, isOnboarding, portalReadiness, validPortalDate } from './readiness';
import { publishedItems, samePlanScope, type PortalPlanSnapshot } from './publication';
import type { PortalFeedbackEntry } from './progress';

const date = '2026-10-06';
const snapshot: PortalPlanSnapshot = { planId: 'plan', title: 'Plan', steps: [], createdAt: '',
    items: [{ id: 'a', stepKey: 'content', title: 'Approved article', status: 'todo', sortOrder: 1, dueDate: '2026-10-10' }] };

test('onboarding ends exactly after 90 days and rejects invalid/future start dates', () => {
    assert.equal(isOnboarding('2026-03-19', date), false);
    assert.equal(isOnboarding('2026-10-01', date), true);
    assert.equal(isOnboarding('2026-10-07', date), false);
    assert.equal(isOnboarding('2026-07-08', date), false);
    assert.equal(isOnboarding(undefined, date), false);
    assert.equal(validPortalDate('2026-02-30'), null);
    assert.equal(validPortalDate('2026-10-06<script>'), null);
});

test('published plan scope and dates stay frozen while completion updates', () => {
    const changed = structuredClone(snapshot);
    changed.items[0].title = 'An unapproved different article';
    changed.items[0].dueDate = '2026-12-01';
    changed.items[0].status = 'done';
    changed.items.push({ id: 'internal', stepKey: 'content', title: 'Unpublished item', status: 'todo', sortOrder: 2 });
    const displayed = publishedItems(snapshot, changed);
    assert.equal(displayed.length, 1);
    assert.equal(displayed[0].title, 'Approved article');
    assert.equal(displayed[0].dueDate, '2026-10-10');
    assert.equal(displayed[0].status, 'done');
    assert.equal(snapshot.items[0].status, 'todo');
    assert.equal(samePlanScope(snapshot, changed), false);
    const completionOnly = structuredClone(snapshot); completionOnly.items[0].status = 'done';
    assert.equal(samePlanScope(snapshot, completionOnly), true);
});

test('readiness does not require a monthly report and flags unexplained overdue work', () => {
    const ready = { sharedPlan: true, items: snapshot.items, hasUpdate: true, today: date,
        deliverables: [{ status: 'Review', dueDate: '2026-05-31' }] };
    assert.equal(portalReadiness(ready).find(item => item.key === 'timing')?.complete, false);
    assert.ok(portalReadiness({ ...ready, deliverables: [{ ...ready.deliverables[0], timingNote: 'The team is confirming the review schedule.' }] }).every(item => item.complete));
    assert.equal(deliveryTiming({ id: 'a', title: '', type: '', status: 'in_review', bucket: 'in_progress', dueDate: '2026-05-31', revisedDueDate: '2026-10-10' }, date).overdue, false);
});

test('a later client note remains unanswered after handling an older note', () => {
    const entry = (time: string, author: 'team' | 'client'): PortalFeedbackEntry => ({ id: time, subjectType: 'general', subjectId: 'client', authorType: author, authorLabel: author, body: 'Note', createdAt: time });
    const older = entry('2026-10-05T00:00:00Z', 'client'), newer = entry('2026-10-06T00:00:00Z', 'client');
    assert.equal(conversationNeedsReply([older, newer], older.createdAt), true);
    assert.equal(conversationNeedsReply([older, entry('2026-10-05T01:00:00Z', 'team'), newer]), true);
    assert.equal(conversationNeedsReply([older, newer, entry('2026-10-06T01:00:00Z', 'team')]), false);
    assert.equal(conversationNeedsReply([], null), false);
});

test('report titles cannot claim a different reporting month', async () => {
    const { reportTitleMonthMismatch } = await import('./readiness');
    assert.equal(reportTitleMonthMismatch('July 2026 SEO Report', '2026-06'), true);
    assert.equal(reportTitleMonthMismatch('July 2026 SEO Report', '2026-07'), false);
    assert.equal(reportTitleMonthMismatch('Monthly SEO Report', '2026-07'), false);
});
