import test from 'node:test';
import assert from 'node:assert/strict';

import { anchorFromSelection, snapToWordBoundaries } from './comment-highlight.ts';
import { approvalSchema } from './apply-suggestion.ts';

const TEXT = 'This is not a casual drop-in visit. It is a planned corporate event.';

const doc = () => approvalSchema().nodeFromJSON({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }],
});

// pos 1 is the first character of the paragraph's text.
const at = (needle: string) => TEXT.indexOf(needle) + 1;
const slice = (from: number, to: number) => doc().textBetween(from, to, ' ');

test('a selection that starts and ends mid-word grows to whole words', () => {
    // Exactly the case found in live testing: dragging from inside "casual" to inside
    // "planned" produced "This is not a casprivate… It is alanned" once replaced.
    const raw = { from: at('ual drop'), to: at('planned') + 1 };
    const snapped = snapToWordBoundaries(doc(), raw.from, raw.to);
    assert.equal(slice(snapped.from, snapped.to), 'casual drop-in visit. It is a planned');
});

test('a selection already on word boundaries is left alone', () => {
    const from = at('casual');
    const to = from + 'casual'.length;
    const snapped = snapToWordBoundaries(doc(), from, to);
    assert.deepEqual(snapped, { from, to });
});

test('hyphens and apostrophes are treated as part of the word', () => {
    const from = at('drop-in') + 2; // inside "drop-in"
    const snapped = snapToWordBoundaries(doc(), from, from + 1);
    assert.equal(slice(snapped.from, snapped.to), 'drop-in');
});

test('punctuation adjacent to a word is not swallowed', () => {
    const from = at('visit');
    const snapped = snapToWordBoundaries(doc(), from, from + 3);
    assert.equal(slice(snapped.from, snapped.to), 'visit', 'the full stop stays outside');
});

test('snapping never runs past the document bounds', () => {
    const size = doc().content.size;
    const snapped = snapToWordBoundaries(doc(), -50, size + 50);
    assert.ok(snapped.from >= 0);
    assert.ok(snapped.to <= size);
});

test('a collapsed selection stays collapsed rather than grabbing a word', () => {
    const pos = at('casual') + 2;
    const snapped = snapToWordBoundaries(doc(), pos, pos);
    assert.equal(snapped.from, snapped.to, 'an empty selection must not become a word');
});

test('anchorFromSelection snaps and captures context around the snapped range', () => {
    const anchor = anchorFromSelection(doc(), at('ual drop'), at('visit') + 2);
    assert.equal(anchor.quotedText, 'casual drop-in visit');
    assert.ok(anchor.prefix?.endsWith('This is not a '));
    assert.ok(anchor.suffix?.startsWith('.'));
});
