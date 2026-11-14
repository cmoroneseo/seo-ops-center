import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalTypes, pagePayloadSchema, canonicalJson } from './registry.ts';
const page = { schemaVersion: 1, pageKind: 'blog', title: 'Title', metaTitle: 'Title', metaDescription: '', slug: 'blog/page', body: { type: 'doc', content: [] } };
test('registry preserves GBP and validates structural page payloads', () => {
    assert.equal(approvalTypes.gbp_post.maxPayloadBytes, 16384);
    assert.equal(approvalTypes.page.maxPayloadBytes, 1048576);
    assert.deepEqual(approvalTypes.page.suggestionFields, []);
    assert.equal(pagePayloadSchema.safeParse(page).success, true);
    for (const patch of [{ slug: '/leading' }, { slug: 'UPPER' }, { slug: 'a//b' }, { title: '' }, { metaTitle: 'x'.repeat(121) }, { metaDescription: 'x'.repeat(321) }, { plannedDate: '2026-02-30' }, { body: { type: 'paragraph' } }]) {
        assert.equal(pagePayloadSchema.safeParse({ ...page, ...patch }).success, false);
    }
});
test('canonical body strips anchor attrs only; page suggestions cannot edit metadata', () => {
    assert.equal(canonicalJson({ z: 1, attrs: { blockId: 'b', sectionId: 's', level: 2 }, a: [] }), '{"a":[],"attrs":{"level":2},"z":1}');
    const p = pagePayloadSchema.parse(page);
    assert.equal(approvalTypes.page.applySuggestion(p, { title: 'New', targetKeyword: 'hidden' }).title, 'Title');
    assert.equal(approvalTypes.page.applySuggestion(p, { targetKeyword: 'hidden' }).targetKeyword, undefined);
});
