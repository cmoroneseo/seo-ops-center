import assert from 'node:assert/strict';
import test from 'node:test';

import {
    STAGE_ADD_MAX_TITLE_LENGTH,
    STAGE_ADD_MAX_TITLES,
    linesFromStageAddPaste,
    parseStageAddLines,
    stageAddLineRole,
    stageAddLinesWithout,
    stageAddTitlesError,
    stripStageAddLine,
    titlesFromStageAddEnter,
    titlesFromStageAddPaste,
} from './stage-add-lines.ts';

function titles(text: string): string[] {
    return parseStageAddLines(text).map(line => line.title);
}

function depths(text: string): number[] {
    return parseStageAddLines(text).map(line => line.depth);
}

test('a typed title is kept as entered, including a leading number', () => {
    assert.deepEqual(titlesFromStageAddEnter('  Review robots.txt  '), ['Review robots.txt']);
    assert.deepEqual(titlesFromStageAddEnter('1. Keep this number'), ['1. Keep this number']);
    assert.equal(titlesFromStageAddEnter('   '), null);
    assert.equal(titlesFromStageAddEnter(''), null);
});

test('a multi-line paste strips bullets and numbering and skips blanks', () => {
    const pasted = [
        '1. Review robots.txt',
        '',
        '- Fix crawl errors',
        '* Check HTTPS',
        '• Audit Core Web Vitals',
        '2) Check mobile usability',
        '(3) Resolve duplicate content',
        '   ',
        '– Review site architecture',
        '— Implement schema',
        '· Track rankings',
        '1. - [ ] Publish the first blog batch',
        '- [x] Respond to reviews',
        '12. Build local landing pages',
    ].join('\n');

    assert.deepEqual(titles(pasted), [
        'Review robots.txt',
        'Fix crawl errors',
        'Check HTTPS',
        'Audit Core Web Vitals',
        'Check mobile usability',
        'Resolve duplicate content',
        'Review site architecture',
        'Implement schema',
        'Track rankings',
        'Publish the first blog batch',
        'Respond to reviews',
        'Build local landing pages',
    ]);
    assert.deepEqual(depths(pasted), Array(12).fill(0));
    assert.deepEqual(titlesFromStageAddPaste(pasted)?.slice(0, 2), [
        'Review robots.txt',
        'Fix crawl errors',
    ]);
});

test('paste order is preserved and a single line is not submitted by the paste', () => {
    assert.deepEqual(titles('beta\nalpha\n'), ['beta', 'alpha']);
    assert.deepEqual(titles('beta\r\nalpha\rgamma'), ['beta', 'alpha', 'gamma']);
    assert.equal(titlesFromStageAddPaste('1. Only one line'), null);
    assert.equal(linesFromStageAddPaste('1. Only one line'), null);
    assert.equal(titlesFromStageAddPaste('\n- \n'), null);
    assert.equal(titlesFromStageAddPaste(''), null);
});

test('indented lines become one-level subtasks of the latest top-level line', () => {
    const pasted = [
        'Citations round 2',
        '  - Houzz photos + project gallery',
        '  - Porch.com listing',
        '  - Thumbtack profile',
        'Update GBP holiday hours',
        'Add financing FAQ to service pages',
    ].join('\n');
    const lines = parseStageAddLines(pasted);
    assert.deepEqual(lines.map(line => line.title), [
        'Citations round 2',
        'Houzz photos + project gallery',
        'Porch.com listing',
        'Thumbtack profile',
        'Update GBP holiday hours',
        'Add financing FAQ to service pages',
    ]);
    assert.deepEqual(lines.map(line => line.depth), [0, 1, 1, 1, 0, 0]);
    assert.deepEqual(lines.map((_, index) => stageAddLineRole(lines, index)), [
        'pillar', 'subtask', 'subtask', 'subtask', 'task', 'task',
    ]);
});

test('a tab or a nested bullet marks a subtask, and deeper indents flatten', () => {
    const pasted = [
        'Citations round 2',
        '\tHouzz photos',
        '\t\tPorch.com listing',
        ' - Thumbtack profile',
        '  2) Update the hours',
        '   [x] Confirm the profile',
        'Update GBP holiday hours',
        '    Still a subtask of the new pillar',
        '      And so is this',
    ].join('\n');
    assert.deepEqual(depths(pasted), [0, 1, 1, 1, 1, 1, 0, 1, 1]);
    assert.deepEqual(titles(pasted).slice(3, 6), [
        'Thumbtack profile',
        'Update the hours',
        'Confirm the profile',
    ]);
});

test('an indented first line is top-level, and a single space without a mark is not a subtask', () => {
    assert.deepEqual(depths('  First\n  Second\n    Third'), [0, 0, 1]);
    assert.deepEqual(depths('\tFirst\n\t\tSecond'), [0, 1]);
    assert.deepEqual(depths('Parent\n child'), [0, 0]);
    assert.deepEqual(titles('Parent\n  -\nSibling'), ['Parent', 'Sibling']);
    assert.deepEqual(depths('Parent\n  -\nSibling'), [0, 0]);
});

test('the parser keeps lines past the caps so the preview can refuse them', () => {
    const many = Array.from({ length: STAGE_ADD_MAX_TITLES + 1 }, (_, index) => `Task ${index}`).join('\n');
    assert.equal(parseStageAddLines(many).length, STAGE_ADD_MAX_TITLES + 1);
    assert.equal(linesFromStageAddPaste(many)?.length, STAGE_ADD_MAX_TITLES + 1);
    const long = 'x'.repeat(STAGE_ADD_MAX_TITLE_LENGTH + 1);
    assert.equal(parseStageAddLines(`Short\n${long}`)[1]?.title.length, STAGE_ADD_MAX_TITLE_LENGTH + 1);
    assert.equal(stageAddTitlesError(parseStageAddLines(many).map(line => line.title)), 'Add up to 40 tasks at a time.');
    assert.equal(stageAddTitlesError([long]), 'Keep each title under 300 characters.');
});

test('dropping a line reparses the indent so a removed pillar does not orphan its subtasks', () => {
    const lines = parseStageAddLines('Citations\n  Houzz\n  Porch\nUpdate GBP');
    const withoutPillar = stageAddLinesWithout(lines, 0);
    assert.deepEqual(withoutPillar.map(line => line.depth), [0, 0, 0]);
    assert.deepEqual(withoutPillar.map(line => line.title), ['Houzz', 'Porch', 'Update GBP']);
    const withoutChild = stageAddLinesWithout(lines, 1);
    assert.deepEqual(withoutChild.map(line => [line.title, line.depth]), [
        ['Citations', 0],
        ['Porch', 1],
        ['Update GBP', 0],
    ]);
    assert.equal(stageAddLineRole(withoutChild, 0), 'pillar');
});

test('a title that merely starts with a number is not treated as a list marker', () => {
    assert.equal(stripStageAddLine('2026 roadmap'), '2026 roadmap');
    assert.equal(stripStageAddLine('10.2 Update the brief'), '10.2 Update the brief');
    assert.equal(stripStageAddLine('SEO Setup'), 'SEO Setup');
    assert.equal(stripStageAddLine('-ish note'), '-ish note');
    assert.equal(stripStageAddLine('\uFEFF  1. Kickoff  '), 'Kickoff');
});

test('batches over the line or title cap are rejected', () => {
    assert.equal(stageAddTitlesError([]), 'Enter a title.');
    assert.equal(stageAddTitlesError(['Review robots.txt']), null);
    assert.equal(stageAddTitlesError(Array.from({ length: STAGE_ADD_MAX_TITLES }, (_, index) => `Task ${index}`)), null);
    assert.match(stageAddTitlesError(Array.from({ length: STAGE_ADD_MAX_TITLES + 1 }, () => 'Task')) ?? '', /40/);
    assert.match(stageAddTitlesError(['x'.repeat(STAGE_ADD_MAX_TITLE_LENGTH + 1)]) ?? '', /300/);
    assert.equal(stageAddTitlesError(['x'.repeat(STAGE_ADD_MAX_TITLE_LENGTH)]), null);
});
