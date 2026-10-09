import test from 'node:test';
import assert from 'node:assert/strict';
import {
    HEAVY_DAY_CHUNK,
    LIGHT_DAY_CHUNK,
    chunkList,
    insightFactGrains,
    readGrainedFacts,
} from './fact-read';
import type { SearchReportingAdmin } from './load';

function days(count: number): string[] {
    return Array.from({ length: count }, (_, index) => `day-${index + 1}`);
}

function adminFor(handler: (grain: string, dayIds: readonly unknown[]) => { data: unknown[] | null; error: { message?: string } | null }): {
    admin: SearchReportingAdmin;
    grains: string[][];
    dayChunks: unknown[][];
} {
    const grains: string[][] = [];
    const dayChunks: unknown[][] = [];
    const admin: SearchReportingAdmin = {
        from() {
            let grain: string[] = [];
            let chunk: readonly unknown[] = [];
            const api = {
                select() { return api; },
                eq() { return api; },
                gte() { return api; },
                lte() { return api; },
                in(column: string, values: readonly unknown[]) {
                    if (column === 'grain') grain = values.map(String);
                    if (column === 'day_id') chunk = values;
                    return api;
                },
                order() { return api; },
                async range() {
                    grains.push(grain);
                    dayChunks.push([...chunk]);
                    return handler(grain[0] ?? '', chunk);
                },
                async maybeSingle() { return { data: null, error: null }; },
            };
            return api;
        },
    };
    return { admin, grains, dayChunks };
}

test('day lists split into the chunk size and do not drop a remainder', () => {
    assert.deepEqual(chunkList(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
    assert.deepEqual(chunkList([], 7), []);
    assert.equal(LIGHT_DAY_CHUNK, 14);
    assert.equal(HEAVY_DAY_CHUNK, 7);
});

test('insights loads v1 grains without a device, and skips query rows when a device is selected', () => {
    assert.deepEqual(insightFactGrains(null), ['property', 'page', 'page_organic', 'property_device', 'page_device', 'query_page']);
    assert.equal(insightFactGrains('MOBILE').includes('query_page'), false);
    assert.equal(insightFactGrains('MOBILE').includes('page_device'), true);
    assert.equal(insightFactGrains(null).includes('property_country'), false);
});

test('each fact request filters one grain and a short day list', async () => {
    const { admin, grains, dayChunks } = adminFor(() => ({ data: [], error: null }));
    const loaded = await readGrainedFacts(admin, {
        dayIds: days(20),
        grains: ['property', 'page', 'query_page'],
        columns: 'day_id, grain, page',
    });
    assert.deepEqual(loaded.failedGrains, []);
    assert.equal(grains.every(values => values.length === 1), true);
    const propertyChunks = dayChunks.filter((_, index) => grains[index]?.[0] === 'property');
    const pageChunks = dayChunks.filter((_, index) => grains[index]?.[0] === 'page');
    const queryChunks = dayChunks.filter((_, index) => grains[index]?.[0] === 'query_page');
    assert.deepEqual(propertyChunks.map(chunk => chunk.length), [14, 6]);
    assert.deepEqual(pageChunks.map(chunk => chunk.length), [7, 7, 6]);
    assert.deepEqual(queryChunks.map(chunk => chunk.length), [7, 7, 6]);
    assert.equal(propertyChunks.flat().length, 20);
    assert.equal(pageChunks.flat().length, 20);
    assert.equal(queryChunks.flat().length, 20);
    assert.equal(grains.some(values => values.includes('property_device')), false);
});

test('a failed grain is dropped and the grains that succeeded are kept', async () => {
    const { admin } = adminFor((grain) => {
        if (grain === 'query_page') return { data: null, error: { message: 'canceling statement due to statement timeout' } };
        return { data: [{ day_id: 'day-1', grain: 'property', clicks: 2 }], error: null };
    });
    const loaded = await readGrainedFacts(admin, {
        dayIds: days(8),
        grains: ['property', 'query_page'],
        columns: 'day_id, grain, clicks',
    });
    assert.deepEqual(loaded.failedGrains, ['query_page']);
    assert.equal(loaded.rows.length, 1);
    assert.equal(loaded.rows[0]?.grain, 'property');
    assert.equal(JSON.stringify(loaded).includes('statement timeout'), false);
});

test('a chunk that never ends is treated as a failed grain, not a complete total', async () => {
    const { admin } = adminFor(() => ({ data: Array.from({ length: 1000 }, () => ({ day_id: 'day-1' })), error: null }));
    const loaded = await readGrainedFacts(admin, {
        dayIds: ['day-1'],
        grains: ['query_page'],
        columns: 'day_id',
        maxPages: 1,
    });
    assert.deepEqual(loaded.failedGrains, ['query_page']);
    assert.deepEqual(loaded.rows, []);
});
