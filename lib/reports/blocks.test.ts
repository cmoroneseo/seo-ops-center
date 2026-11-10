import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksForClientRender, splitReportPages, type Block } from './blocks';

const block = (id: string, type: Block['type']): Block => ({ id, type, props: {} });

test('a cover followed by a page break does not leave a blank first page', () => {
    const pages = splitReportPages([
        block('cover', 'cover'),
        block('break', 'page_break'),
        block('text', 'text'),
    ]);
    assert.deepEqual(pages.map(page => page.map(item => item.type)), [['cover'], ['text']]);
});

test('a leading page break does not print a blank first page', () => {
    const pages = splitReportPages([
        block('break', 'page_break'),
        block('cover', 'cover'),
        block('text', 'text'),
    ]);
    assert.deepEqual(pages.map(page => page.map(item => item.type)), [['cover'], ['text']]);
});

test('an old marketing plan block becomes the roadmap and drops stored task rows', () => {
    const rendered = blocksForClientRender({
        blocks: [
            { id: 'plan', type: 'marketing_plan', props: { planView: 'step', tasks: [{ title: 'Secret task' }], settingsOpen: true } },
            block('note', 'text'),
        ],
    });
    assert.equal(rendered[0]?.type, 'roadmap');
    assert.deepEqual(rendered[0]?.props, {});
    assert.equal(JSON.stringify(rendered).includes('Secret task'), false);
    assert.equal(rendered[1]?.type, 'text');
});

test('old share snapshots drop rank tables and map grids at render time', () => {
    const rendered = blocksForClientRender({
        blocks: [
            block('cover', 'cover'),
            block('ranks', 'keyword_rankings_table'),
            block('grid', 'grid_comparison'),
            block('tracked', 'tracked_keywords_gsc'),
            block('summary', 'text'),
        ],
    });
    assert.deepEqual(rendered.map(item => item.type), ['cover', 'tracked_keywords_gsc', 'text']);
});
