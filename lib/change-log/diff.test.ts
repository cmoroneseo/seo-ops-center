import assert from 'node:assert/strict';
import test from 'node:test';

import { addedWords, removedWords, wordDiff, wordKey } from './diff';

const BEFORE = 'Family, Cosmetic & Emergency Dentistry in Denver, CO';
const AFTER = 'Family & Emergency Dentist in Denver, CO';

test('a heading diff marks removed and added words and keeps the shared ones', () => {
    const tokens = wordDiff(BEFORE, AFTER);
    assert.deepEqual(removedWords(tokens), ['Cosmetic', 'Dentistry']);
    assert.deepEqual(addedWords(tokens), ['Dentist']);
    assert.equal(wordKey('Family,'), wordKey('Family'));
    const same = tokens.filter(token => token.kind === 'same').map(token => token.before);
    assert.deepEqual(same, ['Family,', '&', 'Emergency', 'in', 'Denver,', 'CO']);
    assert.equal(tokens.some(token => token.kind === 'removed' && token.before === 'Family,'), false);
    assert.equal(tokens.some(token => token.kind === 'added' && token.after === 'Family'), false);
});

test('a word that only swapped with its neighbor is not rewritten', () => {
    const tokens = wordDiff(
        'Hardscape, Landscape & Outdoor Living Contractors in Corona, CA',
        'Hardscape & Landscape Contractors in Corona, CA',
    );
    assert.equal(removedWords(tokens).includes('Landscape'), false);
    assert.equal(addedWords(tokens).includes('Landscape'), false);
    assert.equal(removedWords(tokens).includes('&'), false);
    assert.equal(addedWords(tokens).includes('&'), false);
    assert.ok(removedWords(tokens).includes('Outdoor'));
    assert.ok(removedWords(tokens).includes('Living'));
});

test('unchanged text and an empty side stay honest', () => {
    const same = wordDiff('Hardscape & Landscape', 'Hardscape & Landscape');
    assert.deepEqual(same.map(token => token.kind), ['same', 'same', 'same']);
    assert.deepEqual(removedWords(same), []);
    assert.deepEqual(addedWords(same), []);

    const added = wordDiff('  ', 'New page title');
    assert.deepEqual(addedWords(added), ['New', 'page', 'title']);
    assert.deepEqual(removedWords(added), []);

    const removed = wordDiff('Old title', '');
    assert.deepEqual(removedWords(removed), ['Old', 'title']);
    assert.deepEqual(addedWords(removed), []);

    const spaced = wordDiff('Family,  Cosmetic', 'Family Cosmetic');
    assert.deepEqual(spaced.map(token => token.kind), ['same', 'same']);
});
