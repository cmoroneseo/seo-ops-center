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

test('rankQueries aggregates repeated daily query/page facts before ranking and confidence', () => {
    const result = rankQueries([
        { query: 'daily winner', page: 'https://client.com/services/', clicks: 30, impressions: 100 },
        { query: 'daily winner', page: 'https://client.com/services?day=2', clicks: 30, impressions: 100 },
        { query: 'one day spike', page: 'https://client.com/services', clicks: 50, impressions: 100 },
        { query: 'third', page: 'https://client.com/services', clicks: 10, impressions: 100 },
        { query: 'fourth', page: 'https://client.com/services', clicks: 5, impressions: 100 },
        { query: 'other page', page: 'https://client.com/contact', clicks: 900, impressions: 1000 },
    ], 'https://client.com/services');
    assert.deepEqual(result, [
        { query: 'daily winner', clicks: 60, confidence: 0.48 },
        { query: 'one day spike', clicks: 50, confidence: 0.4 },
        { query: 'third', clicks: 10, confidence: 0.08 },
    ]);
});

test('rankQueries does not merge a second website or subdomain that has the same path', () => {
    const result = rankQueries([
        { query: 'right site', page: 'https://client.com/services', clicks: 2, impressions: 10 },
        { query: 'wrong site', page: 'https://other.com/services', clicks: 200, impressions: 500 },
        { query: 'wrong subdomain', page: 'https://shop.client.com/services', clicks: 300, impressions: 500 },
    ], 'https://client.com/services');
    assert.deepEqual(result, [{ query: 'right site', clicks: 2, confidence: 1 }]);
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
