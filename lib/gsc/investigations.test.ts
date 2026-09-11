import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildInvestigationSnapshot,
    investigationLookupKey,
    normalizeInvestigationUrl,
    taskPrefillForInvestigation,
} from './investigations.ts';

test('near-page-one and deeper evidence share one query/page identity', () => {
    const near = investigationLookupKey({
        kind: 'query_page',
        query: ' Hardscape   Contractor ',
        page: 'HTTPS://WWW.ECOWORKZ.NET:443/corona-ca/#services',
    });
    const deeper = investigationLookupKey({
        kind: 'query_page',
        query: 'hardscape contractor',
        page: 'https://www.ecoworkz.net/corona-ca/',
    });

    assert.equal(near, deeper);
});

test('overlap identity ignores the changing retained URL set', () => {
    assert.equal(
        investigationLookupKey({ kind: 'overlap', query: 'backyard remodel orange county' }),
        investigationLookupKey({ kind: 'overlap', query: ' Backyard  Remodel Orange County ' }),
    );
});

test('page identity removes fragments but preserves meaningful query strings', () => {
    assert.equal(
        normalizeInvestigationUrl('https://Example.com:443/path#section'),
        'https://example.com/path',
    );
    assert.notEqual(
        investigationLookupKey({ kind: 'page', page: 'https://example.com/path?a=1' }),
        investigationLookupKey({ kind: 'page', page: 'https://example.com/path?a=2' }),
    );
});

test('snapshot records displayed evidence and names its limits', () => {
    const snapshot = buildInvestigationSnapshot({
        category: 'deeper_visibility',
        property: 'sc-domain:ecoworkz.net',
        start: '2026-09-01',
        end: '2026-09-07',
        evidence: {
            query: 'hardscape contractor',
            page: 'https://www.ecoworkz.net/corona-ca/',
            clicks: 0,
            impressions: 237,
            ctr: 0,
            position: 33,
            observedDays: 7,
        },
    });

    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.impressions, 237);
    assert.match(snapshot.limitations.join(' '), /not proof/i);
});

test('task prefill stays observational and includes the evidence window', () => {
    const snapshot = buildInvestigationSnapshot({
        category: 'deeper_visibility',
        property: 'sc-domain:ecoworkz.net',
        start: '2026-09-01',
        end: '2026-09-07',
        evidence: {
            query: 'hardscape contractor',
            page: 'https://www.ecoworkz.net/corona-ca/',
            clicks: 0,
            impressions: 237,
            ctr: 0,
            position: 33,
            observedDays: 7,
        },
    });

    const prefill = taskPrefillForInvestigation(snapshot, 'Ecoworkz');

    assert.equal(prefill.category, 'strategy');
    assert.match(prefill.title, /hardscape contractor/i);
    assert.match(prefill.description, /No ranking gain is predicted/);
    assert.match(prefill.description, /2026-09-01 to 2026-09-07/);
});

test('invalid or incomplete evidence is rejected before persistence', () => {
    assert.throws(() => buildInvestigationSnapshot({
        category: 'page_visibility',
        property: 'sc-domain:ecoworkz.net',
        start: '2026-09-07',
        end: '2026-09-01',
        evidence: {
            page: 'javascript:alert(1)',
            clicks: 0,
            impressions: 0,
            ctr: 0,
            position: 33,
            observedDays: 0,
        },
    }), /evidence/i);
});

test('overlap evidence requires at least two retained pages', () => {
    assert.throws(() => buildInvestigationSnapshot({
        category: 'overlapping_urls',
        property: 'sc-domain:ecoworkz.net',
        start: '2026-09-01',
        end: '2026-09-07',
        evidence: {
            query: 'backyard remodel',
            clicks: 0,
            impressions: 120,
            ctr: 0,
            position: 18,
            observedDays: 4,
            pages: [{
                query: 'backyard remodel',
                page: 'https://www.ecoworkz.net/remodel/',
                clicks: 0,
                impressions: 120,
                ctr: 0,
                position: 18,
                observedDays: 4,
            }],
        },
    }), /two retained pages/i);
});
