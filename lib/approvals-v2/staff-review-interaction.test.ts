import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, createElement, useState } from 'react';
import type { ReviewAction, SaveStaffReview, StaffReviewData, StaffReviewItem } from '@/components/approvals-v2/StaffReviewTypes';

const dom = new JSDOM('<!doctype html><div id="review"></div>', { url: 'https://example.test/approvals/example', pretendToBeVisual: true });
Object.assign(globalThis, {
  React,
  window: dom.window,
  self: dom.window,
  document: dom.window.document,
  Element: dom.window.Element,
  Node: dom.window.Node,
  NodeFilter: dom.window.NodeFilter,
  MutationObserver: dom.window.MutationObserver,
  CustomEvent: dom.window.CustomEvent,
  HTMLInputElement: dom.window.HTMLInputElement,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
  cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
});
let isMobile = false;
dom.window.matchMedia = () => ({ matches: isMobile, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
dom.window.HTMLElement.prototype.scrollTo = function () {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { StaffReviewView } = require('@/components/approvals-v2/StaffReviewView') as typeof import('@/components/approvals-v2/StaffReviewView');

function draftData(): StaffReviewData {
  const photo = 'https://example.test/post.jpg';
  const items: StaffReviewItem[] = ['One', 'Two', 'Three'].map((title, index) => {
    const id = `item-${index + 1}`;
    const version = {
      id: `${id}-v1`, item_id: id, version_no: 1, change_note: null, created_at: '2026-11-24',
      photo_path: index ? photo : null,
      payload: { schemaVersion: 1 as const, postType: 'update' as const, title, body: 'Draft text', scheduledDate: '2026-11-24',
        offerStart: null, offerEnd: null, terms: '', ctaLabel: 'Learn more', ctaUrl: 'https://example.test' },
    };
    return { id, position: index + 1, item_type: 'gbp_post', page_kind: null, current_version_id: version.id, released_version_id: null,
      version, releasedVersion: null, status: 'pending', decision_lock_reason: null, response: null };
  });
  return {
    request: { id: 'request', title: 'Draft request', stage: 'draft', archived_at: null, due_at: null, created_at: '2026-11-24', created_via: 'manual', clients: { name: 'Example' }, item_type: 'gbp_post' },
    items, versions: [], questions: [], events: [], photos: { [photo]: photo }, owner: null, botName: null, link: null,
    canWrite: true, canSend: true, sendReason: null, actorId: 'reviewer',
  };
}

function Harness({ writes }: { writes: Parameters<SaveStaffReview>[0][] }) {
  const [data, setData] = useState(draftData);
  const saveReview: SaveStaffReview = async input => {
    writes.push(input);
    setData(previous => ({ ...previous, items: previous.items.map(item => item.id === input.itemId ? {
      ...item, staffReview: { decision: input.decision, version_id: input.versionId, note: input.note ?? null,
        tags: input.tags ?? [], reviewer_name: 'Reviewer', reviewer_id: 'reviewer', created_at: '2026-11-24' },
    } : item) }));
  };
  return createElement(StaffReviewView, { data, saveReview });
}

function key(target: Element, value: string, extra?: KeyboardEventInit) {
  target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
}
function get<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  assert.ok(element, `Missing ${selector}`);
  return element;
}

test('request actions offer return to draft only on editable sent requests', async () => {
  const root = createRoot(get('#review'));
  try {
    for (const [stage, archived_at, canWrite, busy, expected] of [
      ['sent', null, true, false, 'enabled'],
      ['sent', null, true, true, 'disabled'],
      ['draft', null, true, false, 'hidden'],
      ['sent', '2026-11-24', true, false, 'hidden'],
      ['sent', null, false, false, 'hidden'],
    ] as const) {
      const data = draftData();
      Object.assign(data.request, { stage, archived_at });
      data.canWrite = canWrite;
      await act(async () => root.render(createElement(StaffReviewView, { data, busy })));
      const trigger = get<HTMLButtonElement>('button[aria-label="Request actions"]');
      await act(async () => trigger.click());
      const menu = get('[role="menu"][aria-label="Request actions"]');
      const item = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
        .find(button => button.textContent === 'Move back to draft');
      assert.equal(item ? item.disabled ? 'disabled' : 'enabled' : 'hidden', expected);
      await act(async () => trigger.click());
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test('return to draft explains client link revocation, cancels with focus restored, and confirms the action', async () => {
  const root = createRoot(get('#review'));
  const data = draftData();
  data.request.stage = 'sent';
  const writes: Parameters<ReviewAction>[] = [];
  let succeed = false;
  const reviewAction: ReviewAction = async (...args) => { writes.push(args); return succeed; };
  const render = (busy = false, error = '') => act(async () => root.render(createElement(StaffReviewView, { data, act: reviewAction, busy, error })));
  const open = async () => {
    await act(async () => get<HTMLButtonElement>('button[aria-label="Request actions"]').click());
    const button = [...get('[role="menu"]').querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find(item => item.textContent === 'Move back to draft');
    assert.ok(button);
    await act(async () => button.click());
    return get('[role="dialog"]');
  };
  const dialogButton = (name: string) => {
    const button = [...get('[role="dialog"]').querySelectorAll('button')].find(item => item.textContent === name);
    assert.ok(button);
    return button;
  };
  try {
    await render();
    const dialog = await open();
    assert.equal(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent, 'Move back to draft?');
    assert.match(document.getElementById(dialog.getAttribute('aria-describedby') ?? '')?.textContent ?? '', /client review links will stop working immediately/i);
    await act(async () => dialogButton('Cancel').click());
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, get('button[aria-label="Request actions"]'));
    assert.deepEqual(writes, []);

    await open();
    await render(true);
    assert.equal(dialogButton('Move back to draft').disabled, true);
    await render();
    await act(async () => dialogButton('Move back to draft').click());
    assert.deepEqual(writes, [['return-to-draft']]);
    await render(false, 'The change could not be saved.');
    assert.equal(get('[role="dialog"] [role="alert"]').textContent, 'The change could not be saved.');
    succeed = true;
    await act(async () => dialogButton('Move back to draft').click());
    assert.deepEqual(writes, [['return-to-draft'], ['return-to-draft']]);
    assert.equal(document.querySelector('[role="dialog"]'), null);
  } finally {
    await act(async () => root.unmount());
  }
});

test('keyboard review announces a blocker, validates a note, advances, and restores focus', async () => {
  const root = createRoot(get('#review'));
  const writes: Parameters<SaveStaffReview>[0][] = [];
  try {
    await act(async () => root.render(createElement(Harness, { writes })));
    const first = get<HTMLButtonElement>('[data-review-row="item-1"]');
    first.focus();
    await act(async () => key(first, 'a'));
    assert.match(get('.ar-view > .ar-container > [aria-live]').textContent ?? '', /Add a photo/);
    assert.equal(writes.length, 0);
    await act(async () => key(first, 'r'));
    const note = get<HTMLTextAreaElement>('textarea');
    assert.equal(document.activeElement, note);
    await act(async () => key(note, 'Enter', { ctrlKey: true }));
    assert.equal(note.getAttribute('aria-invalid'), 'true');
    assert.match(get('#ar-note-error').textContent ?? '', /Add a short note/);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')?.set?.call(note, 'Add a new photo');
      note.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      get<HTMLButtonElement>('.ar-tags button:nth-child(2)').click();
    });
    await act(async () => key(note, 'Enter', { metaKey: true }));
    assert.deepEqual(writes[0], { itemId: 'item-1', versionId: 'item-1-v1', decision: 'changes_requested', note: 'Add a new photo', tags: ['photo'] });
    assert.equal(get('#ar-item-title').textContent, 'Two');
    assert.equal(document.activeElement, get('.ar-approve'));
    await act(async () => get<HTMLButtonElement>('.ar-approve').click());
    assert.equal(get('#ar-item-title').textContent, 'Three');
    assert.equal(document.activeElement, get('.ar-approve'));
    const third = get<HTMLButtonElement>('[data-review-row="item-3"]');
    third.focus();
    await act(async () => key(third, 'a'));
    assert.equal(get('#ar-review-complete').textContent, 'All 3 items reviewed');
    assert.equal(document.activeElement, get('#ar-review-complete'));
    assert.equal(writes.length, 3);
  } finally {
    await act(async () => root.unmount());
  }
});

test('mobile selects a detail screen and keeps focus at the next item heading', async () => {
  isMobile = true;
  const root = createRoot(get('#review'));
  try {
    await act(async () => root.render(createElement(Harness, { writes: [] })));
    assert.equal(get('.ar-view').getAttribute('data-mobile-screen'), 'list');
    await act(async () => get<HTMLButtonElement>('[data-review-row="item-2"]').click());
    assert.equal(get('.ar-view').getAttribute('data-mobile-screen'), 'detail');
    assert.equal(document.activeElement, get('#ar-item-title'));
    await act(async () => get<HTMLButtonElement>('.ar-approve').click());
    assert.equal(get('#ar-item-title').textContent, 'Three');
    assert.equal(document.activeElement, get('#ar-item-title'));
    await act(async () => get<HTMLButtonElement>('.ar-back').click());
    assert.equal(get('.ar-view').getAttribute('data-mobile-screen'), 'list');
  } finally {
    await act(async () => root.unmount());
    isMobile = false;
  }
});

test('mobile change notes open a labelled sheet and Escape returns focus', async () => {
  isMobile = true;
  const root = createRoot(get('#review'));
  try {
    await act(async () => root.render(createElement(Harness, { writes: [] })));
    await act(async () => get<HTMLButtonElement>('[data-review-row="item-2"]').click());
    const trigger = get<HTMLButtonElement>('.ar-pane-footer button:first-child');
    await act(async () => trigger.click());
    const sheet = get('[role="dialog"]');
    const field = get('textarea');
    assert.equal(document.getElementById(sheet.getAttribute('aria-labelledby') ?? '')?.textContent, 'Request changes');
    assert.equal(document.activeElement, field);
    await act(async () => key(field, 'Escape'));
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(document.activeElement, get('.ar-pane-footer button:first-child'));
  } finally {
    await act(async () => root.unmount());
    isMobile = false;
  }
});

test('Option B shows the dimensions of a photo that has already loaded', async () => {
  const root = createRoot(get('#review'));
  const imagePrototype = dom.window.HTMLImageElement.prototype;
  const dimensions = { naturalWidth: 1200, naturalHeight: 900 };
  const descriptors = Object.getOwnPropertyDescriptors(imagePrototype);
  try {
    for (const [property, value] of Object.entries(dimensions)) {
      Object.defineProperty(imagePrototype, property, { configurable: true, get: () => value });
    }
    await act(async () => root.render(createElement(StaffReviewView, {
      data: draftData(), initialSelection: 'item-2', saveReview: async () => {},
    })));
    assert.match(get('.ar-facts').textContent ?? '', /1200 × 900, 4:3/);
  } finally {
    await act(async () => root.unmount());
    for (const property of Object.keys(dimensions)) {
      Object.defineProperty(imagePrototype, property, descriptors[property]);
    }
  }
});

test('Option B selects gallery photos by keyboard, shows versioned comments, and replaces one photo', async () => {
  const root = createRoot(get('#review'));
  const data = draftData();
  const item = data.items[1];
  const version = item.version!;
  const first = version.photo_path!;
  const second = 'https://example.test/post-2.jpg';
  const third = 'https://example.test/post-3.jpg';
  const replacement = 'approval-assets/request/replacement';
  version.photo_paths = [first, second, third];
  version.photo_path = null;
  data.photos[second] = second;
  data.photos[third] = third;
  data.comments = [{
    id: 'client-photo-note', item_id: item.id, author_kind: 'client', author_name: 'Client',
    body: 'Please use this angle.', photo_position: 2, photoUrl: 'https://example.test/old-photo.jpg', versionNo: 1,
    anchor_kind: 'page', parent_id: null, block_id: null, pin_target: null, quote: null, suggested_text: null,
    suggested_image_key: null, suggestion_status: null, suggestion_reply: null, resolved_at: null,
    resolved_in_version_id: null, previewUrl: null,
  }];
  data.internalFeedback = [{
    id: 'internal-photo-note', itemId: item.id, reviewerName: 'Reviewer', decision: 'changes_requested',
    versionNo: 1, photoPosition: 3, photoUrl: null, comment: 'Swap this photo.',
  }];
  let saved: unknown;
  const fetchOriginal = globalThis.fetch;
  let uploads = 0;
  globalThis.fetch = async (input, init) => {
    uploads += 1;
    if (input === 'https://example.test/upload' && init?.method === 'PUT') return new Response(null, { status: 200 });
    assert.equal(input, '/api/approval-requests/request/assets');
    if (uploads === 1) return Response.json({ objectKey: replacement, signedUrl: 'https://example.test/upload' });
    assert.deepEqual(JSON.parse(String(init?.body)), { itemId: item.id, objectKey: replacement });
    return Response.json({ photoUrl: 'https://example.test/replacement.jpg' });
  };
  try {
    await act(async () => root.render(createElement(StaffReviewView, {
      data, initialSelection: item.id, saveReview: async () => {},
      act: async (path, body) => { assert.equal(path, 'versions'); saved = body; return true; },
    })));
    assert.equal(get('[data-review-row="item-2"] img').getAttribute('src'), first);
    assert.equal(get('.ar-approve').getAttribute('aria-disabled'), 'false');
    const gallery = get('.ar-item-details [role="group"][aria-label="Post photos"]');
    assert.equal(gallery.querySelectorAll('button[aria-pressed]').length, 3);
    assert.equal(get('.gbp-post-slide img').getAttribute('src'), first);
    assert.equal(get('[aria-label="Client comments"] a').getAttribute('href'), 'https://example.test/old-photo.jpg');
    assert.match(get('[aria-label="Internal feedback"]').textContent ?? '', /Version 1 · Photo 3/);

    const preview = get('.gbp-post');
    const navigation = preview.querySelector('[role="group"][aria-label="Preview photos"]');
    assert.ok(navigation);
    const count = get('.gbp-post [aria-live="polite"]');
    assert.equal(count.textContent, '1 / 3');
    const next = get<HTMLButtonElement>('.gbp-post [aria-label="Next photo"]');
    const previous = get<HTMLButtonElement>('.gbp-post [aria-label="Previous photo"]');
    await act(async () => next.click());
    assert.equal(count.textContent, '2 / 3');
    assert.equal(get('.gbp-post-slide img').getAttribute('src'), second);
    assert.equal(gallery.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label'), 'Select photo 2 of 3');
    await act(async () => previous.click());
    previous.focus();
    await act(async () => key(previous, 'ArrowLeft'));
    assert.equal(count.textContent, '3 / 3');
    assert.equal(get('.gbp-post-slide img').getAttribute('src'), third);
    assert.equal(document.activeElement, previous);
    next.focus();
    await act(async () => key(next, 'ArrowRight'));
    assert.equal(count.textContent, '1 / 3');
    assert.equal(document.activeElement, next);
    const thirdDot = get<HTMLButtonElement>('.gbp-post [aria-label="Show photo 3 of 3"]');
    await act(async () => thirdDot.click());
    assert.equal(count.textContent, '3 / 3');
    assert.equal(thirdDot.getAttribute('aria-pressed'), 'true');
    assert.equal(navigation.querySelectorAll('img').length, 1);
    assert.equal(navigation.querySelector('figcaption'), null);
    (navigation as HTMLElement).focus();
    await act(async () => key(navigation, 'ArrowRight'));
    assert.equal(count.textContent, '1 / 3');

    const firstThumb = get<HTMLButtonElement>('[aria-label="Select photo 1 of 3"]');
    firstThumb.focus();
    await act(async () => key(firstThumb, 'ArrowRight'));
    assert.equal(document.activeElement, get('[aria-label="Select photo 2 of 3"]'));
    assert.equal(document.activeElement?.getAttribute('aria-pressed'), 'true');
    assert.equal(count.textContent, '2 / 3');
    const image = get<HTMLImageElement>('.gbp-post-slide img');
    assert.equal(image.getAttribute('src'), second);
    await act(async () => {
      Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 900 } });
      image.dispatchEvent(new dom.window.Event('load'));
    });
    assert.match(get('.ar-facts').textContent ?? '', /1200 × 900, 4:3/);
    const enlarge = get<HTMLButtonElement>('[aria-label="Enlarge photo 2 of 3 for item 2"]');
    enlarge.focus();
    await act(async () => enlarge.click());
    assert.equal(get('[role="dialog"] img').getAttribute('src'), second);
    await act(async () => key(get('[role="dialog"]'), 'Escape'));
    await act(async () => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(document.activeElement, enlarge);
    await act(async () => image.dispatchEvent(new dom.window.Event('error')));
    assert.equal(get('.gbp-post-unavailable a').getAttribute('href'), second);
    assert.match(get('.ar-facts').textContent ?? '', /PhotoPreview unavailable/);
    await act(async () => next.click());
    assert.equal(get('.gbp-post-slide img').getAttribute('src'), third);
    assert.equal(get('.ar-approve').getAttribute('aria-disabled'), 'false');
    assert.doesNotMatch(get('.ar-facts').textContent ?? '', /1200 × 900/);

    await act(async () => get<HTMLButtonElement>('.ar-item-tools button').click());
    const editor = get('[role="dialog"]');
    const replace = [...editor.querySelectorAll('label')].find(label => label.textContent === 'Replace photo 2')?.querySelector('input');
    assert.ok(replace);
    await act(async () => {
      Object.defineProperty(replace, 'files', { value: [new File(['image'], 'replace.jpg', { type: 'image/jpeg' })] });
      replace.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.equal(uploads, 3);
    assert.equal(editor.querySelector('img[alt="Photo 2 for Two"]')?.getAttribute('src'), 'https://example.test/replacement.jpg');
    const save = [...editor.querySelectorAll('button')].find(button => button.textContent === 'Post v2');
    assert.ok(save);
    await act(async () => save.click());
    assert.deepEqual(saved, { items: [{
      itemId: item.id, expectedVersionId: version.id, payload: version.payload,
      photoPaths: [first, replacement, third], changeNote: '', source: 'manual', sourceResponseId: null,
    }] });
  } finally {
    globalThis.fetch = fetchOriginal;
    await act(async () => root.unmount());
  }
});

test('Preview as client opens a three-photo GBP carousel', async () => {
  const { PreviewDialog } = require('@/components/approvals-v2/PreviewDialog') as typeof import('@/components/approvals-v2/PreviewDialog');
  const payload = draftData().items[1].version!.payload;
  const root = createRoot(get('#review'));
  try {
    await act(async () => root.render(createElement(PreviewDialog, {
      clientName: 'Example', items: [{ id: 'item', payload, photoUrl: '/one.jpg', photoUrls: ['/one.jpg', '/two.jpg', '/three.jpg'] }],
    })));
    await act(async () => get<HTMLButtonElement>('#review button').click());
    const dialog = get('[role="dialog"]');
    assert.ok(dialog.querySelector('.gbp-post-header'));
    assert.equal(dialog.querySelectorAll('.gbp-post-slide img').length, 1);
    assert.equal(dialog.querySelector('.gbp-post-count')?.textContent, '1 / 3');
    await act(async () => get<HTMLButtonElement>('[role="dialog"] [aria-label="Show photo 3 of 3"]').click());
    assert.equal(dialog.querySelector('.gbp-post-count')?.textContent, '3 / 3');
    assert.equal(dialog.querySelector('.gbp-post-slide img')?.getAttribute('src'), '/three.jpg');
    assert.equal(dialog.querySelector('figcaption'), null);
  } finally {
    await act(async () => root.unmount());
  }
});
