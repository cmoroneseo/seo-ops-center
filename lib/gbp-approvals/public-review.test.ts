import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { PublicReview } = require('../../components/gbp-approvals/PublicReview') as typeof import('../../components/gbp-approvals/PublicReview');
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
    assert.match(html, /https:\/\/example.com\/offer/);
    assert.match(html, /Learn more/);
});

test('expired page uses actual expiry and has no form', () => {
    const html = renderToStaticMarkup(createElement(PublicReview, {
        mode: 'expired', posts: [], questions: [], expiresAt: '2027-02-02T00:00:00Z',
    }));
    assert.match(html, /February 2, 2027/);
    assert.match(html, /Contact your account manager/);
    assert.doesNotMatch(html, /<form/);
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
