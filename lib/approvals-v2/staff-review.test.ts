import assert from 'node:assert/strict';
import test from 'node:test';
import {
  characterCount, filterReviewItems, nextUnreviewed, reviewCounts, reviewShortcut, reviewStatus, staffReviewBlockers,
  type StaffReview,
} from './staff-review';

function reviewed(id: string, decision: StaffReview['decision'], current = id) {
  return {
    id, status: 'pending' as const, current_version_id: current,
    staffReview: { version_id: id, decision, note: null, tags: [], created_at: '', reviewer_id: null, reviewer_name: null },
  };
}

test('draft status and filters follow current staff version; sent status follows the client', () => {
  const approved = reviewed('1', 'approved');
  const previous = { ...reviewed('2', 'approved', 'new'), status: 'changes_requested' as const };
  const changes = reviewed('3', 'changes_requested');
  const items = [approved, previous, changes];
  assert.equal(reviewStatus(previous, true), 'pending');
  assert.equal(reviewStatus(previous, false), 'changes_requested');
  assert.equal(reviewStatus(approved, false), 'pending');
  assert.deepEqual(reviewCounts(items, true), { all: 3, pending: 1, approved: 1, changes_requested: 1 });
  assert.deepEqual(filterReviewItems(items, 'pending', true), [previous]);
  assert.deepEqual(filterReviewItems(items, 'changes_requested', false), [previous]);
  assert.deepEqual(filterReviewItems(items, 'all', true), items);
});

test('advance skips both decisions, wraps, and excludes the just-reviewed item', () => {
  const pending = (id: string) => ({ id, status: 'pending' as const, current_version_id: id });
  const items = [pending('1'), reviewed('2', 'changes_requested'), pending('3'), reviewed('4', 'approved'), pending('5')];
  assert.equal(nextUnreviewed(items, '1')?.id, '3');
  assert.equal(nextUnreviewed(items, '5')?.id, '1');
  assert.equal(nextUnreviewed(items.slice(1, 4), '3'), undefined);
});

test('GBP validation checks the stored photo, Unicode length, and URL CTAs but accepts Call now without a URL', () => {
  assert.equal(characterCount('👍a'), 2);
  assert.deepEqual(staffReviewBlockers('gbp_post', null, { body: '👍'.repeat(1500), ctaLabel: 'Call now', ctaUrl: null }, ['photo']), []);
  assert.deepEqual(staffReviewBlockers('gbp_post', null, { body: 'x'.repeat(1501), ctaLabel: 'Learn more', ctaUrl: ' ' }, []).map(blocker => blocker.label),
    ['Photo needed', 'Over character limit', 'CTA URL needed']);
  assert.deepEqual(staffReviewBlockers('gbp_post', null, { body: 'Post', ctaLabel: 'Book now', ctaUrl: 'https://example.test' }, ['photo']), []);
});

test('blog title and target keyword block; service, city and search metadata lengths do not', () => {
  assert.deepEqual(staffReviewBlockers('page', 'blog', { title: '  ' }, []).map(blocker => blocker.label), ['Title needed', 'Keyword needed']);
  assert.deepEqual(staffReviewBlockers('page', 'blog', { title: 'Blog', targetKeyword: 'keyword' }, []), []);
  for (const kind of ['service', 'city']) {
    assert.deepEqual(staffReviewBlockers('page', kind, { metaTitle: 'x'.repeat(61), metaDescription: 'x'.repeat(161) }, []), []);
  }
});

test('shortcuts preserve editing and browser modifiers, with scoped note and list navigation', () => {
  const event = { key: 'a', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, isComposing: false };
  const context = { typing: false, inList: false, dialog: false, note: false, singleKeysOff: false };
  assert.equal(reviewShortcut(event, context), 'approve');
  for (const flag of ['typing', 'dialog', 'note', 'singleKeysOff'] as const) {
    assert.equal(reviewShortcut(event, { ...context, [flag]: true }), undefined);
  }
  for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat'] as const) {
    assert.equal(reviewShortcut({ ...event, [key]: true }, context), undefined);
  }
  assert.equal(reviewShortcut({ ...event, key: 'ArrowDown' }, context), undefined);
  assert.equal(reviewShortcut({ ...event, key: 'ArrowDown' }, { ...context, inList: true, singleKeysOff: true }), 'next');
  assert.equal(reviewShortcut({ ...event, key: 'End' }, { ...context, inList: true }), 'last');
  assert.equal(reviewShortcut({ ...event, key: '?' , shiftKey: true }, context), 'help');
  assert.equal(reviewShortcut({ ...event, key: 'Enter', metaKey: true }, { ...context, typing: true, note: true, inNote: true }), 'submitNote');
  assert.equal(reviewShortcut({ ...event, key: 'Enter', ctrlKey: true }, { ...context, note: true, inNote: false }), undefined);
  assert.equal(reviewShortcut({ ...event, key: 'Escape' }, { ...context, typing: true, note: true }), 'cancelNote');
});
