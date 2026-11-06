import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeMapStats, computeSiloStats } from './stats.ts';
import type { TopicalMapRecord } from '../types.ts';

const makeRecord = (overrides: Partial<TopicalMapRecord>): TopicalMapRecord => ({
    id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
    pageType: 'service', action: 'create', title: 'Test', targetQuery: 'test',
    wordCountMin: 500, wordCountMax: 1000, buildPhase: 1,
    scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0,
    createdAt: '', updatedAt: '',
    ...overrides,
});

describe('computeMapStats', () => {
    it('counts records and leaves AI volume out of demand', () => {
        const records = [
            makeRecord({ searchVolumeMonthly: 1000, keywordDifficulty: 40 }),
            makeRecord({ id: 'r-2', searchVolumeMonthly: 2000, sitePageId: 'sp-1' }),
        ];
        const stats = computeMapStats(records);
        assert.equal(stats.totalRecords, 2);
        assert.equal(stats.totalDemand, 0);
        assert.equal(stats.existingCount, 1);
    });

    it('counts outgoing links', () => {
        const records = [
            makeRecord({ outgoingLinks: [{ anchorText: 'a', destinationUrl: '/b' }, { anchorText: 'c', destinationUrl: '/d' }] }),
            makeRecord({ id: 'r-2', outgoingLinks: [{ anchorText: 'e', destinationUrl: '/f' }] }),
        ];
        assert.equal(computeMapStats(records).plannedLinks, 3);
    });
});

describe('approval counts with a spec', () => {
    it('still counts approved and declined records that carry spec fields', () => {
        const records = [
            makeRecord({
                status: 'approved',
                source: 'manual',
                answerFirst60: 'Short answer.',
                specStatus: 'ready',
                scheduledFor: '2026-10-12',
            }),
            makeRecord({ id: 'r-2', status: 'declined', source: 'generated' }),
        ];
        const stats = computeMapStats(records);
        assert.equal(stats.approvedCount, 1);
        assert.equal(stats.declinedCount, 1);
        assert.equal(stats.totalRecords, 2);
    });
});

describe('AI volume is excluded from demand', () => {
    it('does not add AI monthly volume to map or silo demand', () => {
        const records = [
            makeRecord({ searchVolumeMonthly: 1000, keywordDifficulty: 22 }),
            makeRecord({ id: 'r-2', searchVolumeMonthly: 2000 }),
            makeRecord({ id: 'r-3', siloId: 's-2', searchVolumeMonthly: 9000 }),
            makeRecord({ id: 'r-4', siloId: 's-2' }),
        ];
        assert.equal(computeMapStats(records).totalDemand, 0);
        assert.equal(computeSiloStats(records, 's-1').totalDemand, 0);
        assert.equal(computeSiloStats(records, 's-1').totalRecords, 2);
        assert.equal(computeSiloStats(records, 's-2').totalDemand, 0);
        assert.equal(computeSiloStats(records, 's-2').totalRecords, 2);
    });
});

describe('computeSiloStats', () => {
    it('groups by page type', () => {
        const records = [
            makeRecord({ siloId: 's-1', pageType: 'pillar' }),
            makeRecord({ id: 'r-2', siloId: 's-1', pageType: 'blog_post' }),
            makeRecord({ id: 'r-3', siloId: 's-1', pageType: 'blog_post' }),
            makeRecord({ id: 'r-4', siloId: 's-2', pageType: 'service' }),
        ];
        const stats = computeSiloStats(records, 's-1');
        assert.equal(stats.totalRecords, 3);
        assert.deepEqual(stats.byPageType, { pillar: 1, blog_post: 2 });
    });
});
