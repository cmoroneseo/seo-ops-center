import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildListTree,
    convertGoogleDoc,
    countWords,
    extractDocumentId,
    hasPendingSuggestions,
    isOrderedList,
    type GoogleDoc,
    type TiptapNode,
} from './gdocs-to-tiptap.ts';
import fixture from './__fixtures__/kentina-service-page.json' with { type: 'json' };

// ─── helpers ────────────────────────────────────────────────────────────────

function tally(root: TiptapNode) {
    const nodes: Record<string, number> = {};
    const marks: Record<string, number> = {};
    const headingLevels: number[] = [];
    const walk = (n: TiptapNode) => {
        nodes[n.type] = (nodes[n.type] ?? 0) + 1;
        if (n.type === 'heading') headingLevels.push(n.attrs?.level as number);
        for (const m of n.marks ?? []) marks[m.type] = (marks[m.type] ?? 0) + 1;
        for (const c of n.content ?? []) walk(c);
    };
    walk(root);
    return { nodes, marks, headingLevels };
}

const para = (text: string, style?: string, bullet?: { listId: string; nestingLevel?: number }) => ({
    paragraph: {
        elements: [{ textRun: { content: `${text}\n` } }],
        paragraphStyle: style ? { namedStyleType: style } : undefined,
        bullet,
    },
});

// ─── the real Kentina fixture ───────────────────────────────────────────────

test('fixture: converts without warnings or dropped content', () => {
    const r = convertGoogleDoc(fixture as GoogleDoc);
    assert.deepEqual(r.warnings, []);
    assert.equal(r.doc.type, 'doc');
    assert.ok(r.wordCount > 1500, `expected a full service page, got ${r.wordCount} words`);
});

test('fixture: heading hierarchy survives, including H4', () => {
    const { nodes, headingLevels } = tally(convertGoogleDoc(fixture as GoogleDoc).doc);
    assert.equal(nodes.heading, 22);
    // The document uses H1–H4. (H5/H6 appear only in Google's document-level style
    // DEFINITIONS, not in the body — which is why we assert on converted output, not on
    // grepped JSON.) The original brief said "H1–H3"; that would flatten every H4 here.
    assert.equal(Math.min(...headingLevels), 1);
    assert.equal(Math.max(...headingLevels), 4);
    assert.equal(headingLevels.filter((l) => l === 1).length, 1, 'exactly one H1');
    assert.ok(headingLevels.filter((l) => l === 4).length >= 4, 'H4s must not be flattened');
});

test('fixture: both tables convert with a header row', () => {
    const { nodes } = tally(convertGoogleDoc(fixture as GoogleDoc).doc);
    assert.equal(nodes.table, 2, 'the doc has two tables, not one');
    assert.equal(nodes.tableRow, 10);
    assert.equal(nodes.tableHeader, 6, 'row 0 of each table is a header row (3 columns each)');
    assert.equal(nodes.tableCell, 24);
});

test('fixture: the comparison table keeps its shape and copy', () => {
    const doc = convertGoogleDoc(fixture as GoogleDoc).doc;
    const table = (doc.content ?? []).find((n) => n.type === 'table');
    assert.ok(table);
    assert.equal(table.content?.length, 6, 'header + 5 comparison rows');
    assert.equal(table.content?.[0].content?.length, 3, 'label column + two venues');
    const flat = JSON.stringify(table);
    assert.match(flat, /Masia de la Vinya/);
    assert.match(flat, /Danza del Sol/);
});

test('fixture: flat bullet paragraphs fold into real lists', () => {
    const { nodes } = tally(convertGoogleDoc(fixture as GoogleDoc).doc);
    // 21 bulleted PARAGRAPHS in the source become 21 listItems across 4 lists — the
    // distinction matters, since Google stores no list nodes at all.
    assert.equal(nodes.bulletList, 4);
    assert.equal(nodes.listItem, 21);
});

test('fixture: every link and its anchor text survive', () => {
    const { marks } = tally(convertGoogleDoc(fixture as GoogleDoc).doc);
    assert.equal(marks.link, 20);
});

test('fixture: character formatting and the horizontal rule survive', () => {
    const { nodes, marks } = tally(convertGoogleDoc(fixture as GoogleDoc).doc);
    assert.equal(marks.bold, 46);
    assert.equal(marks.underline, 11);
    assert.equal(nodes.horizontalRule, 1);
});

test('fixture: has no images and reports none to re-host', () => {
    const r = convertGoogleDoc(fixture as GoogleDoc);
    assert.deepEqual(r.imageObjectIds, []);
});

test('fixture: carries no pending Google Docs suggestions', () => {
    assert.equal(hasPendingSuggestions(fixture), false);
});

// ─── the suggestionsViewMode guard ──────────────────────────────────────────

test('pending suggestions are detected anywhere in the payload', () => {
    assert.equal(hasPendingSuggestions({}), false);
    assert.equal(hasPendingSuggestions({ suggestedInsertionIds: [] }), false);
    assert.equal(hasPendingSuggestions({ suggestedInsertionIds: ['s.1'] }), true);
    assert.equal(hasPendingSuggestions({ suggestedDeletionIds: ['s.2'] }), true);
    assert.equal(
        hasPendingSuggestions({ body: { content: [{ paragraph: { elements: [{ textRun: { suggestedInsertionIds: ['s.3'] } }] } }] } }),
        true,
        'must find suggestions nested deep in the body',
    );
    assert.equal(
        hasPendingSuggestions({ suggestedTextStyleChanges: { 's.4': {} } }),
        true,
        'style-change suggestions count too',
    );
});

// ─── lists ──────────────────────────────────────────────────────────────────

test('isOrderedList reads the document lists map, not the paragraph', () => {
    const doc: GoogleDoc = {
        lists: {
            ordered: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } },
            bulleted: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }] } },
            unspec: { listProperties: { nestingLevels: [{ glyphType: 'GLYPH_TYPE_UNSPECIFIED' }] } },
        },
    };
    assert.equal(isOrderedList(doc, 'ordered', 0), true);
    assert.equal(isOrderedList(doc, 'bulleted', 0), false);
    assert.equal(isOrderedList(doc, 'unspec', 0), false);
    assert.equal(isOrderedList(doc, 'missing', 0), false, 'unknown list must not throw');
});

test('nested bullets rebuild as a nested tree — the case the fixture does not cover', () => {
    const doc: GoogleDoc = {
        lists: { L: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }, { glyphSymbol: '○' }] } } },
        body: {
            content: [
                para('Top one', undefined, { listId: 'L' }),
                para('Nested', undefined, { listId: 'L', nestingLevel: 1 }),
                para('Nested two', undefined, { listId: 'L', nestingLevel: 1 }),
                para('Top two', undefined, { listId: 'L' }),
            ],
        },
    };
    const out = convertGoogleDoc(doc).doc;
    const list = out.content?.[0];
    assert.equal(list?.type, 'bulletList');
    assert.equal(list?.content?.length, 2, 'two top-level items');

    const firstItem = list?.content?.[0];
    const sublist = firstItem?.content?.find((n) => n.type === 'bulletList');
    assert.ok(sublist, 'the nested run must live inside the preceding item');
    assert.equal(sublist.content?.length, 2);
});

test('an ordered list imports as orderedList, not a guessed bulletList', () => {
    const doc: GoogleDoc = {
        lists: { N: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } } },
        body: { content: [para('Step one', undefined, { listId: 'N' }), para('Step two', undefined, { listId: 'N' })] },
    };
    assert.equal(convertGoogleDoc(doc).doc.content?.[0].type, 'orderedList');
});

test('two adjacent lists stay separate rather than merging', () => {
    const doc: GoogleDoc = {
        lists: {
            A: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }] } },
            B: { listProperties: { nestingLevels: [{ glyphSymbol: '●' }] } },
        },
        body: { content: [para('a1', undefined, { listId: 'A' }), para('b1', undefined, { listId: 'B' })] },
    };
    const out = convertGoogleDoc(doc).doc;
    assert.equal(out.content?.length, 2);
    assert.equal(out.content?.[0].content?.length, 1);
});

test('buildListTree survives a nesting jump with no preceding item', () => {
    const block: TiptapNode = { type: 'paragraph', content: [{ type: 'text', text: 'orphan depth' }] };
    const tree = buildListTree([{ nestingLevel: 2, ordered: false, block }]);
    assert.ok(tree, 'malformed nesting must not drop the content');
    assert.match(JSON.stringify(tree), /orphan depth/);
});

test('buildListTree on an empty run is null', () => {
    assert.equal(buildListTree([]), null);
});

// ─── inline content ─────────────────────────────────────────────────────────

test('text styles map to Tiptap marks, including sub/superscript', () => {
    const doc: GoogleDoc = {
        body: {
            content: [{
                paragraph: {
                    elements: [
                        { textRun: { content: 'bold', textStyle: { bold: true } } },
                        { textRun: { content: 'struck', textStyle: { strikethrough: true } } },
                        { textRun: { content: 'sup', textStyle: { baselineOffset: 'SUPERSCRIPT' } } },
                        { textRun: { content: 'linked\n', textStyle: { link: { url: 'https://example.com' } } } },
                    ],
                },
            }],
        },
    };
    const { marks } = tally(convertGoogleDoc(doc).doc);
    assert.equal(marks.bold, 1);
    assert.equal(marks.strike, 1);
    assert.equal(marks.superscript, 1);
    assert.equal(marks.link, 1);
});

test('the trailing newline Google puts on every paragraph is structure, not text', () => {
    const doc: GoogleDoc = { body: { content: [para('Hello')] } };
    const text = convertGoogleDoc(doc).doc.content?.[0].content?.[0].text;
    assert.equal(text, 'Hello');
});

test('images route through resolveImage so no expired contentUri escapes', () => {
    const doc: GoogleDoc = {
        body: { content: [{ paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'obj1' } }] } }] },
        inlineObjects: {
            obj1: {
                inlineObjectProperties: {
                    embeddedObject: {
                        imageProperties: { contentUri: 'https://lh3.googleusercontent.com/expires-soon' },
                        description: 'Vineyard at golden hour',
                    },
                },
            },
        },
    };

    const r = convertGoogleDoc(doc, {
        resolveImage: (id) => `https://supabase.example/approval-content/${id}.png`,
    });
    const image = r.doc.content?.[0].content?.[0];
    assert.equal(image?.type, 'image');
    assert.equal(image?.attrs?.src, 'https://supabase.example/approval-content/obj1.png');
    assert.equal(image?.attrs?.alt, 'Vineyard at golden hour', 'alt text is an SEO requirement');
    assert.deepEqual(r.imageObjectIds, ['obj1']);
});

test('an unresolvable image is dropped with a warning, never left pointing at Google', () => {
    const doc: GoogleDoc = {
        body: { content: [{ paragraph: { elements: [{ inlineObjectElement: { inlineObjectId: 'obj1' } }] } }] },
        inlineObjects: { obj1: { inlineObjectProperties: { embeddedObject: { imageProperties: { contentUri: 'https://lh3.googleusercontent.com/x' } } } } },
    };
    const r = convertGoogleDoc(doc, { resolveImage: () => null });
    assert.match(JSON.stringify(r.doc), /^(?!.*googleusercontent).*$/s);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /dropped/i);
});

test('TITLE and SUBTITLE become headings rather than being lost', () => {
    const doc: GoogleDoc = { body: { content: [para('The Title', 'TITLE'), para('A subtitle', 'SUBTITLE')] } };
    const { headingLevels } = tally(convertGoogleDoc(doc).doc);
    assert.deepEqual(headingLevels, [1, 2]);
});

test('an empty document still yields a valid doc node', () => {
    const r = convertGoogleDoc({});
    assert.deepEqual(r.doc, { type: 'doc', content: [{ type: 'paragraph' }] });
    assert.equal(r.wordCount, 0);
});

test('countWords ignores structure and counts only text', () => {
    assert.equal(countWords({ type: 'doc', content: [{ type: 'text', text: 'one two  three' }] }), 3);
    assert.equal(countWords({ type: 'horizontalRule' }), 0);
});

// ─── url parsing ────────────────────────────────────────────────────────────

test('extractDocumentId accepts share URLs, plain ids, and rejects junk', () => {
    assert.equal(
        extractDocumentId('https://docs.google.com/document/d/1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU/edit?usp=sharing'),
        '1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU',
    );
    assert.equal(
        extractDocumentId('  1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU  '),
        '1_tKQhG3G7oy1HC35wUzaG7T0fRtaoAPCot8tcFlTRfU',
    );
    assert.equal(extractDocumentId('https://example.com/not-a-doc'), null);
    assert.equal(extractDocumentId(''), null);
});
