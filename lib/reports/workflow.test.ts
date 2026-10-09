import test from 'node:test';
import assert from 'node:assert/strict';
import { closeCard, emptyReview, needsOwnerApproval, ownerApprovalPending, planReviewAction, type Actor, type ReviewRecord } from './workflow';

const NOW = new Date('2026-10-08T17:00:00.000Z');
const am: Actor = { userId: '33333333-3333-4333-8333-333333333333', role: 'member' };
const owner: Actor = { userId: '22222222-2222-4222-8222-222222222222', role: 'owner' };

function plan(patch: Partial<Parameters<typeof planReviewAction>[0]> = {}) {
    return planReviewAction({
        review: emptyReview(),
        action: 'approve',
        actor: am,
        note: null,
        hasRecipient: false,
        recipientContactId: null,
        clientCreatedAt: '2024-01-01T00:00:00.000Z',
        reportCount: 5,
        reportMonth: '2026-09',
        now: NOW,
        checksPass: true,
        ...patch,
    });
}

test('a client under 90 days, or on its first two reports, needs the owner', () => {
    assert.equal(needsOwnerApproval({ clientCreatedAt: '2026-08-01T00:00:00.000Z', now: NOW, reportCount: 6 }), true);
    assert.equal(needsOwnerApproval({ clientCreatedAt: '2026-07-10T17:00:00.000Z', now: NOW, reportCount: 6 }), false);
    assert.equal(needsOwnerApproval({ clientCreatedAt: '2020-01-01T00:00:00.000Z', now: NOW, reportCount: 2 }), true);
    assert.equal(needsOwnerApproval({ clientCreatedAt: '2020-01-01T00:00:00.000Z', now: NOW, reportCount: 3 }), false);
    assert.equal(needsOwnerApproval({ clientCreatedAt: null, now: NOW, reportCount: 8 }), true);
});

test('the account manager freezes an established client, and scheduling waits for a recipient', () => {
    const approved = plan();
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.capture, true);
    assert.equal(approved.toState, 'approved');
    assert.equal(approved.updatePortal, true);
    assert.equal(approved.notifyClient, false);

    const review: ReviewRecord = {
        ...emptyReview(),
        exists: true,
        state: 'approved',
        amApprovedBy: am.userId,
        currentVersionId: 'version',
    };
    const blocked = plan({ review, action: 'schedule' });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.match(blocked.error, /recipient/);

    const scheduled = plan({
        review,
        action: 'schedule',
        hasRecipient: true,
        recipientContactId: '44444444-4444-4444-8444-444444444444',
        now: new Date('2026-10-01T15:00:00.000Z'),
    });
    assert.equal(scheduled.ok, true);
    if (!scheduled.ok) return;
    assert.equal(scheduled.toState, 'scheduled');
    assert.equal(scheduled.scheduledFor, '2026-10-07T16:00:00.000Z');
    assert.equal(scheduled.notifyClient, false);
});

test('a new client stays in review until the owner signs the same version', () => {
    const first = plan({ clientCreatedAt: '2026-09-01T00:00:00.000Z', reportCount: 1 });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.toState, 'ready_for_review');
    assert.equal(first.capture, true);
    assert.equal(first.updatePortal, false);
    assert.equal(first.requiresOwnerApproval, true);

    const review: ReviewRecord = {
        ...emptyReview(),
        exists: true,
        state: 'ready_for_review',
        requiresOwnerApproval: true,
        amApprovedBy: am.userId,
        currentVersionId: 'version-1',
    };
    assert.equal(ownerApprovalPending(review), true);
    const member = plan({ review, clientCreatedAt: '2026-09-01T00:00:00.000Z', reportCount: 1 });
    assert.equal(member.ok, false);
    if (member.ok) return;
    assert.equal(member.status, 403);

    const signed = plan({ review, actor: owner, clientCreatedAt: '2026-09-01T00:00:00.000Z', reportCount: 1 });
    assert.equal(signed.ok, true);
    if (!signed.ok) return;
    assert.equal(signed.capture, false);
    assert.equal(signed.currentVersionId, 'version-1');
    assert.equal(signed.toState, 'approved');
    assert.equal(signed.ownerApprovedBy, owner.userId);
    assert.equal(signed.updatePortal, true);
});

test('a correction creates a new version and does not email', () => {
    const review: ReviewRecord = {
        ...emptyReview(),
        exists: true,
        state: 'scheduled',
        amApprovedBy: am.userId,
        currentVersionId: 'version-1',
        scheduledFor: '2026-10-07T16:00:00.000Z',
        recipientContactId: '44444444-4444-4444-8444-444444444444',
    };
    const missing = plan({ review, action: 'correct' });
    assert.equal(missing.ok, false);
    const corrected = plan({ review, action: 'correct', note: 'Fixed the September click total.' });
    assert.equal(corrected.ok, true);
    if (!corrected.ok) return;
    assert.equal(corrected.capture, true);
    assert.equal(corrected.reason, 'correction');
    assert.equal(corrected.toState, 'approved');
    assert.equal(corrected.scheduledFor, null);
    assert.equal(corrected.notifyClient, false);
});

test('a viewer cannot approve, and the board lane is separate from the columns', () => {
    const denied = plan({ actor: { ...am, role: 'viewer' } });
    assert.equal(denied.ok, false);
    if (denied.ok) return;
    assert.equal(denied.status, 403);

    const waiting = closeCard({
        reportId: 'r',
        clientId: 'c',
        reportMonth: '2026-09',
        state: 'draft',
        gscConnected: false,
        hasRecipient: false,
        requiresOwnerApproval: false,
        ownerApprovalPending: false,
        checks: [{ id: 'month_final', source: 'gsc', severity: 'blocking', ok: false, message: 'not connected' }],
    });
    assert.equal(waiting.lane, 'waiting_on_data');
    assert.equal(waiting.column, null);

    const ready = closeCard({
        reportId: 'r',
        clientId: 'c',
        reportMonth: '2026-09',
        state: 'draft',
        gscConnected: true,
        hasRecipient: false,
        requiresOwnerApproval: false,
        ownerApprovalPending: false,
        checks: [{ id: 'sync_error', source: 'ahrefs', severity: 'warn', ok: false, message: 'Ahrefs error' }],
    });
    assert.equal(ready.column, 'ready');
    assert.equal(ready.trackerWarning, true);
    assert.equal(ready.schedulingWaitsForRecipient, true);

    const stillApproved = closeCard({
        reportId: 'r',
        clientId: 'c',
        reportMonth: '2026-09',
        state: 'approved',
        gscConnected: false,
        hasRecipient: false,
        requiresOwnerApproval: false,
        ownerApprovalPending: false,
        checks: [{ id: 'month_final', source: 'gsc', severity: 'blocking', ok: false, message: 'not connected' }],
    });
    assert.equal(stillApproved.lane, null);
    assert.equal(stillApproved.column, 'approved');
});
