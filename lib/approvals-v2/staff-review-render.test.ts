import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StaffReviewData } from '@/components/approvals-v2/StaffReviewTypes';
import type { GbpPostPayload } from '@/lib/gbp-approvals/registry';
import type { PagePayload } from './registry';

Object.assign(globalThis, { React });
const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { StaffReviewView } = require('@/components/approvals-v2/StaffReviewView') as typeof import('@/components/approvals-v2/StaffReviewView');

const update: GbpPostPayload = {
  schemaVersion: 1, postType: 'update', title: 'Holiday hours changed', scheduledDate: '2026-12-07',
  offerStart: null, offerEnd: null, body: 'Our December opening hours have changed.', terms: '',
  ctaLabel: 'Learn more', ctaUrl: 'https://example.test/hours',
};
const page: PagePayload = {
  schemaVersion: 1, pageKind: 'service', title: 'New service page', metaTitle: 'Search title',
  metaDescription: 'Search description', slug: 'services/test',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Page text' }] }] },
};

function data(payload: GbpPostPayload | PagePayload, draft = true): StaffReviewData {
  const type = 'pageKind' in payload ? 'page' : 'gbp_post';
  const version = { id: 'version-1', item_id: 'item-1', version_no: 1, payload, photo_path: 'https://example.test/photo.jpg', change_note: null, created_at: '2026-11-16' };
  return {
    request: { id: 'request', title: 'December drafts', stage: draft ? 'draft' : 'sent', archived_at: null, due_at: null, created_via: 'staff', created_at: '2026-11-16', clients: { name: 'Client', domain: 'example.test' }, item_type: type },
    items: [{
      id: 'item-1', item_type: type, page_kind: 'pageKind' in payload ? payload.pageKind : null, position: 1,
      version, releasedVersion: draft ? null : version, current_version_id: version.id,
      released_version_id: draft ? null : version.id, status: 'pending', decision_lock_reason: null, response: null, staffReview: null,
    }],
    versions: [version], questions: [], events: [], photos: { 'https://example.test/photo.jpg': 'https://example.test/photo.jpg' },
    link: null, owner: null, botName: null, canSend: true, canWrite: true, sendReason: null,
  };
}

test('Premium renders a GBP update with null offer dates and an enabled Send before staff review', () => {
  const html = renderToStaticMarkup(createElement(StaffReviewView, {
    data: data(update), initialSelection: 'item-1', initialMobileScreen: 'detail', saveReview: async () => {},
  }));
  assert.match(html, /data-mobile-screen="detail"/);
  assert.match(html, /Item 1 of 1.*GBP update.*v1/);
  assert.match(html, /class="ar-meta">.*1 GBP post.*Dec 7.*Draft — the client can’t see this yet/);
  assert.match(html, /<dt>Type<\/dt><dd>GBP update<\/dd>/);
  assert.match(html, /Holiday hours changed/);
  assert.match(html, /Our December opening hours have changed/);
  assert.match(html, /class="gbp-post gbp-post-compact"/);
  assert.match(html, /class="gbp-post-slide"/);
  assert.doesNotMatch(html, /Next photo|Previous photo|gbp-post-dots|gbp-post-count/);
  assert.match(html, /0 of 1 reviewed/);
  assert.match(html, /<button class="ar-button ar-send ar-send-ink" type="button" aria-busy="false"/);
  assert.match(html, /class="ar-button ar-approve" aria-disabled="false"/);
  assert.doesNotMatch(html, /Offer runs|<dt>Terms|Invalid Date|Photo needed|couldn’t load this item/i);
});

test('Option B uses released page content and client status after sending', () => {
  const fixture = data(page, false);
  const item = fixture.items[0];
  item.status = 'changes_requested';
  item.staffReview = { decision: 'approved', note: null, tags: [], reviewer_name: 'Reviewer', reviewer_id: 'staff', created_at: '2026-11-17', version_id: 'version-2' };
  item.version = { ...item.version!, id: 'version-2', version_no: 2, payload: { ...page, title: 'Unreleased title' } };
  item.current_version_id = 'version-2';
  const html = renderToStaticMarkup(createElement(StaffReviewView, { data: fixture }));
  assert.match(html, /Item 1: New service page, Changes requested/);
  assert.match(html, /Page preview/);
  assert.match(html, /Release revision to client/);
  assert.match(html, /Mark final/);
  assert.match(html, /Edit · new version/);
  assert.match(html, /aria-label="Request actions" aria-haspopup="menu" aria-expanded="false"/);
  assert.doesNotMatch(html, /Move back to draft/);
  assert.doesNotMatch(html, /Unreleased title|ar-button ar-approve/);
});

test('Option B shows the empty request message without an add-items action', () => {
  const fixture = data(update);
  fixture.items = [];
  const html = renderToStaticMarkup(createElement(StaffReviewView, { data: fixture }));
  assert.match(html, /This request has no items yet/);
  assert.doesNotMatch(html, /Add items/);
});

test('staff preview renders a video with a poster and enables approval and enlargement', () => {
  const fixture = data(update);
  const video = 'https://media.test/video.mp4';
  const poster = 'https://media.test/poster.jpg';
  fixture.items[0].version = { ...fixture.items[0].version!, photo_path: null, photo_paths: [], video_path: video, video_poster_path: poster };
  fixture.photos = { [video]: video, [poster]: poster };
  const html = renderToStaticMarkup(createElement(StaffReviewView, { data: fixture, initialSelection: 'item-1', saveReview: async () => {} }));
  assert.match(html, /<video[^>]+src="https:\/\/media.test\/video.mp4"[^>]+poster="https:\/\/media.test\/poster.jpg"[^>]+controls=""/);
  assert.match(html, /Enlarge video for item 1/);
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelector('.ar-video-thumb img')?.getAttribute('src'), poster);
  assert.ok(doc.querySelector('.ar-video-thumb svg'));
  assert.match(doc.querySelector('.ar-facts')?.textContent ?? '', /VideoIncludedEnlarge video/);
  assert.match(html, /class="ar-button ar-approve" aria-disabled="false"/);
  assert.doesNotMatch(html, /Photo needed|<img[^>]+video.mp4/);
});

test('reviewed statuses drive progress, quiet row chips, and the Send color', () => {
  const fixture = data(update);
  const [first] = fixture.items;
  const second = { ...first, id: 'item-2', position: 2 };
  const third = { ...first, id: 'item-3', position: 3 };
  fixture.items.push(second, third);
  const review = { version_id: first.current_version_id!, note: 'Update the copy', tags: [], reviewer_name: 'Reviewer', reviewer_id: 'staff', created_at: '2026-11-17' };
  first.staffReview = { ...review, decision: 'changes_requested' };
  const render = () => new JSDOM(renderToStaticMarkup(createElement(StaffReviewView, { data: fixture }))).window.document;
  let doc = render();
  assert.ok(doc.querySelector('.ar-send-ink'));
  assert.equal(doc.querySelector('.ar-send-hot'), null);
  assert.equal(doc.querySelector('.ar-legend .ar-amber')?.textContent, '1 change');
  assert.equal(doc.querySelector('[role=progressbar]')?.getAttribute('aria-label'), 'Progress: 1 of 3 reviewed');
  assert.deepEqual([...doc.querySelectorAll('.ar-tools .ar-progress-track i')].map(segment => segment.getAttribute('data-status')),
    ['changes_requested', 'pending', 'pending']);
  assert.equal(doc.querySelector('[data-review-row="item-1"] .ar-chip')?.textContent, 'Changes');
  assert.equal(doc.querySelector('[data-review-row="item-2"] .ar-chip'), null);
  assert.match(doc.querySelector('[data-review-row="item-2"]')?.getAttribute('aria-label') ?? '', /Needs review/);
  assert.equal(doc.querySelector('.ar-pane-header .ar-chip'), null);
  assert.equal(doc.querySelector('.ar-key-card'), null);
  assert.equal(doc.querySelector('.ar-pane-header button[aria-label="Next item"]')?.className, 'ar-icon-ghost');
  assert.ok(doc.querySelector('.ar-pane-footer .ar-button-ghost'));
  assert.ok(doc.querySelector('.ar-header-actions .ar-button-ghost'));

  second.staffReview = { ...review, decision: 'approved' };
  doc = render();
  assert.ok(doc.querySelector('.ar-send-hot'));
  assert.ok(doc.querySelector('[data-review-row="item-2"] .ar-row-check svg'));
  assert.equal(doc.querySelector('[data-review-row="item-2"] .ar-chip')?.textContent, 'Approved');

  third.staffReview = { ...review, decision: 'approved' };
  doc = render();
  assert.equal(doc.querySelector('.ar-complete h2')?.textContent, 'All 3 items reviewed');
  assert.equal(doc.querySelector('.ar-complete .ar-complete-summary')?.textContent, '2 approved · 1 needs changes');
  assert.equal(doc.querySelector('.ar-complete .ar-button-soft')?.textContent, 'Review the change on item 1');
  assert.ok(doc.querySelector('.ar-complete .ar-send-hot'));
  assert.equal(doc.querySelector('.ar-pane-footer'), null);

  second.staffReview = { ...review, decision: 'changes_requested' };
  third.staffReview = { ...review, decision: 'changes_requested' };
  doc = render();
  assert.equal(doc.querySelector('.ar-complete .ar-button-soft')?.textContent, 'Review changes (3)');
  assert.ok(doc.querySelector('.ar-complete .ar-send-ink'));

  fixture.items.forEach(item => { item.staffReview = { ...review, decision: 'approved' }; });
  doc = render();
  assert.equal(doc.querySelector('.ar-complete-summary')?.textContent, '3 approved');
  assert.equal(doc.querySelector('.ar-complete .ar-button-soft'), null);
});

test('the Terms fact is available for offers with terms', () => {
  const html = renderToStaticMarkup(createElement(StaffReviewView, { data: data({
    ...update, postType: 'offer', terms: 'One per customer',
  }) }));
  assert.match(html, /<dt>Terms<\/dt>/);
});

test('premium layout rules keep compact media scoped and short detail views usable', () => {
  const staff = readFileSync(new URL('../../components/approvals-v2/staff-review.css', import.meta.url), 'utf8');
  const gbp = readFileSync(new URL('../../components/gbp-approvals/gbp-post-preview.css', import.meta.url), 'utf8');
  assert.match(staff, /--ar-page: #f3f2ef/);
  assert.match(staff, /--ar-glass: rgba\(255,255,255,\.96\)/);
  assert.match(staff, /--ar-amber: #a94b08/);
  assert.match(staff, /outline: 3px solid var\(--ar-focus\);\s+outline-offset: 2px/);
  assert.match(staff, /grid-template-columns: 360px minmax\(0, 1fr\); gap: 18px/);
  assert.match(staff, /height: calc\(100dvh - 240px\); min-height: 0; overflow: hidden/);
  assert.match(staff, /\.ar-view \.gbp-post-compact \.gbp-post-slide \{ height: 200px; aspect-ratio: auto/);
  assert.match(staff, /@media \(max-width: 760px\) and \(max-height: 640px\) \{\s+\.ar-view \.gbp-post-compact \.gbp-post-slide \{ height: 120px/);
  assert.match(staff, /@media \(prefers-reduced-motion: reduce\)[^]*?animation: none !important/);
  assert.match(staff, /@media \(prefers-reduced-transparency: reduce\)[^]*?background: #fff; backdrop-filter: none/);
  assert.match(gbp, /\.ar-view \.gbp-post-compact \.gbp-post-arrow::after \{ content: ""; position: absolute; inset: -6px/);
  assert.match(gbp, /@media \(max-width: 760px\)[^]*?\.gbp-post \.gbp-post-dots button \{ width: 44px; height: 44px/);
});
