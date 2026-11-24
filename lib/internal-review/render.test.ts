import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InternalReview } from '@/components/internal-review/InternalReview';
import type { InternalReviewPost } from './model';

const update: InternalReviewPost = {
    itemId: 'update-item',
    versionId: 'update-version',
    position: 1,
    title: 'Holiday hours',
    body: 'We are open on Saturday.',
    postType: 'update',
    scheduledDate: '2026-12-15',
    offerStart: null,
    offerEnd: null,
    terms: '',
    ctaUrl: null,
    ctaLabel: '',
    photoSrc: null,
    feedback: [],
};

function renderPost(fields: Partial<InternalReviewPost> = {}) {
    return renderToStaticMarkup(createElement(InternalReview, {
        view: { clientName: 'Fixture Client', batches: [{ title: 'December drafts', posts: [{ ...update, ...fields }] }] },
    }));
}

test('the internal page renders an update with null offer dates', () => {
    const html = renderPost();
    assert.match(html, /Holiday hours/);
    assert.match(html, /Scheduled for <time dateTime="2026-12-15">2026-12-15<\/time>/);
    assert.doesNotMatch(html, /Offer dates/);
});

test('the internal page hides empty, malformed and impossible scheduled dates', () => {
    for (const scheduledDate of ['', 'not a date', '2026-02-30']) {
        assert.doesNotMatch(renderPost({ scheduledDate }), /Scheduled for|<time/);
    }
});

test('the internal page only shows an offer date range for offers with two valid dates', () => {
    assert.doesNotMatch(renderPost({ offerStart: '2026-12-01', offerEnd: '2026-12-31' }), /Offer dates/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '2026-12-01' }), /Offer dates/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '', offerEnd: '2026-12-31' }), /Offer dates/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '2026-12-01', offerEnd: '2026-12-32' }), /Offer dates/);
    assert.match(renderPost({ postType: 'offer', offerStart: '2026-12-01', offerEnd: '2026-12-31' }), /Offer dates 2026-12-01 to 2026-12-31/);
});

test('the internal page gives a null-date update a numbered gallery and a photo feedback target', () => {
    const html = renderPost({
        photoSrcs: ['https://drive.google.com/thumbnail?id=first', 'https://example.com/second.jpg'],
        feedback: [{ reviewerName: 'Reviewer', decision: null, comment: 'Use the daytime shot', photoPosition: 2 }],
    });
    assert.match(html, /alt="Draft post photo 1 of 2"/);
    assert.match(html, /alt="Draft post photo 2 of 2"/);
    assert.match(html, /referrerPolicy="no-referrer"/i);
    assert.match(html, /<option value="2">Photo 2<\/option>/);
    assert.match(html, /Reviewer<\/strong> · Comment · Photo 2/);
    assert.doesNotMatch(html, /Offer dates/);
});
