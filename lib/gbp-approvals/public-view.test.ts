import assert from 'node:assert/strict';
import test from 'node:test';

import { diffWords } from './diff.ts';
import { projectPublicReview, publicMessage, submissionHash, taskStatusAfterFullApproval } from './public-view.ts';

const secret = 'organization-secret-and-token-raw';

test('a public review drops other requests, paths, and org data', () => {
    const view = projectPublicReview({
        ok: true,
        state: 'active',
        title: 'GBP holiday posts',
        clientName: 'ALL-IN-1 Construction',
        organizationId: secret,
        token: secret,
        tokenHash: secret,
        round: 2,
        items: [{
            id: 'item-1',
            position: 2,
            status: 'pending',
            locked: false,
            organizationId: secret,
            version: {
                id: 'version-2',
                versionNo: 2,
                photoPath: `gbp-approvals/request/object`,
                changeNote: 'Removed the leftovers line, as you suggested.',
                payload: {
                    schemaVersion: 1,
                    postType: 'offer',
                    title: 'Free Kitchen Walkthrough + Written Quote in 48 Hours',
                    body: 'Tap below to request your free walkthrough.',
                    offerStart: '2026-11-23',
                    offerEnd: '2026-12-31',
                    scheduledDate: '2026-11-23',
                    ctaUrl: 'https://allinone-const.com/contact/',
                    ctaLabel: 'View offer',
                    terms: 'Ends Dec 31.',
                    organizationId: secret,
                },
                previous: {
                    payload: { body: 'Once the leftovers are gone, tap below to request your free walkthrough.' },
                    photoPath: 'https://allinone-const.com/photos/post.jpg',
                },
            },
            decision: null,
        }],
        questions: [],
        otherRequestTitle: 'Second request secret',
    }, path => path.startsWith('http') ? path : `/signed/${path}`);
    assert.equal('posts' in view, true);
    if (!('posts' in view)) return;
    const encoded = JSON.stringify(view);
    assert.equal(encoded.includes(secret), false);
    assert.equal(encoded.includes('Second request secret'), false);
    assert.equal(encoded.includes('photoPath'), false);
    assert.equal(encoded.includes('tokenHash'), false);
    assert.equal(view.posts[0]?.photoSrc, '/signed/gbp-approvals/request/object');
    assert.equal(view.posts[0]?.scheduledDate, '2026-11-23');
});

test('an expired link does not include the posts', () => {
    const view = projectPublicReview({
        ok: true,
        state: 'expired',
        title: 'GBP holiday posts',
        clientName: 'ALL-IN-1 Construction',
        expiresAt: '2026-11-27T00:00:00.000Z',
        hadSubmission: true,
        items: [{ id: 'should-not-leak', version: { payload: { body: 'secret post body' } } }],
    });
    assert.equal('posts' in view, true);
    if (!('posts' in view)) return;
    assert.equal(view.posts.length, 0);
    assert.equal(view.hadSubmission, true);
    assert.equal(JSON.stringify(view).includes('secret post body'), false);
    assert.match(publicMessage('expired'), /account manager/);
    assert.match(publicMessage('refresh_required'), /Refresh/);
});

test('the same submit body hashes the same way, and a new decision does not', () => {
    const first = submissionHash({
        respondentName: 'Casey',
        displayedVersionIds: ['b', 'a'],
        decisions: [{ itemId: '1', decision: 'approved' }],
        answers: [],
    });
    const reordered = submissionHash({
        respondentName: 'Casey',
        displayedVersionIds: ['a', 'b'],
        decisions: [{ itemId: '1', decision: 'approved' }],
        answers: [],
    });
    const changed = submissionHash({
        respondentName: 'Casey',
        displayedVersionIds: ['a', 'b'],
        decisions: [{ itemId: '1', decision: 'changes_requested' }],
        answers: [],
    });
    assert.equal(first, reordered);
    assert.notEqual(first, changed);
});

test('full approval moves a to-do task to in progress and leaves done alone', () => {
    assert.equal(taskStatusAfterFullApproval('todo', true), 'in_progress');
    assert.equal(taskStatusAfterFullApproval('in_progress', true), 'in_progress');
    assert.equal(taskStatusAfterFullApproval('done', true), 'done');
    assert.equal(taskStatusAfterFullApproval('todo', false), 'todo');
});

test('the leftovers edit shows the removed phrase', () => {
    const parts = diffWords(
        'Once the leftovers are gone, tap below.',
        'tap below.',
    );
    assert.equal(parts.some(part => part.kind === 'removed' && part.text.includes('leftovers')), true);
    assert.equal(parts.some(part => part.kind === 'same' && part.text.includes('tap below')), true);
});
