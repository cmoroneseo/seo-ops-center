import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    EMPTY_SPEC,
    approvalTaskDescription,
    approveUpdate,
    countWords,
    cycleTab,
    declineUpdate,
    displayCount,
    displayDate,
    displayText,
    displayWordRange,
    manualInsertRow,
    normalizeOutgoingLinks,
    parseExclusionLines,
    parseLinkLines,
    parseManualRecord,
    parseSpecPatch,
    specColumnUpdates,
} from './spec.ts';
import { rowToRecord } from '../supabase/topical-map.ts';
import type { TopicalMapRecord } from '../types.ts';

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(' ');

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
        pageType: 'blog_post', action: 'create', title: 'Marketing ROI',
        targetQuery: 'marketing roi formula', contentCategory: 'evergreen',
        wordCountMin: 1100, wordCountMax: 1600, buildPhase: 4, refreshIntervalDays: 365,
        scopeExclusions: [{ url: '/calculators/' }],
        outgoingLinks: [{ anchorText: 'ROI formula', destinationUrl: '/blog/marketing-roi/' }],
        status: 'pending', sortOrder: 0, createdAt: '', updatedAt: '',
        ...overrides,
    };
}

test('empty spec values render an em dash and never zero', () => {
    assert.equal(displayText(''), EMPTY_SPEC);
    assert.equal(displayText('   '), EMPTY_SPEC);
    assert.equal(displayText(null), EMPTY_SPEC);
    assert.equal(displayText('marketing roi formula'), 'marketing roi formula');
    assert.equal(displayCount(0), EMPTY_SPEC);
    assert.equal(displayCount(undefined), EMPTY_SPEC);
    assert.equal(displayCount(170), '170');
    assert.equal(displayWordRange(0, 0), EMPTY_SPEC);
    assert.equal(displayWordRange(null, undefined), EMPTY_SPEC);
    assert.equal(displayWordRange(1100, 1600), '1,100\u20131,600');
    assert.equal(displayWordRange(1100, 0), '1,100+');
    assert.equal(displayDate(''), EMPTY_SPEC);
    assert.equal(displayDate('not-a-date'), EMPTY_SPEC);
    assert.equal(displayDate('2026-10-12'), 'Oct 12, 2026');
    assert.equal(EMPTY_SPEC, '\u2014');
});

test('the answer is limited to 60 words', () => {
    assert.equal(countWords('  one   two three '), 3);
    assert.equal(countWords(''), 0);
    assert.equal(countWords(words(60)), 60);
    const accepted = parseSpecPatch({ answerFirst60: words(60) });
    assert.equal(accepted.ok, true);
    const rejected = parseSpecPatch({ answerFirst60: words(61) });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.match(rejected.error, /60 words or fewer \(61 words\)/);
    const cleared = parseSpecPatch({ answerFirst60: '   ' });
    assert.equal(cleared.ok && cleared.patch.answerFirst60, null);
});

test('a spec patch cannot change approval status or source', () => {
    const parsed = parseSpecPatch({
        answerFirst60: 'Spend divided by attributed revenue.',
        status: 'approved',
        source: 'gsc',
        taskId: 'task-1',
        organizationId: 'other-org',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const row = specColumnUpdates(parsed.patch);
    assert.equal(row.answer_first_60, 'Spend divided by attributed revenue.');
    assert.equal('status' in row, false);
    assert.equal('source' in row, false);
    assert.equal('task_id' in row, false);
    assert.equal('organization_id' in row, false);
    assert.equal(parseSpecPatch({ status: 'declined' }).ok, false);
});

test('manual records are pending, sourced manual, and carry no task', () => {
    const parsed = parseManualRecord({
        title: '  Marketing ROI formula  ',
        targetQuery: 'marketing roi formula',
        pageType: 'blog_post',
        wordCountMin: '1100',
        wordCountMax: 1600,
        scopeExclusions: parseExclusionLines('/calculators/ | pricing tools\n'),
        outgoingLinks: [{ anchorText: 'ROI formula', destinationUrl: '/blog/marketing-roi/' }],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const row = manualInsertRow(parsed.draft, {
        siloId: 'silo-1', mapId: 'map-1', organizationId: 'org-1', sortOrder: 4,
    });
    assert.equal(row.source, 'manual');
    assert.equal(row.status, 'pending');
    assert.equal(row.action, 'create');
    assert.equal(row.title, 'Marketing ROI formula');
    assert.equal('task_id' in row, false);
    assert.equal((row.scope_exclusions as Array<{ url: string; reason?: string }>)[0].reason, 'pricing tools');
    assert.equal(parseManualRecord({ title: '   ' }).ok, false);
    assert.equal(parseLinkLines('anchor without a destination').ok, false);
});

test('generated link rows use either casing', () => {
    const links = normalizeOutgoingLinks([
        { anchor_text: 'ROI formula', destination_title: 'Marketing ROI Formula' },
    ]);
    assert.deepEqual(links, [{ anchorText: 'ROI formula', destinationUrl: 'Marketing ROI Formula' }]);
    const mapped = rowToRecord({
        id: 'r-1', silo_id: 's-1', map_id: 'm-1', organization_id: 'o-1',
        page_type: 'blog_post', action: 'create', title: 'Marketing ROI', target_query: '',
        word_count_min: 0, word_count_max: 0, build_phase: 1, status: 'pending', sort_order: 0,
        scope_exclusions: [], outgoing_links: [{ anchor_text: 'ROI formula', destination_url: '/blog/roi' }],
        source: 'manual', spec_status: 'ready', scheduled_for: '2026-10-12',
        answer_first_60: null, created_at: '', updated_at: '',
    });
    assert.equal(mapped.source, 'manual');
    assert.equal(mapped.specStatus, 'ready');
    assert.equal(mapped.scheduledFor, '2026-10-12');
    assert.equal(mapped.answerFirst60, undefined);
    assert.equal(mapped.outgoingLinks[0].anchorText, 'ROI formula');
    assert.equal(mapped.outgoingLinks[0].destinationUrl, '/blog/roi');
});

test('approve still writes the same task brief and decline only sets declined', () => {
    assert.equal(approvalTaskDescription(record()), [
        '**Target Query:** marketing roi formula',
        '**Page Type:** blog_post',
        '**Category:** evergreen',
        '**Word Count:** 1100\u20131600',
        '**Build Phase:** 4',
        '**Refresh:** every 365 days',
        '**Stays out of:** /calculators/',
        '**Links out:** ROI formula → /blog/marketing-roi/',
    ].join('\n'));

    const empty = approvalTaskDescription(record({
        wordCountMin: 0, wordCountMax: 0, contentCategory: undefined,
        refreshIntervalDays: undefined, scopeExclusions: [], outgoingLinks: [],
    }));
    assert.equal(empty.includes('Word Count'), false);
    assert.equal(empty.includes('0\u20130'), false);
    assert.equal(empty.includes('Stays out of'), false);
    assert.equal(empty.includes('Links out'), false);
    assert.match(empty, /\*\*Target Query:\*\* marketing roi formula/);
    assert.match(empty, /\*\*Build Phase:\*\* 4/);

    const withSpec = approvalTaskDescription(record({
        answerFirst60: 'The formula is spend divided by revenue.',
        uniqueAngle: 'Agency labor is separated from media spend.',
        scheduledFor: '2026-10-12',
    }));
    assert.match(withSpec, /\*\*Answer in the first 60 words:\*\* The formula is spend divided by revenue\./);
    assert.match(withSpec, /\*\*Unique angle:\*\* Agency labor is separated from media spend\./);
    assert.match(withSpec, /\*\*Scheduled for:\*\* 2026-10-12/);
    assert.match(withSpec, /\*\*Stays out of:\*\* \/calculators\//);

    assert.deepEqual(approveUpdate('task-1'), { status: 'approved', taskId: 'task-1' });
    assert.deepEqual(Object.keys(approveUpdate('task-1')).sort(), ['status', 'taskId']);
    assert.deepEqual(declineUpdate(), { status: 'declined' });
});

test('tab order wraps inside a dialog', () => {
    assert.equal(cycleTab(0, 3, false), 1);
    assert.equal(cycleTab(2, 3, false), 0);
    assert.equal(cycleTab(0, 3, true), 2);
    assert.equal(cycleTab(-1, 3, false), 0);
    assert.equal(cycleTab(-1, 3, true), 2);
});

test('schema.sql mirrors the nullable spec columns', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.match(schema, /answer_first_60 text check/);
    assert.match(schema, /source text check \(source is null or source in \('generated', 'manual', 'crawl', 'gsc'\)\)/);
    assert.match(schema, /spec_status text check \(spec_status is null or spec_status in \('draft', 'ready'\)\)/);
    assert.match(schema, /scheduled_for date/);
    assert.doesNotMatch(schema, /answer_first_60 text not null/);
});
