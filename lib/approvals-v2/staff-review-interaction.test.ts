import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, createElement, useState } from 'react';
import type { SaveStaffReview, StaffReviewData, StaffReviewItem } from '@/components/approvals-v2/StaffReviewTypes';

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
