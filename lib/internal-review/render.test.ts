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
