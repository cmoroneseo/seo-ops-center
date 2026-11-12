import assert from 'node:assert/strict';
import test from 'node:test';

import { exampleGroupBoard, exampleGroupInput } from './fixture.ts';
import { buildGroupSummary, buildPageImpactRows } from './group.ts';
import { normalizeChange, validateChange } from './validate.ts';

test('a group test needs a treatment and at least two pages', () => {
    const input = exampleGroupInput();
    assert.equal(validateChange(input), null);
    const saved = normalizeChange(input);
    assert.equal(saved?.testKind, 'group');
    assert.equal(saved?.treatment, 'title_meta');
    assert.equal(saved?.pages.length, 3);
    assert.equal(validateChange({ ...input, treatment: '' }), 'Pick a treatment.');
    assert.equal(validateChange({ ...input, testKind: 'group', pages: input.pages.slice(0, 1) }), 'Add at least two pages for a group test.');
    assert.equal(validateChange({ ...input, testKind: 'split' }), 'Pick one page or a group of pages.');
    assert.equal(normalizeChange({ ...input, testKind: 'single' })?.testKind, 'single');
    assert.equal(normalizeChange({ ...input, testKind: 'single' })?.treatment, '');
});

test('the group summary uses sitewide clicks, and each URL keeps its own change', () => {
    const board = exampleGroupBoard();
    const impact = board.impacts['example-group-title-meta'];
    assert.equal(impact.headline.ready, true);
    assert.equal(impact.headline.days, 56);
    const summary = buildGroupSummary(impact);
    const clicks = summary.rows.find(row => row.id === 'clicks');
    const site = summary.rows.find(row => row.id === 'site_clicks');
    const position = summary.rows.find(row => row.id === 'avg_position');
    assert.equal(clicks?.before, 14);
    assert.equal(clicks?.after, 16);
    assert.equal(site?.before, 80);
    assert.equal(site?.after, 84);
    assert.notEqual(site?.before, impact.baselineControl?.clicks);
    assert.ok(position?.before != null && position.before > 0);
    assert.equal(summary.rows.find(row => row.id === 'ctr')?.before != null, true);

    assert.equal(impact.pageRows.length, 3);
    assert.equal(impact.pageRows[0].label, 'Hardscape');
    assert.equal(impact.pageRows[0].clicksChange, 0.6);
    assert.equal(impact.pageRows[1].clicksChange, 0);
    assert.ok((impact.pageRows[2].clicksChange ?? 0) < 0);
    assert.equal(impact.pageRows.every(row => row.clicksChange != null), true);

    const early = buildPageImpactRows({
        pages: [{ url: 'https://www.northshore-example.test/services/hardscape', label: 'Hardscape' }],
        series: [[]],
        liveOn: '2026-09-15',
        finalThrough: '2026-12-12',
        afterDays: null,
    });
    assert.equal(early[0].clicksChange, null);
    assert.notEqual(early[0].clicksChange, 0);
});
