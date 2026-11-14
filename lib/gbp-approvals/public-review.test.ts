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
