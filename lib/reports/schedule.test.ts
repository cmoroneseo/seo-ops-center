import test from 'node:test';
import assert from 'node:assert/strict';
import { planReportSends, reportSendTarget, sendWindowOpen, type DueReview } from './schedule';

const review: DueReview = {
    reviewId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    organizationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    clientId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reportId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    versionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    state: 'approved',
    reportMonth: '2026-10',
    contactId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    scheduledFor: null,
    sendStatus: null,
};

test('October is due on November 6 2026 at 9:00 AM Pacific, which is 17:00 UTC', () => {
    const target = reportSendTarget('2026-10');
    assert.ok(target);
    assert.equal(target.toISOString(), '2026-11-06T17:00:00.000Z');
    assert.equal(sendWindowOpen(target), true);
    assert.equal(sendWindowOpen(new Date(target.getTime() - 60 * 60 * 1000)), false);
});

test('a summer report is due at 16:00 UTC, and the other cron hour does nothing', () => {
    const target = reportSendTarget('2026-05');
    assert.ok(target);
    assert.equal(target.toISOString().endsWith('T16:00:00.000Z'), true);
    assert.equal(sendWindowOpen(target), true);
    assert.equal(sendWindowOpen(new Date(target.getTime() + 60 * 60 * 1000)), false);
});

test('Saturday and a federal holiday are outside the window', () => {
    assert.equal(sendWindowOpen(new Date('2026-11-07T17:00:00.000Z')), false);
    assert.equal(sendWindowOpen(new Date('2026-11-11T17:00:00.000Z')), false);
});

test('an approved report with a contact is emailed once it is due, and a missing contact is portal-only', () => {
    const now = new Date('2026-11-06T17:00:00.000Z');
    const [email] = planReportSends({ now, reviews: [review] });
    assert.equal(email.action, 'email');
    assert.equal(email.insert, true);
    assert.equal(email.reason, 'due');
    const [portal] = planReportSends({ now, reviews: [{ ...review, contactId: null }] });
    assert.equal(portal.action, 'portal_only');
    assert.equal(portal.reason, 'no_contact');
    const [early] = planReportSends({ now: new Date('2026-11-05T17:00:00.000Z'), reviews: [review] });
    assert.equal(early.action, 'skip');
    assert.equal(early.reason, 'not_due');
});

test('drafts are not sent, and a sent version is not sent again', () => {
    const now = new Date('2026-11-06T17:00:00.000Z');
    const [draft] = planReportSends({ now, reviews: [{ ...review, state: 'draft' }] });
    assert.equal(draft.action, 'skip');
    assert.equal(draft.reason, 'not_approved');
    const [sent] = planReportSends({ now, reviews: [{ ...review, state: 'scheduled', sendStatus: 'sent' }] });
    assert.equal(sent.action, 'skip');
    assert.equal(sent.reason, 'already_sent');
});
