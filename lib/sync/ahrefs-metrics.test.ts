import test from 'node:test';
import assert from 'node:assert/strict';
import {
    AHREFS_ORGANIC_ROW_CAP,
    ahrefsNullableNumber,
    ahrefsOrganicRowCapEnabled,
    mapAhrefsDomainRating,
    mapAhrefsKeywordMetrics,
    organicKeywordCounts,
} from './ahrefs-metrics';

test('domain rating, volume, and keyword difficulty stay null', () => {
    assert.equal(mapAhrefsDomainRating({ domain_rating: { domain_rating: null } }), null);
    assert.equal(mapAhrefsDomainRating({ domain_rating: {} }), null);
    assert.equal(mapAhrefsDomainRating({ domain_rating: { domain_rating: '' } }), null);
    assert.equal(mapAhrefsDomainRating({ domain_rating: { domain_rating: '  ' } }), null);
    assert.equal(mapAhrefsDomainRating(null), null);

    const missing = mapAhrefsKeywordMetrics({ keyword: 'seo', volume: null, keyword_difficulty: null });
    assert.equal(missing.volume, null);
    assert.equal(missing.keywordDifficulty, null);
    const omitted = mapAhrefsKeywordMetrics({ keyword: 'seo' });
    assert.equal(omitted.volume, null);
    assert.equal(omitted.keywordDifficulty, null);
    assert.deepEqual(mapAhrefsKeywordMetrics(null), { volume: null, keywordDifficulty: null });
});

test('a real zero stays zero for domain rating, volume, and keyword difficulty', () => {
    assert.equal(mapAhrefsDomainRating({ domain_rating: { domain_rating: 0 } }), 0);
    assert.equal(mapAhrefsDomainRating({ domain_rating: { domain_rating: 13.4 } }), 13);
    const row = mapAhrefsKeywordMetrics({ volume: 0, keyword_difficulty: 0 });
    assert.equal(row.volume, 0);
    assert.equal(row.keywordDifficulty, 0);
    assert.equal(ahrefsNullableNumber('0'), 0);
    assert.equal(ahrefsNullableNumber(''), null);
    assert.equal(ahrefsNullableNumber('nope'), null);
});

test('the organic row cap is off unless AHREFS_ORGANIC_ROW_CAP is exactly true', () => {
    assert.equal(ahrefsOrganicRowCapEnabled({}), false);
    assert.equal(ahrefsOrganicRowCapEnabled({ AHREFS_ORGANIC_ROW_CAP: '' }), false);
    assert.equal(ahrefsOrganicRowCapEnabled({ AHREFS_ORGANIC_ROW_CAP: 'false' }), false);
    assert.equal(ahrefsOrganicRowCapEnabled({ AHREFS_ORGANIC_ROW_CAP: 'true' }), true);
    assert.equal(AHREFS_ORGANIC_ROW_CAP, 1000);
});

test('a full 1,000-row page is not stored as a complete census unless the cap flag is on', () => {
    const page = Array.from({ length: AHREFS_ORGANIC_ROW_CAP }, () => ({ best_position: 4 }));
    assert.deepEqual(organicKeywordCounts(page, false), {
        ranked_keywords: null,
        top_10_keywords: null,
        top_20_keywords: null,
        top_50_keywords: null,
    });
    assert.equal(organicKeywordCounts(page, true).ranked_keywords, 1000);
    assert.equal(organicKeywordCounts(page, true).top_10_keywords, 1000);
    assert.deepEqual(organicKeywordCounts([{ best_position: null, best_position_prev: 8 }], false), {
        ranked_keywords: 1,
        top_10_keywords: 1,
        top_20_keywords: 1,
        top_50_keywords: 1,
    });
    assert.equal(organicKeywordCounts([{ best_position: null, best_position_prev: null }], false).top_10_keywords, 0);
});
