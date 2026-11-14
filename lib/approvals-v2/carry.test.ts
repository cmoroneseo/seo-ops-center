import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePageBody } from './page-body.ts';
import { carryAnchor, highlightAnchor } from './carry.ts';
import { validCommentAnchor } from './comment-validation.ts';
import { applyCommentSuggestion } from './apply-comment.ts';
const paragraph = (text: string, id = 'b1') => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] });
const doc = (...content: ReturnType<typeof paragraph>[]) => normalizePageBody({ type: 'doc', content });
const original = doc(paragraph('Hello 😀 world!'));
const anchor = highlightAnchor(original.body.content[0], original.outline[0].blocks[0].hash, 6, 7);
test('highlight anchors use normalized code points including emoji, retain context, and snap across blocks', () => {
  assert.equal(anchor.quote, '😀');
  assert.equal(anchor.rangeStart, 6);
  assert.equal(anchor.rangeEnd, 7);
  assert.equal(anchor.quotePrefix, 'hello ');
  assert.equal(anchor.quoteSuffix, ' world!');
  const snapped = highlightAnchor(original.body.content[0], anchor.targetHash!, 6);
  assert.equal(snapped.quote, '😀 world!');
  assert.throws(() => highlightAnchor(original.body.content[0], anchor.targetHash!, -1));
});
test('carry ladder: same, rehighlighted, moved in section/page, text changed, removed section, pins and mockup', () => {
  const carry = (next: ReturnType<typeof doc>) => carryAnchor(anchor, next.body, next.outline);
  assert.equal(carry(original).state, 'same');
  const shifted = carry(doc(paragraph('Now hello 😀 world!')));
  assert.equal(shifted.state, 'rehighlighted');
  assert.equal(shifted.rangeStart, 10);
  assert.equal(carry(doc(paragraph('Other text', 'b2'), paragraph('Hello 😀 world!', 'b3'))).state, 'moved');
  assert.equal(carry(doc(paragraph('Rewritten'))).state, 'text_changed');
  assert.equal(carry(doc(paragraph('Rewritten', 'b2'))).state, 'text_changed');
  assert.equal(carry(doc()).state, 'earlier');
  const otherSection = normalizePageBody({ type: 'doc', content: [{ type: 'heading', attrs: { level: 2, sectionId: 's2' }, content: [{ type: 'text', text: 'New section' }] }, paragraph('Hello 😀 world!', 'b3')] });
  assert.equal(carry(otherSection).state, 'moved');
  const pin = { ...anchor, anchorKind: 'pin' as const, pinTarget: 'block' as const, quote: undefined, rangeStart: undefined, rangeEnd: undefined };
  const renamed = doc(paragraph('Hello 😀 world!', 'b3'));
  assert.equal(carryAnchor(pin, renamed.body, renamed.outline).state, 'moved');
  assert.equal(carryAnchor(pin, doc(paragraph('Other')).body, doc(paragraph('Other')).outline).state, 'text_changed');
  assert.equal(carryAnchor({ anchorKind: 'pin', pinTarget: 'mockup', targetHash: 'old' }, original.body, original.outline, 'new').state, 'image_changed');
  assert.equal(carryAnchor({ anchorKind: 'pin', pinTarget: 'mockup', targetHash: 'old' }, original.body, original.outline, 'old').state, 'same');
  assert.equal(carryAnchor({ anchorKind: 'page' }, original.body, original.outline).state, 'same');
});
test('repeated quote uses prefix and suffix to choose the correct occurrence', () => {
  const next = doc(paragraph('😀 first. Hello 😀 world!'));
  const carried = carryAnchor(anchor, next.body, next.outline);
  assert.equal(carried.rangeStart, 15);
});
test('server rejects fake quotes and SEO field anchors', () => {
  assert.equal(validCommentAnchor(anchor, original.body, original.outline), true);
  assert.equal(validCommentAnchor({ ...anchor, quote: 'x' }, original.body, original.outline), false);
  assert.equal(validCommentAnchor({ ...anchor, blockId: 'metaTitle' }, original.body, original.outline), false);
  assert.equal(validCommentAnchor({ anchorKind: 'field' } as never, original.body, original.outline), false);
});
test('wording acceptance preserves source and formatting outside selection and refreshes outline', () => {
  const edited = applyCommentSuggestion(original.body, original.outline, anchor, 'beautiful');
  assert.equal(edited.body.content[0].content?.[0].text, 'Hello beautiful world!');
  assert.equal(original.body.content[0].content?.[0].text, 'Hello 😀 world!');
  assert.notEqual(edited.outline[0].blocks[0].hash, anchor.targetHash);
  assert.throws(() => applyCommentSuggestion(doc(paragraph('Rewritten')).body, doc(paragraph('Rewritten')).outline, anchor, 'new'));
});
test('removed blocks attach to the nearest surviving paragraph in the original section order', () => {
  const original = doc(paragraph('Far', 'far'), paragraph('Closer', 'close'), paragraph('Target quote', 'target'), paragraph('Nearest', 'near'));
  const selected = highlightAnchor(original.body.content[2], original.outline[0].blocks[2].hash, 0, 6);
  const next = doc(paragraph('Far', 'far'), paragraph('Nearest', 'near'));
  const carried = carryAnchor(selected, next.body, next.outline, undefined, original.outline);
  assert.equal(carried.state, 'text_changed');
  assert.equal(carried.blockId, 'near');
});
