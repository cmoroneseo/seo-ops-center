import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup, renderToString } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { PublicReview, GbpPostPreview } = require('../../components/gbp-approvals/PublicReview') as typeof import('../../components/gbp-approvals/PublicReview');
const post = {
    position: 1, title: 'Actual title', scheduled: '2026-12-01',
    offerStart: '2026-12-01', offerEnd: '2026-12-31', body: 'Current agency text',
    photo: null, status: 'pending' as const, terms: 'Actual contract terms',
    ctaUrl: 'https://example.com/offer', ctaLabel: 'Learn more',
};

test('revision review includes untouched pending and unrevised changes-requested posts', () => {
    const html = renderToStaticMarkup(createElement(PublicReview, {
        mode: 'revision', clientName: 'Real client', questions: [], posts: [
            post, { ...post, position: 2, title: 'Needs revision', status: 'changes_requested' },
            { ...post, position: 3, title: 'Agency locked', locked: true },
            { ...post, position: 4, previousBody: 'Previous text', suggestedBody: 'Unaccepted suggestion', changeNote: 'Actual change note' },
        ],
    }));
    assert.match(html, /Needs revision/);
    assert.equal((html.match(/Request changes<\/button>/g) ?? []).length, 4);
    assert.match(html, /disabled=""/);
    assert.match(html, /Actual change note/);
    assert.match(html, /Current/);
    assert.doesNotMatch(html, /Unaccepted suggestion/);
    assert.ok(html.includes('<dd>https://example.com/offer</dd>'));
    assert.match(html, /Learn more/);
});

test('expired page uses actual expiry and has no form', () => {
    const html = renderToStaticMarkup(createElement(PublicReview, {
        mode: 'expired', posts: [], questions: [], expiresAt: '2027-02-02T06:00:00Z',
    }));
    assert.match(html, /February 1, 2027/);
    assert.match(html, /Contact your account manager/);
    assert.doesNotMatch(html, /<form/);
});

for (const mode of ['missing', 'expired', 'revoked'] as const) {
    test(`${mode} page shows no client name, logo, sample data, or expiry note`, () => {
        const html = renderToStaticMarkup(createElement(PublicReview, { mode, posts: [], clientName: 'Private client', logoSrc: '/private-client-logo.png' }));
        assert.doesNotMatch(html, /ALL-IN-1|Private client|private-client-logo/);
        assert.doesNotMatch(html, /Prepared for/);
        assert.doesNotMatch(html, /works until/);
        assert.doesNotMatch(html, /<img/);
        assert.doesNotMatch(html, /<form/);
        if (mode === 'missing') assert.match(html, /This link isn\u2019t available/);
    });
}

test('missing page ignores a client name even if one is passed', () => {
    const html = renderToStaticMarkup(createElement(PublicReview, { mode: 'missing', posts: [], clientName: 'Real client', logoSrc: '/logo.webp' }));
    assert.doesNotMatch(html, /Real client/);
    assert.doesNotMatch(html, /logo\.webp/);
});

test('active review without a logo uses no sample logo or sample questions', () => {
    const html = renderToStaticMarkup(createElement(PublicReview, { mode: 'review', clientName: 'Real client', posts: [post] }));
    assert.match(html, /Prepared for/);
    assert.match(html, /Real client/);
    assert.doesNotMatch(html, /ALL-IN-1|gbp-approvals\/logo/);
    assert.doesNotMatch(html, /Dec 31 deadline/);
});

test('calendar dates use the approvals weekday format', async () => {
    const { weekday } = await import('../../components/gbp-approvals/sample');
    assert.equal(weekday('2026-11-16'), 'Mon, Nov 16');
});

test('suggested edits are prefilled, optional, and require a comment before submission', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
    const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(document.getElementById('root')!);
    const submissions: Array<{ decisions: Array<Record<string, unknown>> }> = [];
    globalThis.fetch = async (_url, options) => {
        submissions.push(JSON.parse(options!.body as string));
        return Response.json({ ok: true });
    };
    async function click(text: string) {
        const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === text);
        assert.ok(button, text);
        await act(async () => button.click());
    }
    async function fill(id: string, value: string) {
        const input = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
        const prototype = input.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
        await act(async () => {
            Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
            input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
    }
    try {
        await act(async () => root.render(createElement(PublicReview, {
            mode: 'review', posts: [{ ...post, itemId: 'item', versionId: 'version' }], questions: [], token: 'test-token',
        })));
        await click('Request changes');
        const disclosure = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Suggest an edit (optional)')!;
        assert.equal(disclosure.getAttribute('aria-expanded'), 'false');
        await click('Suggest an edit (optional)');
        assert.equal(disclosure.getAttribute('aria-expanded'), 'true');
        assert.equal((document.getElementById('suggest-title-1') as HTMLInputElement).value, post.title);
        assert.equal((document.getElementById('suggest-body-1') as HTMLTextAreaElement).value, post.body);
        await fill('suggest-body-1', 'Client suggested text');
        await click('Review and send');
        await fill('reviewer-name', 'Client reviewer');
        await act(async () => document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(submissions.length, 0);
        assert.match(document.body.textContent!, /A comment is required for each post/);
        await fill('comment-1', 'Please use this text.');
        await act(async () => document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(submissions.length, 1);
        assert.equal(submissions[0].decisions[0].suggestedBody, 'Client suggested text');
        assert.equal('suggestedTitle' in submissions[0].decisions[0], false);
    } finally {
        await act(async () => root.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});


test('GBP avatar renders the client logo or falls back to its initial', () => {
    const logo = renderToStaticMarkup(createElement(GbpPostPreview, { post, clientName: 'Real client', logoSrc: '/client-logo.png' }));
    assert.match(logo, /class="g-av"><img src="\/client-logo.png"/);
    const initial = renderToStaticMarkup(createElement(GbpPostPreview, { post, clientName: 'Real client' }));
    assert.match(initial, /class="g-av-initial" aria-hidden="true">R<\/span>/);
    assert.doesNotMatch(initial, /<img/);
});

test('failed client logos disappear from the header and fall back to the avatar initial', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(document.getElementById('root')!);
    try {
        await act(async () => root.render(createElement(PublicReview, { mode: 'review', clientName: 'Real client', logoSrc: '/client-logo.png', posts: [post], questions: [] })));
        assert.ok(document.querySelector('.prep img'));
        assert.ok(document.querySelector('.g-av img'));
        await act(async () => {
            document.querySelector('.prep img')!.dispatchEvent(new dom.window.Event('error'));
            document.querySelector('.g-av img')!.dispatchEvent(new dom.window.Event('error'));
        });
        assert.equal(document.querySelector('.prep img'), null);
        assert.equal(document.querySelector('.g-av img'), null);
        assert.equal(document.querySelector('.g-av-initial')?.textContent, 'R');
    } finally {
        await act(async () => root.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});


test('avatar logos that failed before hydration fall back to the initial', async () => {
    const { JSDOM } = await import('jsdom');
    const view = createElement(GbpPostPreview, { post, clientName: 'Real client', logoSrc: '/missing-logo.png' });
    const dom = new JSDOM(`<div id="root">${renderToString(view)}</div>`, { url: 'http://localhost' });
    const saved = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { hydrateRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const container = document.getElementById('root')!;
    const logos = container.querySelectorAll('.g-av img');
    assert.equal(logos.length, 1);
    for (const img of logos) {
        Object.defineProperties(img, { complete: { value: true }, naturalWidth: { value: 0 } });
    }
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
        await act(async () => { root = hydrateRoot(container, view); });
        assert.ok(!document.querySelector('.g-av img'));
        assert.equal(document.querySelector('.g-av-initial')?.textContent, 'R');
    } finally {
        await act(async () => root?.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});

test('a client can send a comment on photo two of a null-date update without changing its decision', async () => {
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(document.getElementById('root')!);
    const first = 'https://drive.google.com/thumbnail?id=client-fixture';
    const second = 'https://example.com/photo-2.jpg';
    const galleryPost = { ...post, postType: 'update', offerStart: null, offerEnd: null, itemId: 'item', versionId: 'version',
        photo: first, photoSrcs: [first, second], photoComments: [{ body: 'Previously reviewed', photoPosition: 2 }] };
    const submissions: { comments: unknown[]; decisions: unknown[] }[] = [];
    globalThis.fetch = async (_url, options) => {
        submissions.push(JSON.parse(options!.body as string));
        return Response.json({ ok: true });
    };
    try {
        await act(async () => root.render(createElement(PublicReview, { mode: 'review', posts: [galleryPost], token: 'test-token' })));
        assert.doesNotMatch(document.body.textContent!, /Offer runs|Invalid Date/);
        const photos = document.querySelectorAll<HTMLImageElement>('[aria-label="Post photos"] img');
        assert.deepEqual([...photos].map(image => image.getAttribute('src')), [first, second]);
        assert.equal(photos[1].alt, 'Photo for Actual title 2 of 2');
        assert.equal(photos[0].getAttribute('referrerpolicy'), 'no-referrer');
        await act(async () => photos[0].dispatchEvent(new dom.window.Event('error')));
        assert.equal(document.querySelector<HTMLAnchorElement>('[aria-label="Open photo for actual title 1 of 2"]')?.textContent, 'Open photo');
        const secondComment = [...document.querySelectorAll('label')].find(label => label.textContent?.includes('Comment on photo 2'))!;
        const textarea = secondComment.querySelector('textarea')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Use the daytime photo.');
            textarea.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        const review = [...document.querySelectorAll('button')].find(button => button.textContent === 'Review and send')!;
        await act(async () => review.click());
        await act(async () => {
            const name = document.getElementById('reviewer-name');
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(name, 'Client reviewer');
            name!.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        await act(async () => {
            document.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
        });
        assert.equal(submissions.length, 1);
        assert.deepEqual(submissions[0].decisions, []);
        assert.deepEqual(submissions[0].comments, [{ itemId: 'item', versionId: 'version', anchorKind: 'page', photoPosition: 2, body: 'Use the daytime photo.' }]);
    } finally {
        await act(async () => root.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});

test('a staff replacement of photo two uploads through the assets route and stages a new version', async () => {
    const { RevisionEditor } = require('../../components/gbp-approvals/TaskApprovalsPanel') as typeof import('../../components/gbp-approvals/TaskApprovalsPanel');
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const saved = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const root = createRoot(document.getElementById('root')!);
    const first = 'https://example.com/first.jpg';
    const second = 'https://example.com/second.jpg';
    const key = 'approval-assets/request/new';
    const endpoint = '/api/approval-requests/request/assets';
    const uploadUrl = 'https://storage.test/upload';
    const posted: unknown[] = [];
    const uploads: unknown[] = [];
    globalThis.fetch = async (url, options) => {
        if (options!.method === 'PUT') {
            assert.equal(url, uploadUrl);
            return Response.json({ ok: true });
        }
        assert.equal(url, endpoint);
        const body = JSON.parse(options!.body as string);
        uploads.push(body);
        return body.objectKey ? Response.json({ photoUrl: 'https://storage.test/signed' }) : Response.json({ objectKey: key, signedUrl: uploadUrl });
    };
    try {
        await act(async () => root.render(createElement(RevisionEditor, {
            requestId: 'request', images: { [first]: first, [second]: second }, busy: false,
            item: { id: 'item', position: 1, status: 'pending', decision_lock_reason: null, response: null,
                version: { id: 'version', item_id: 'item', version_no: 1, photo_path: first, photo_paths: [first, second],
                    created_at: '2026-12-01', change_note: null,
                    payload: { title: 'Holiday hours', body: 'Post copy', schemaVersion: 1, postType: 'update',
                        offerStart: null, offerEnd: null, ctaLabel: 'Learn more', ctaUrl: 'https://example.com', scheduledDate: '2026-12-01', terms: '' } } },
            onPost: async value => { posted.push(value); },
        })));
        const file = new dom.window.File(['jpeg'], 'replacement.jpg', { type: 'image/jpeg' });
        const replace = [...document.querySelectorAll('label')].find(label => label.textContent === 'Replace photo 2')!.querySelector('input')!;
        Object.defineProperty(replace, 'files', { value: [file] });
        await act(async () => replace.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
        assert.deepEqual(uploads, [{ itemId: 'item', contentType: 'image/jpeg', size: file.size }, { itemId: 'item', objectKey: key }]);
        assert.ok(document.querySelector('img[src="https://storage.test/signed"]'));
        const note = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('Change note'))!.querySelector('textarea')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Replace second photo');
            note.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
        });
        const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Post v2')!;
        await act(async () => save.click());
        assert.equal(posted.length, 1);
        assert.deepEqual((posted[0] as { photoPaths: string[] }).photoPaths, [first, key]);
        assert.equal((posted[0] as { expectedVersionId: string }).expectedVersionId, 'version');
    } finally {
        await act(async () => root.unmount());
        Object.assign(globalThis, saved);
        dom.window.close();
    }
});
