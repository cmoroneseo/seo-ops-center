import test from 'node:test';
import assert from 'node:assert/strict';

import { applySuggestions, approvalSchema, type ApplicableSuggestion } from './apply-suggestion.ts';
import type { ContentAnchor } from '../types.ts';

// A document whose positions are easy to reason about:
// pos 0 = start of doc, 1 = start of the paragraph's text.
const doc = (text: string) => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const TEXT = 'We serve a corporate wine tasting in Temecula.';
const at = (needle: string, source = TEXT): ContentAnchor => {
    const index = source.indexOf(needle);
    return { from: index + 1, to: index + 1 + needle.length, quotedText: needle };
};

const plain = (json: Record<string, unknown>): string => {
    const node = approvalSchema().nodeFromJSON(json);
    return node.textBetween(0, node.content.size, '\n', ' ');
};

const suggestion = (over: Partial<ApplicableSuggestion>): ApplicableSuggestion => ({
    id: 's1', kind: 'replace', anchor: at('corporate'), payload: 'private', ...over,
});

test('a replace rewrites exactly the anchored words', () => {
    const r = applySuggestions(doc(TEXT), [suggestion({})]);
    assert.deepEqual(r.applied, ['s1']);
    assert.deepEqual(r.skipped, []);
    assert.equal(plain(r.doc), 'We serve a private wine tasting in Temecula.');
});

test('a delete removes the range and nothing else', () => {
    const r = applySuggestions(doc(TEXT), [suggestion({ kind: 'delete', anchor: at('corporate '), payload: '' })]);
    assert.deepEqual(r.applied, ['s1']);
    assert.equal(plain(r.doc), 'We serve a wine tasting in Temecula.');
});

test('an insert adds text without disturbing what is there', () => {
    const r = applySuggestions(doc(TEXT), [
        suggestion({ kind: 'insert', anchor: { from: at('wine').from, to: at('wine').from, quotedText: '' }, payload: 'lovely ' }),
    ]);
    assert.deepEqual(r.applied, ['s1']);
    assert.equal(plain(r.doc), 'We serve a corporate lovely wine tasting in Temecula.');
});

test('multiple suggestions all land, applied back to front', () => {
    // Front-to-back would shift every later anchor by the length delta of the first edit.
    // "Temecula" sits after "corporate", so if ordering were wrong this would corrupt.
    const r = applySuggestions(doc(TEXT), [
        suggestion({ id: 'first', anchor: at('corporate'), payload: 'private' }),
        suggestion({ id: 'second', anchor: at('Temecula'), payload: 'Napa' }),
    ]);
    assert.deepEqual(r.applied.sort(), ['first', 'second']);
    assert.equal(plain(r.doc), 'We serve a private wine tasting in Napa.');
});

test('a length-changing edit does not corrupt a later one', () => {
    const r = applySuggestions(doc(TEXT), [
        suggestion({ id: 'grow', anchor: at('corporate'), payload: 'extraordinarily bespoke corporate' }),
        suggestion({ id: 'tail', anchor: at('Temecula'), payload: 'Napa' }),
    ]);
    assert.deepEqual(r.applied.sort(), ['grow', 'tail']);
    assert.equal(plain(r.doc), 'We serve a extraordinarily bespoke corporate wine tasting in Napa.');
});

test('a stale suggestion is refused rather than rewriting the wrong words', () => {
    // The client suggested against v1; the writer has since changed that sentence.
    const edited = doc('We serve a PRIVATE event in Temecula.');
    const r = applySuggestions(edited, [suggestion({ anchor: at('corporate'), payload: 'private' })]);
    assert.deepEqual(r.applied, []);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /text has changed/i);
    assert.equal(plain(r.doc), 'We serve a PRIVATE event in Temecula.', 'document untouched');
});

test('whitespace and smart-quote differences do not count as staleness', () => {
    const r = applySuggestions(doc(TEXT), [
        suggestion({ anchor: { ...at('corporate'), quotedText: '  Corporate  ' }, payload: 'private' }),
    ]);
    assert.deepEqual(r.applied, ['s1'], 'normalised comparison should still match');
});

test('an out-of-range anchor is skipped, not thrown', () => {
    const r = applySuggestions(doc(TEXT), [suggestion({ anchor: { from: 9000, to: 9100, quotedText: 'x' } })]);
    assert.deepEqual(r.applied, []);
    assert.match(r.skipped[0].reason, /no longer inside the document/i);
});

test('overlapping suggestions: one applies, the other is reported', () => {
    const r = applySuggestions(doc(TEXT), [
        suggestion({ id: 'wide', anchor: at('corporate wine'), payload: 'private tasting' }),
        suggestion({ id: 'narrow', anchor: at('wine'), payload: 'beer' }),
    ]);
    assert.equal(r.applied.length, 1);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /overlaps/i);
});

test('an empty replacement is refused with a message that says what to do', () => {
    const r = applySuggestions(doc(TEXT), [suggestion({ payload: '' })]);
    assert.deepEqual(r.applied, []);
    assert.match(r.skipped[0].reason, /use a delete instead/i);
});

test('replacement text inherits the marks of the run it sits in', () => {
    const bolded = {
        type: 'doc',
        content: [{
            type: 'paragraph',
            content: [
                { type: 'text', text: 'We serve a ' },
                { type: 'text', text: 'corporate', marks: [{ type: 'bold' }] },
                { type: 'text', text: ' tasting.' },
            ],
        }],
    };
    const r = applySuggestions(bolded, [suggestion({ anchor: at('corporate', 'We serve a corporate tasting.'), payload: 'private' })]);
    assert.deepEqual(r.applied, ['s1']);
    const marks = JSON.stringify(r.doc).match(/"bold"/g) ?? [];
    assert.ok(marks.length >= 1, 'rewording inside a bold run must not strip the bold');
    assert.match(JSON.stringify(r.doc), /private/);
});

test('an unparseable document skips everything rather than throwing', () => {
    const r = applySuggestions({ type: 'notARealNode' }, [suggestion({})]);
    assert.deepEqual(r.applied, []);
    assert.equal(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /could not be parsed/i);
});

test('an empty suggestion set leaves the document untouched', () => {
    const r = applySuggestions(doc(TEXT), []);
    assert.deepEqual(r.applied, []);
    assert.equal(plain(r.doc), TEXT);
});
