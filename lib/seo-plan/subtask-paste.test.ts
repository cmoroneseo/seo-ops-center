import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSubtaskPaste, readSubtaskPaste } from './subtask-paste.ts';

test('a multi-line paste strips bullets, dashes, numbers, and checkboxes', () => {
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
        '[ ] Confirm the profile',
        '(x) Reply to the owner',
        '12. Build local landing pages',
    ].join('\n');

    assert.deepEqual(parseSubtaskPaste(pasted), [
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
        'Confirm the profile',
        'Reply to the owner',
        'Build local landing pages',
    ]);
    const preview = readSubtaskPaste(pasted);
    assert.equal(preview.kind, 'preview');
    if (preview.kind !== 'preview') return;
    assert.equal(preview.titles.length, 14);
    assert.equal(preview.lines.length, preview.titles.length);
});

test('indented lines stay subtasks of the open parent', () => {
    const pasted = [
        'Houzz photos',
        '  - Porch.com listing',
        '\tThumbtack profile',
        '    [x] Confirm the hours',
    ].join('\n');
    assert.deepEqual(parseSubtaskPaste(pasted), [
        'Houzz photos',
        'Porch.com listing',
        'Thumbtack profile',
        'Confirm the hours',
    ]);
});

test('blank lines and bare marks are dropped, and paste order stays', () => {
    assert.deepEqual(parseSubtaskPaste('beta\n\nalpha\n- \n-\n'), ['beta', 'alpha']);
    assert.deepEqual(parseSubtaskPaste('beta\r\nalpha\rgamma'), ['beta', 'alpha', 'gamma']);
    assert.equal(parseSubtaskPaste('').length, 0);
    assert.equal(parseSubtaskPaste('\n- \n').length, 0);
});

test('a title that merely starts with a number is kept', () => {
    assert.deepEqual(parseSubtaskPaste('2026 roadmap\n10.2 Update the brief\n-ish note'), [
        '2026 roadmap',
        '10.2 Update the brief',
        '-ish note',
    ]);
});

test('one kept line fills the field, and a single-line paste is left alone', () => {
    assert.deepEqual(readSubtaskPaste('1. Only one line'), { kind: 'none' });
    assert.deepEqual(readSubtaskPaste('- Houzz photos\n'), { kind: 'line', title: 'Houzz photos' });
    assert.deepEqual(readSubtaskPaste('\n- \n'), { kind: 'none' });
    assert.deepEqual(readSubtaskPaste(''), { kind: 'none' });
});

test('the confirm shows the stored title and keeps a live URL on the line sent to create', () => {
    const preview = readSubtaskPaste('Chino service page https://example.com/chino\n- Review robots.txt\n');
    assert.equal(preview.kind, 'preview');
    if (preview.kind !== 'preview') return;
    assert.deepEqual(preview.titles, ['Chino service page', 'Review robots.txt']);
    assert.deepEqual(preview.lines, [
        'Chino service page https://example.com/chino',
        'Review robots.txt',
    ]);
    assert.equal(preview.titles.length, 2);
});
