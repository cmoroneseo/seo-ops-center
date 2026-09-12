import assert from 'node:assert/strict';
import test from 'node:test';

import {
    findExactIdentityCandidates,
    reasonCodesFor,
    resolveSitePageClaim,
    siteIdentityClaimState,
    sameSiteIdentityClaimState,
    validateIdentityReason,
} from './identity.ts';
import type { SiteIdentityPageEvidence } from '@/lib/types';

test('confirmed target state includes every edge decision and detects replacement along the same path', () => {
    const confirmed = siteIdentityClaimState('a', [
        { sourcePageId: 'a', targetPageId: 'b', decisionId: 'first' },
        { sourcePageId: 'b', targetPageId: 'c', decisionId: 'second' },
    ]);
    assert.deepEqual(confirmed, { path: ['a', 'b', 'c'], decisionIds: ['first', 'second'] });
    assert.equal(sameSiteIdentityClaimState(confirmed, { path: ['a', 'b', 'c'], decisionIds: ['replacement', 'second'] }), false);
    assert.equal(sameSiteIdentityClaimState(confirmed, { path: ['a', 'b', 'c'], decisionIds: ['first', 'second'] }), true);
    assert.equal(sameSiteIdentityClaimState(null, { path: ['a'], decisionIds: [] }), false);
    assert.throws(() => siteIdentityClaimState('a', [{ sourcePageId: 'a', targetPageId: 'b' }]), /decision/i);
});

function page(
    pageId: string,
    primaryUrl: string,
    title?: string,
): SiteIdentityPageEvidence {
    return {
        pageId,
        primaryUrl,
        title,
        redirectHops: [],
        discoverySources: ['sitemap'],
        limitationFlags: [],
    };
}

test('requires allowed reason codes and a note for other', () => {
    assert.equal(validateIdentityReason('claim_into', 'redirect_alias', ''), null);
    assert.match(validateIdentityReason('claim_into', 'distinct_intent', '') ?? '', /reason/i);
    assert.match(validateIdentityReason('reopen', 'other', '  ') ?? '', /note/i);
});

test('returns only the reason codes allowed for each decision kind', () => {
    assert.deepEqual(reasonCodesFor('claim_into'), [
        'redirect_alias',
        'canonical_alias',
        'protocol_or_host_variant',
        'duplicate_page',
        'historical_url',
        'other',
    ]);
    assert.deepEqual(reasonCodesFor('keep_separate'), [
        'distinct_intent',
        'distinct_location',
        'distinct_language',
        'intentional_variant',
        'different_content',
        'other',
    ]);
    assert.deepEqual(reasonCodesFor('needs_research'), [
        'content_purpose_unknown',
        'conflicting_signals',
        'target_unfetched',
        'ownership_unknown',
        'other',
    ]);
    assert.deepEqual(reasonCodesFor('reopen'), [
        'incorrect_decision',
        'new_evidence',
        'site_changed',
        'other',
    ]);
});

test('accepts a non-empty note when other is the reason', () => {
    assert.equal(validateIdentityReason('reopen', 'other', 'New circumstance observed'), null);
});

test('resolves a claim chain and rejects cycles', () => {
    const claims = [
        { sourcePageId: 'a', targetPageId: 'b' },
        { sourcePageId: 'b', targetPageId: 'c' },
    ];

    assert.deepEqual(resolveSitePageClaim('a', claims), {
        requestedPageId: 'a',
        resolvedPageId: 'c',
        path: ['a', 'b', 'c'],
        claimed: true,
    });
    assert.throws(
        () => resolveSitePageClaim('a', [...claims, { sourcePageId: 'c', targetPageId: 'a' }]),
        /cycle/i,
    );
});

test('returns an unclaimed root page without changing its identity', () => {
    assert.deepEqual(resolveSitePageClaim('root', []), {
        requestedPageId: 'root',
        resolvedPageId: 'root',
        path: ['root'],
        claimed: false,
    });
});

test('allows 32 claim edges and rejects the 33rd', () => {
    const claims = Array.from({ length: 33 }, (_, index) => ({
        sourcePageId: `page-${index}`,
        targetPageId: `page-${index + 1}`,
    }));

    assert.equal(resolveSitePageClaim('page-0', claims.slice(0, 32)).resolvedPageId, 'page-32');
    assert.throws(() => resolveSitePageClaim('page-0', claims), /depth/i);
});

test('enforces the hard 32-edge cap when a caller requests a higher maximum', () => {
    const claims = Array.from({ length: 33 }, (_, index) => ({
        sourcePageId: `page-${index}`,
        targetPageId: `page-${index + 1}`,
    }));

    assert.throws(() => resolveSitePageClaim('page-0', claims, 33), /depth/i);
    assert.throws(() => resolveSitePageClaim('page-0', claims.slice(0, 3), 2), /depth/i);
});

test('groups exact redirect and canonical matches while suppressing self matches', () => {
    const source = page('source', 'https://example.com/source');
    const target = page('target', 'https://example.com/target');
    const result = findExactIdentityCandidates({
        sourcePageId: source.pageId,
        redirectHops: [
            'HTTPS://EXAMPLE.COM:443/source#self',
            'https://example.com/target#redirect-fragment',
            'https://example.com/unseen#fragment',
        ],
        canonicalUrl: 'HTTPS://EXAMPLE.COM:443/target#canonical-fragment',
        sameClientUrlIndex: new Map([
            ['https://example.com/source', source],
            ['https://example.com/target', target],
        ]),
    });

    assert.deepEqual(result, {
        candidates: [{
            page: target,
            signals: [
                { kind: 'redirect', url: 'https://example.com/target', matchedPageId: 'target' },
                { kind: 'canonical', url: 'https://example.com/target', matchedPageId: 'target' },
            ],
        }],
        unmatchedSignals: [
            { kind: 'redirect', url: 'https://example.com/unseen' },
        ],
    });
});

test('does not infer identity from titles, trailing slashes, or query variants', () => {
    const sameTitle = 'Shared service title';
    const result = findExactIdentityCandidates({
        sourcePageId: 'source',
        redirectHops: [
            'https://example.com/service',
            'https://example.com/offers?b=2&a=1',
        ],
        canonicalUrl: 'https://example.com/service',
        sameClientUrlIndex: new Map([
            ['https://example.com/service/', page('slash-variant', 'https://example.com/service/', sameTitle)],
            ['https://example.com/offers?a=1&b=2', page('query-variant', 'https://example.com/offers?a=1&b=2', sameTitle)],
        ]),
    });

    assert.deepEqual(result.candidates, []);
    assert.deepEqual(result.unmatchedSignals, [
        { kind: 'redirect', url: 'https://example.com/service' },
        { kind: 'redirect', url: 'https://example.com/offers?b=2&a=1' },
        { kind: 'canonical', url: 'https://example.com/service' },
    ]);
});

test('queries the supplied normalized URL index without normalizing or collapsing its keys', () => {
    const normalizedTarget = page('normalized-target', 'https://example.com/target');
    const nonNormalizedShadow = page('shadow-target', 'HTTPS://EXAMPLE.COM:443/target#shadow');
    const result = findExactIdentityCandidates({
        sourcePageId: 'source',
        redirectHops: ['HTTPS://EXAMPLE.COM:443/target#signal'],
        sameClientUrlIndex: new Map([
            ['https://example.com/target', normalizedTarget],
            ['HTTPS://EXAMPLE.COM:443/target#shadow', nonNormalizedShadow],
        ]),
    });

    assert.deepEqual(result, {
        candidates: [{
            page: normalizedTarget,
            signals: [{
                kind: 'redirect',
                url: 'https://example.com/target',
                matchedPageId: 'normalized-target',
            }],
        }],
        unmatchedSignals: [],
    });
});
