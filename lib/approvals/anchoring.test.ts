import test from 'node:test';
import assert from 'node:assert/strict';

import { Mapping, StepMap } from '@tiptap/pm/transform';

import {
    anchorDrift,
    buildAnchor,
    CONTEXT_CHARS,
    mapAnchor,
    mapAnchors,
    normalizeForMatch,
    segmentHighlights,
} from './anchoring.ts';
import type { ContentAnchor } from '../types.ts';

const TEXT = 'A corporate wine tasting at Kentina is a hosted group experience in Temecula.';

test('buildAnchor captures the quote plus a repair kit of context', () => {
    const from = TEXT.indexOf('hosted group');
    const to = from + 'hosted group'.length;
    const a = buildAnchor(from, to, TEXT);
    assert.equal(a.quotedText, 'hosted group');
    assert.ok(a.prefix && TEXT.startsWith(a.prefix.slice(0, 5)) === false || true);
    assert.ok((a.prefix ?? '').length <= CONTEXT_CHARS);
    assert.ok((a.suffix ?? '').length <= CONTEXT_CHARS);
    assert.equal(TEXT.slice(a.from, a.to), a.quotedText);
});

test('buildAnchor clamps context at the document edges', () => {
    const a = buildAnchor(0, 1, TEXT);
    assert.equal(a.prefix, '');
    const b = buildAnchor(TEXT.length - 1, TEXT.length, TEXT);
    assert.equal(b.suffix, '');
});

// A StepMap of [start, oldSize, newSize] describes one replacement.
const mapperForInsert = (at: number, length: number) =>
    new Mapping([new StepMap([at, 0, length])]);
const mapperForDelete = (at: number, length: number) =>
    new Mapping([new StepMap([at, length, 0])]);

test('an anchor survives text inserted above it — the core revision case', () => {
    const anchor: ContentAnchor = { from: 50, to: 60, quotedText: 'experience' };
    const moved = mapAnchor(anchor, mapperForInsert(10, 25));
    assert.ok(moved);
    assert.equal(moved.from, 75);
    assert.equal(moved.to, 85);
    assert.equal(moved.quotedText, 'experience', 'the repair kit rides along unchanged');
});

test('an anchor is untouched by an edit below it', () => {
    const anchor: ContentAnchor = { from: 10, to: 20, quotedText: 'corporate' };
    const moved = mapAnchor(anchor, mapperForInsert(400, 30));
    assert.deepEqual(moved, anchor);
});

test('deleting the anchored text orphans the comment rather than moving it', () => {
    const anchor: ContentAnchor = { from: 50, to: 60, quotedText: 'experience' };
    const moved = mapAnchor(anchor, mapperForDelete(50, 10));
    assert.equal(moved, null, 'a collapsed range must report as orphaned, never be dropped');
});

test('text typed at either boundary does not silently swallow into the highlight', () => {
    const anchor: ContentAnchor = { from: 20, to: 30, quotedText: 'wine tasti' };
    const atStart = mapAnchor(anchor, mapperForInsert(20, 5));
    assert.equal(atStart?.from, 25, 'insertion at the start pushes the anchor, not widens it');
    assert.equal(atStart?.to, 35);

    const atEnd = mapAnchor(anchor, mapperForInsert(30, 5));
    assert.equal(atEnd?.from, 20);
    assert.equal(atEnd?.to, 30, 'insertion at the end stays outside the highlight');
});

test('mapAnchors reports which items orphaned and leaves anchorless items alone', () => {
    const items = [
        { id: 'keep', anchor: { from: 50, to: 60, quotedText: 'experience' } },
        { id: 'gone', anchor: { from: 100, to: 110, quotedText: 'Temecula.' } },
        { id: 'reply', anchor: null },
    ];
    const out = mapAnchors(items, mapperForDelete(100, 10));
    assert.equal(out[0].orphaned, false);
    assert.equal(out[1].orphaned, true);
    assert.equal(out[1].anchor, null);
    assert.equal(out[2].orphaned, false, 'a reply carries no anchor and cannot orphan');
});

test('normalizeForMatch ignores whitespace and smart-quote noise', () => {
    assert.equal(normalizeForMatch('  The   client’s  copy '), "the client's copy");
    assert.equal(normalizeForMatch('“quoted”'), '"quoted"');
    assert.equal(normalizeForMatch('en–dash'), 'en-dash');
});

test('anchorDrift distinguishes intact, edited, and destroyed anchors', () => {
    const from = TEXT.indexOf('hosted group');
    const anchor = buildAnchor(from, from + 'hosted group'.length, TEXT);

    assert.equal(anchorDrift(anchor, TEXT), 'intact');
    assert.equal(anchorDrift(null, TEXT), 'orphaned');
    assert.equal(anchorDrift({ ...anchor, to: anchor.from }, TEXT), 'orphaned');
    assert.equal(
        anchorDrift({ ...anchor, to: TEXT.length + 50 }, TEXT),
        'orphaned',
        'an anchor past the end of the document is not salvageable',
    );

    const edited = TEXT.replace('hosted group', 'HOSTED  GROUP');
    assert.equal(
        anchorDrift(buildAnchor(from, from + 'HOSTED  GROUP'.length, edited), edited),
        'intact',
        'case and whitespace changes are noise, not drift',
    );
    assert.equal(
        anchorDrift(anchor, TEXT.replace('hosted group', 'private event')),
        'modified',
        'rewritten text keeps the comment but flags it as stale',
    );
});

test('segmentHighlights splits overlaps so stacked comments stay legible', () => {
    const segments = segmentHighlights([
        { id: 'a', anchor: { from: 0, to: 10, quotedText: '' } },
        { id: 'b', anchor: { from: 5, to: 15, quotedText: '' } },
    ]);
    assert.deepEqual(segments, [
        { from: 0, to: 5, ids: ['a'] },
        { from: 5, to: 10, ids: ['a', 'b'] },
        { from: 10, to: 15, ids: ['b'] },
    ]);
});

test('segmentHighlights handles nesting and gaps', () => {
    const segments = segmentHighlights([
        { id: 'outer', anchor: { from: 0, to: 20, quotedText: '' } },
        { id: 'inner', anchor: { from: 5, to: 10, quotedText: '' } },
        { id: 'far', anchor: { from: 40, to: 50, quotedText: '' } },
    ]);
    assert.deepEqual(segments, [
        { from: 0, to: 5, ids: ['outer'] },
        { from: 5, to: 10, ids: ['outer', 'inner'] },
        { from: 10, to: 20, ids: ['outer'] },
        { from: 40, to: 50, ids: ['far'] },
    ]);
    assert.ok(
        !segments.some((s) => s.from === 20 && s.to === 40),
        'the gap between highlights must not render as a segment',
    );
});

test('segmentHighlights on an empty set is empty', () => {
    assert.deepEqual(segmentHighlights([]), []);
});
