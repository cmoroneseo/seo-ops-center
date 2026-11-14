import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GBP_POST_SCHEMA_VERSION,
    applySuggestion,
    clientVisibleChange,
    parseGbpPostPayload,
    visibleSnapshot,
} from './registry.ts';

const payload = {
    schemaVersion: GBP_POST_SCHEMA_VERSION,
    postType: 'offer' as const,
    title: 'Free Kitchen Walkthrough + Written Quote in 48 Hours',
    body: 'Once the leftovers are gone, tap below.',
    offerStart: '2026-11-23',
    offerEnd: '2026-12-31',
    scheduledDate: '2026-11-23',
    ctaUrl: 'https://allinone-const.com/contact/',
    ctaLabel: 'View offer',
    terms: 'Offer runs Nov 16 to Dec 31.',
};

test('a GBP post carries schema version 1 and rejects a bad calendar date', () => {
    const parsed = parseGbpPostPayload(payload);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.payload.schemaVersion, 1);
    assert.equal(parseGbpPostPayload({ ...payload, scheduledDate: '2026-02-31' }).ok, false);
    assert.equal(parseGbpPostPayload({ ...payload, schemaVersion: 2 }).ok, false);
    assert.equal(parseGbpPostPayload({ ...payload, ctaUrl: 'http://allinone-const.com/contact/' }).ok, false);
});

test('accepting a suggestion does not move the scheduled date', () => {
    const parsed = parseGbpPostPayload(payload);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const next = applySuggestion(parsed.payload, {
        body: 'Tap below to request your free walkthrough.',
    });
    assert.equal(next.scheduledDate, '2026-11-23');
    assert.equal(next.offerStart, '2026-11-23');
    assert.equal(next.body.includes('leftovers'), false);
    const before = visibleSnapshot(parsed.payload, 'https://allinone-const.com/photos/post.jpg');
    const after = visibleSnapshot(next, 'https://allinone-const.com/photos/post.jpg');
    assert.equal(clientVisibleChange(before, after), true);
    assert.equal(clientVisibleChange(before, before), false);
});
