import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageComments } from '../../components/approvals-v2/PageComments';
import { AgencyComments, type AgencyComment } from '../../components/approvals-v2/AgencyComments';
import { parsePagePayload } from './page-body';

Object.assign(globalThis, { React });

test('client renders block pins, Highlight filter, unsent controls, and protected SEO metadata', () => {
  const parsed = parsePagePayload({ schemaVersion: 1, pageKind: 'blog', title: 'Page', metaTitle: 'Search title', metaDescription: 'Description', slug: 'page', body: { format: 'markdown', text: 'Hello world.' } });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const block = parsed.outline[0].blocks[0];
  const html = renderToStaticMarkup(createElement(PageComments, {
    token: 'offline-fixture-token',
    itemId: 'item',
    versionId: 'version',
    versionNo: 2,
    payload: parsed.payload,
    outline: parsed.outline,
    photoUrl: null,
    images: {},
    locked: false,
    drafts: [{ id: 'draft', itemId: 'item', versionId: 'version', anchorKind: 'pin', pinTarget: 'block', blockId: block.blockId, sectionId: parsed.outline[0].sectionId, targetHash: block.hash, body: 'Please review this' }],
    onChange: () => {}
  }));
  for (const copy of ['Revision ready', 'Highlights', 'Images', 'Your comments (', 'Not sent yet', 'Comment on this section', 'Read-only.', 'Edit', 'Delete']) assert.ok(html.includes(copy), copy);
  assert.match(html, /aria-pressed="false"/);
  assert.equal((html.match(/data-comment-content=/g) ?? []).length, 1);
  assert.equal(html.includes('Suggest title'), false);
});

test('agency groups anchors in page order and offers Accept only for genuine suggestions', () => {
  const base: AgencyComment = { id: 'plain', item_id: 'item', block_id: 'second', pin_target: 'block', parent_id: null, anchor_kind: 'pin', author_name: 'Casey', body: 'Plain comment', quote: null, suggested_text: null, suggested_image_key: null, suggestion_status: null, suggestion_reply: null, resolved_at: null, resolved_in_version_id: null, previewUrl: null };
  const html = renderToStaticMarkup(createElement(AgencyComments, {
    requestId: 'request',
    comments: [base, { ...base, id: 'suggestion', block_id: 'first', body: 'Suggested comment', anchor_kind: 'highlight', quote: 'Original wording', suggested_text: 'New wording', suggestion_status: 'pending' }],
    anchorOrder: ['first', 'second'],
    currentImages: {},
    canWrite: true,
    refresh: () => {}
  }));
  assert.ok(html.indexOf('Suggested comment') < html.indexOf('Plain comment'));
  assert.equal((html.match(/Accept suggestion/g) ?? []).length, 1);
  assert.ok(html.includes('Accept adds to the next draft only.'));
});
