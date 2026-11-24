import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemErrorBoundary } from '../../components/approvals-v2/ItemErrorBoundary';
import { monthDay, offerRange, weekday } from '../../components/gbp-approvals/sample';
import type { ReviewPost } from '../../components/gbp-approvals/PublicReview';
import type { GbpPostPayload } from './registry';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { PublicReview } = require('../../components/gbp-approvals/PublicReview') as typeof import('../../components/gbp-approvals/PublicReview');
const { GbpPostPreview } = require('../../components/gbp-approvals/GbpPostPreview') as typeof import('../../components/gbp-approvals/GbpPostPreview');
const { PreviewDialog } = require('../../components/approvals-v2/PreviewDialog') as typeof import('../../components/approvals-v2/PreviewDialog');

const updatePayload: GbpPostPayload = {
    schemaVersion: 1,
    postType: 'update',
    title: 'December update',
    body: 'Our December hours have changed.',
    scheduledDate: '2026-12-22',
    offerStart: null,
    offerEnd: null,
    ctaUrl: 'https://example.com/hours',
    ctaLabel: 'Learn more',
    terms: '',
};
const update: ReviewPost = {
    ...updatePayload, position: 1, scheduled: updatePayload.scheduledDate, photo: null, status: 'pending',
};
const offer: ReviewPost = { ...update, postType: 'offer', offerStart: '2026-12-01', offerEnd: '2026-12-31' };

test('calendar formatters handle missing and invalid dates', () => {
    for (const date of ['', null, undefined, 'garbage', '2026-13-40', '2026-02-29', '2026-12-22\n', '2026-2-09']) {
        assert.equal(monthDay(date), '', String(date));
        assert.equal(weekday(date), '', String(date));
    }
    assert.equal(monthDay('2026-12-22'), 'Dec 22');
    assert.equal(weekday('2026-12-22'), 'Tue, Dec 22');
    assert.equal(monthDay('2028-02-29'), 'Feb 29');
});

test('only explicit or legacy offers with two valid dates have an offer range', () => {
    assert.equal(offerRange({ ...offer, postType: 'update' }), null);
    assert.equal(offerRange({ ...offer, postType: 'event' }), null);
    assert.equal(offerRange({ ...offer, offerStart: null }), null);
    assert.equal(offerRange({ ...offer, offerEnd: '2026-11-31' }), null);
    assert.equal(offerRange({ ...offer, postType: undefined, offerEnd: '' }), null);
    assert.equal(offerRange({ ...offer, postType: undefined }), 'Dec 1 – Dec 31');
    assert.equal(offerRange(offer), 'Dec 1 – Dec 31');
});

test('GBP previews omit the date line for updates and keep it for offers', () => {
    function render(post: ReviewPost) {
        return renderToStaticMarkup(createElement(GbpPostPreview, { post, clientName: 'Client' }));
    }

    assert.doesNotMatch(render({ ...update, offerStart: '', offerEnd: '' }), /class="gbp-post-offer-date"/);
    assert.doesNotMatch(render(update), /class="gbp-post-offer-date"/);
    assert.match(render(offer), /<p class="gbp-post-offer-date">Dec 1 – Dec 31<\/p>/);
});

test('the staff preview dialog and its update item can render', () => {
    const dialog = renderToStaticMarkup(createElement(PreviewDialog, {
        clientName: 'Client',
        items: [{ id: 'item', payload: updatePayload, photoUrl: null }],
    }));
    assert.match(dialog, /Preview as client/);

    // Radix renders the dialog portal in the browser. Render its item preview here.
    const item = renderToStaticMarkup(createElement(ItemErrorBoundary, { title: update.title },
        createElement(GbpPostPreview, { post: update, clientName: 'Client' }),
    ));
    assert.match(item, /December update/);
    assert.doesNotMatch(item, /class="gbp-post-offer-date"|role="alert"/);
});

test('an item render error falls back to a titled alert', () => {
    const boundary = new ItemErrorBoundary({
        title: update.title,
        children: createElement(() => { throw new Error('Failed item'); }),
    });
    // The server renderer does not catch errors in boundaries.
    boundary.state = ItemErrorBoundary.getDerivedStateFromError();
    const html = renderToStaticMarkup(boundary.render());
    assert.match(html, /role="alert"/);
    assert.match(html, /December update/);
    assert.match(html, /This item couldn&#x27;t be displayed\./);
});

test('the client review omits the offer details for an update with null dates', () => {
    function render(post: ReviewPost) {
        return renderToStaticMarkup(createElement(PublicReview, {
            mode: 'review', posts: [post], clientName: 'Client',
        }));
    }

    const html = render(update);
    assert.match(html, /December update/);
    assert.doesNotMatch(html, /Offer runs/);
    assert.match(render(offer), /<dt>Offer runs<\/dt><dd>Dec 1 – Dec 31<\/dd>/);
});
