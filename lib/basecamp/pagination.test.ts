import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPageUrl } from './pagination.ts';

test('a normal next link advances', () => {
    const seen = new Set<string>(['https://x/page1']);
    assert.equal(
        nextPageUrl('<https://x/page2>; rel="next"', seen),
        'https://x/page2',
    );
});

test('a repeated URL terminates instead of looping', () => {
    // Basecamp's project timesheet endpoint does exactly this, and following
    // it multiplies every entry by the page count.
    const seen = new Set<string>(['https://x/page2']);
    assert.equal(nextPageUrl('<https://x/page2>; rel="next"', seen), null);
});

test('a missing or empty header ends pagination', () => {
    assert.equal(nextPageUrl(null, new Set()), null);
    assert.equal(nextPageUrl('', new Set()), null);
});

test('a header without a next relation ends pagination', () => {
    assert.equal(nextPageUrl('<https://x/page1>; rel="prev"', new Set()), null);
});

test('the next relation is found among several relations', () => {
    assert.equal(
        nextPageUrl('<https://x/p1>; rel="prev", <https://x/p3>; rel="next"', new Set()),
        'https://x/p3',
    );
});
