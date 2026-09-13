import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankQueries } from './query-matcher.ts';

test('rankQueries: returns top 3 by clicks', () => {
    const facts = [
        { query: 'plumber dallas', page: '/services', clicks: 50, impressions: 200 },
        { query: 'plumbing company', page: '/services', clicks: 30, impressions: 100 },
        { query: 'emergency plumber', page: '/services', clicks: 20, impressions: 80 },
        { query: 'drain repair', page: '/services', clicks: 5, impressions: 40 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 3);
    assert.equal(result[0].query, 'plumber dallas');
    assert.equal(result[0].clicks, 50);
    assert.ok(Math.abs(result[0].confidence - 50 / 105) < 0.001);
    assert.equal(result[1].query, 'plumbing company');
    assert.equal(result[2].query, 'emergency plumber');
});

test('rankQueries: filters to matching page', () => {
    const facts = [
        { query: 'plumber dallas', page: '/services', clicks: 50, impressions: 200 },
        { query: 'about us', page: '/about', clicks: 100, impressions: 500 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 1);
    assert.equal(result[0].query, 'plumber dallas');
    assert.equal(result[0].confidence, 1);
});

test('rankQueries: empty facts → empty result', () => {
    assert.deepEqual(rankQueries([], '/services'), []);
});

test('rankQueries: normalizes page paths (strips trailing slash)', () => {
    const facts = [
        { query: 'test', page: 'https://client.com/services/', clicks: 10, impressions: 50 },
    ];
    const result = rankQueries(facts, '/services');
    assert.equal(result.length, 1);
});

test('rankQueries: fewer than 3 facts → returns all', () => {
    const facts = [
        { query: 'only one', page: '/contact', clicks: 5, impressions: 20 },
    ];
    const result = rankQueries(facts, '/contact');
    assert.equal(result.length, 1);
    assert.equal(result[0].confidence, 1);
});
