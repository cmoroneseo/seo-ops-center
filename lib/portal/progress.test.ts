import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildPendingInbox, decisionActionAllowed, isRecentShipped, planDecisionState,
    portalDeliverable, portalPlanItem, recentMonthKeys,
} from './progress.ts';

const MONTHS = ['2026-09', '2026-08'] as const;

test('recent months are the UTC month and the one before it', () => {
    assert.deepEqual(recentMonthKeys(new Date('2026-09-30T23:00:00Z')), ['2026-09', '2026-08']);
    assert.deepEqual(recentMonthKeys(new Date('2026-01-01T00:00:00Z')), ['2026-01', '2025-12']);
});

test('portal deliverables drop internal fields and pending work', () => {
    const raw = {
        id: 'd1',
        title: 'September blog',
        type: 'Content',
        subtype: 'blog',
        status: 'Published',
        month: '2026-09',
        publishedUrl: 'https://client.example/blog',
        deliveredOn: '2026-09-12',
        notes: 'Do not show the writer note',
        assignee: 'Abel',
        statusHistory: [{ by: 'internal' }],
    };
    const item = portalDeliverable(raw, MONTHS);
    assert.ok(item);
    assert.equal(item.bucket, 'shipped');
    assert.equal(item.publishedUrl, 'https://client.example/blog');
    assert.equal('notes' in item, false);
    assert.equal('assignee' in item, false);
    assert.equal('statusHistory' in item, false);
    assert.deepEqual(Object.keys(item).sort(), [
        'bucket', 'deliveredOn', 'id', 'month', 'publishedUrl', 'subtype', 'title', 'type',
    ]);

    assert.equal(portalDeliverable({ ...raw, status: 'Pending' }, MONTHS), null);
    const inProgress = portalDeliverable({ ...raw, status: 'Review', publishedUrl: 'https://draft.example' }, MONTHS);
    assert.equal(inProgress?.bucket, 'in_progress');
    assert.equal(inProgress?.publishedUrl, undefined);
    assert.equal(portalDeliverable({ ...raw, publishedUrl: 'javascript:alert(1)' }, MONTHS)?.publishedUrl, undefined);
});

test('shipped work outside the recent window stays off the home', () => {
    assert.equal(isRecentShipped('2026-01', null, MONTHS), false);
    assert.equal(portalDeliverable({
        id: 'old',
        title: 'January blog',
        type: 'Content',
        status: 'Approved',
        month: '2026-01',
    }, MONTHS), null);
    assert.ok(portalDeliverable({
        id: 'late',
        title: 'August links',
        type: 'Backlink',
        status: 'Approved',
        month: '2026-07',
        deliveredOn: '2026-08-02T00:00:00Z',
    }, MONTHS));
});

test('plan items hide ignored rows, comments, assignees, and tasks', () => {
    const hidden = portalPlanItem({
        id: 'i1',
        stepKey: 'setup',
        title: 'Skip this',
        status: 'ignored',
        description: 'internal',
    });
    assert.equal(hidden, null);

    const raw = {
        id: 'i2',
        stepKey: 'content',
        title: 'Publish the service page',
        description: '  A page for the core service.  ',
        status: 'done' as const,
        dueDate: '2026-09-15',
        sortOrder: 3,
        comments: [{ body: 'writer chatter', authorName: 'Abel' }],
        assigneeId: 'user-1',
        taskId: 'task-1',
        priority: 'high',
    };
    const item = portalPlanItem(raw);
    assert.deepEqual(item, {
        id: 'i2',
        stepKey: 'content',
        title: 'Publish the service page',
        description: 'A page for the core service.',
        status: 'done',
        dueDate: '2026-09-15',
        sortOrder: 3,
    });
});

test('plan decisions follow the latest share request', () => {
    assert.equal(planDecisionState({ shared: false, latest: { decision: 'approved', decidedAt: '2026-09-02T00:00:00Z' } }), 'hidden');
    assert.equal(planDecisionState({
        shared: true,
        approvalRequestedAt: '2026-09-01T00:00:00Z',
        latest: null,
    }), 'awaiting');
    assert.equal(planDecisionState({
        shared: true,
        approvalRequestedAt: '2026-09-10T00:00:00Z',
        latest: { decision: 'approved', decidedAt: '2026-09-02T00:00:00Z' },
    }), 'awaiting');
    assert.equal(planDecisionState({
        shared: true,
        approvalRequestedAt: '2026-09-01T00:00:00Z',
        latest: { decision: 'changes_requested', decidedAt: '2026-09-03T00:00:00Z' },
    }), 'changes_requested');
    assert.equal(decisionActionAllowed('approved', 'approved'), false);
    assert.equal(decisionActionAllowed('approved', 'changes_requested'), true);
    assert.equal(decisionActionAllowed('hidden', 'approved'), false);
});

test('pending inbox is plan, waiting items, then content review handoff', () => {
    const inbox = buildPendingInbox({
        plan: { needsDecision: true, title: 'SEO Plan' },
        waiting: [{ id: 'w1', title: 'Send the logo files', detail: ' PNG or SVG ' }],
        reviews: [{ id: '11111111-1111-4111-8111-111111111111', name: 'September blogs' }],
    });
    assert.deepEqual(inbox.map(item => item.kind), ['plan', 'waiting_item', 'content_review']);
    assert.equal(inbox[0].href, '/portal/plan');
    assert.equal(inbox[1].detail, 'PNG or SVG');
    assert.equal(inbox[2].external, true);
    assert.equal(inbox[2].href, '/api/client-portal/review-handoff/11111111-1111-4111-8111-111111111111');

    const quiet = buildPendingInbox({ plan: { needsDecision: false, title: 'SEO Plan' }, waiting: [], reviews: [] });
    assert.deepEqual(quiet, []);
});
