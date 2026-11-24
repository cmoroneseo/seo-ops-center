import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
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

test('Option B renders a GBP update with null offer dates and an enabled Send before staff review', () => {
  const html = renderToStaticMarkup(createElement(StaffReviewView, {
    data: data(update), initialSelection: 'item-1', initialMobileScreen: 'detail', saveReview: async () => {},
  }));
  assert.match(html, /data-mobile-screen="detail"/);
  assert.match(html, /Item 1 of 1.*GBP post.*v1/);
  assert.match(html, /Holiday hours changed/);
  assert.match(html, /Our December opening hours have changed/);
  assert.match(html, /0 of 1 reviewed/);
  assert.match(html, /<button class="ar-button ar-send" type="button" aria-busy="false"/);
  assert.match(html, /class="ar-button ar-approve" aria-disabled="false"/);
  assert.doesNotMatch(html, /Offer runs|Invalid Date|Photo needed|couldn’t load this item/i);
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
  assert.doesNotMatch(html, /Unreleased title|ar-button ar-approve/);
});

test('Option B shows the empty request message without an add-items action', () => {
  const fixture = data(update);
  fixture.items = [];
  const html = renderToStaticMarkup(createElement(StaffReviewView, { data: fixture }));
  assert.match(html, /This request has no items yet/);
  assert.doesNotMatch(html, /Add items/);
});
