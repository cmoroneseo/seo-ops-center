import assert from 'node:assert/strict';
import test from 'node:test';

import {
    STAGE_ADD_MAX_TITLE_LENGTH,
    STAGE_ADD_MAX_TITLES,
    parseStageAddLines,
    stageAddTitlesError,
    stripStageAddLine,
    titlesFromStageAddEnter,
    titlesFromStageAddPaste,
} from './stage-add-lines.ts';

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

    assert.deepEqual(parseStageAddLines(pasted), [
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
    assert.deepEqual(titlesFromStageAddPaste(pasted)?.slice(0, 2), [
        'Review robots.txt',
        'Fix crawl errors',
    ]);
});

test('paste order is preserved and a single line is not submitted by the paste', () => {
    assert.deepEqual(parseStageAddLines('beta\nalpha\n'), ['beta', 'alpha']);
    assert.deepEqual(parseStageAddLines('beta\r\nalpha\rgamma'), ['beta', 'alpha', 'gamma']);
    assert.equal(titlesFromStageAddPaste('1. Only one line'), null);
    assert.equal(titlesFromStageAddPaste('\n- \n'), null);
    assert.equal(titlesFromStageAddPaste(''), null);
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
