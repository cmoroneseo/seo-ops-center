import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InternalReviewPost } from './model';

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { InternalReview } = require('@/components/internal-review/InternalReview') as typeof import('@/components/internal-review/InternalReview');

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
    assert.match(html, /<time dateTime="2026-12-15">Tue, Dec 15, 2026<\/time>/);
    assert.doesNotMatch(html, /gbp-post-offer-date/);
});

test('the internal page hides empty, malformed and impossible scheduled dates', () => {
    for (const scheduledDate of ['', 'not a date', '2026-02-30']) {
        assert.doesNotMatch(renderPost({ scheduledDate }), /<time/);
    }
});

test('the internal page only shows an offer date range for offers with two valid dates', () => {
    assert.doesNotMatch(renderPost({ offerStart: '2026-12-01', offerEnd: '2026-12-31' }), /gbp-post-offer-date/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '2026-12-01' }), /gbp-post-offer-date/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '', offerEnd: '2026-12-31' }), /gbp-post-offer-date/);
    assert.doesNotMatch(renderPost({ postType: 'offer', offerStart: '2026-12-01', offerEnd: '2026-12-32' }), /gbp-post-offer-date/);
    assert.match(renderPost({ postType: 'offer', offerStart: '2026-12-01', offerEnd: '2026-12-31' }), /class="gbp-post-offer-date">Dec 1 – Dec 31/);
});

test('the internal page gives a null-date update a three-photo carousel and a photo feedback target', () => {
    const html = renderPost({
        photoSrcs: ['https://drive.google.com/thumbnail?id=first', 'https://example.com/second.jpg', '/third.jpg'],
        feedback: [{ reviewerName: 'Reviewer', decision: null, comment: 'Use the daytime shot', photoPosition: 2 }],
    });
    assert.match(html, /aria-roledescription="carousel"/);
    assert.match(html, /alt="Photo for Holiday hours 1 of 3"/);
    assert.match(html, /aria-label="Show photo 3 of 3"/);
    assert.equal((html.match(/<img /g) ?? []).length, 1);
    assert.doesNotMatch(html, /<figcaption/);
    assert.match(html, /referrerPolicy="no-referrer"/i);
    assert.match(html, /<option value="2">Photo 2<\/option>/);
    assert.match(html, /Reviewer<\/strong> · Comment · Photo 2/);
    assert.doesNotMatch(html, /gbp-post-offer-date/);
});

test('internal feedback follows the carousel, preserves separate drafts, and saves the displayed photo position', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
    const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(document.getElementById('root')!);
    const submissions: unknown[] = [];
    globalThis.fetch = async (_url, options) => {
        const { idempotencyKey, ...payload } = JSON.parse(String(options?.body));
        assert.ok(idempotencyKey);
        submissions.push(payload);
        return Response.json({ ok: true });
    };
    try {
        await act(async () => root.render(createElement(InternalReview, {
            token: 'fixture',
            view: { clientName: 'Client', batches: [{ title: 'Drafts', posts: [{ ...update, photoSrcs: ['/one.jpg', '/two.jpg', '/three.jpg'] }] }] },
        })));
        const carousel = document.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!;
        const form = document.querySelector('form')!;
        const picker = form.querySelectorAll('select')[1];
        const textarea = form.querySelector('textarea')!;
        const name = form.querySelector('input')!;
        async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
            await act(async () => {
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(input, value);
                input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
            });
        }
        assert.equal(picker.value, '');
        assert.equal(textarea.required, false);
        await fill(name, 'Agency reviewer');
        await fill(textarea, 'Whole post draft');
        carousel.focus();
        await act(async () => carousel.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        assert.equal(picker.value, '2');
        assert.equal(textarea.required, true);
        assert.equal(textarea.value, '');
        await fill(textarea, 'Use this photo.');
        await act(async () => {
            picker.value = '';
            picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert.equal(textarea.value, 'Whole post draft');
        assert.equal(carousel.querySelector('img')?.getAttribute('src'), '/two.jpg');
        await act(async () => {
            picker.value = '3';
            picker.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        assert.equal(carousel.querySelector('img')?.getAttribute('src'), '/three.jpg');
        await act(async () => carousel.querySelector<HTMLButtonElement>('[aria-label="Previous photo"]')!.click());
        assert.equal(textarea.value, 'Use this photo.');
        await act(async () => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
        assert.deepEqual(submissions, [{
            reviewerName: 'Agency reviewer', decision: 'approved', comment: 'Use this photo.', photoPosition: 2,
            itemId: update.itemId, versionId: update.versionId,
        }]);
        assert.match(document.querySelector('[aria-label="Internal feedback"]')!.textContent!, /Approved · Photo 2/);
    } finally {
        await act(async () => root.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});
