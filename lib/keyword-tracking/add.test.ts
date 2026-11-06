/**
 * Run with: node --import tsx --test lib/keyword-tracking/add.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { keywordTrackingEnabled } from './flag.ts';
import {
    DEFAULT_TRACKED_KEYWORD_CAP,
    GSC_ALL_TARGET_LABEL,
    describeKeywordAdd,
    gscTargetInsert,
    keywordsChangedNote,
    keywordsChangedNoteInsert,
    planKeywordAdds,
    splitKeywordPaste,
    trackedKeywordCap,
    trackedKeywordInsert,
    type ExistingTrackedKeyword,
} from './plan.ts';
import { addTrackedKeywords, applyKeywordAdds, type KeywordTrackingStore } from './store.ts';

const scope = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    clientId: '33333333-3333-4333-8333-333333333333',
};

function existing(count: number, active = true): ExistingTrackedKeyword[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `existing-${index}`,
        normalizedKey: `keyword ${index}`,
        active,
    }));
}

test('paste splits lines, and a single comma-separated line', () => {
    assert.deepEqual(splitKeywordPaste(' SEO Agency \nseo   agency\r\n\nLocal SEO '), [
        'SEO Agency',
        'seo   agency',
        'Local SEO',
    ]);
    assert.deepEqual(splitKeywordPaste('plumber, hvac, roofer'), ['plumber', 'hvac', 'roofer']);
    assert.deepEqual(splitKeywordPaste('seo, local agency\nplumber'), ['seo, local agency', 'plumber']);
});

test('dedupes on the normalized key and keeps the first spelling', () => {
    const plan = planKeywordAdds({
        entries: [' SEO Agency ', 'seo   agency', 'SEO Agency', 'Local SEO'],
        existing: [],
        hasLiveGscTarget: false,
    });
    assert.deepEqual(plan.insert.map(row => row.keyword), ['SEO Agency', 'Local SEO']);
    assert.deepEqual(plan.insert.map(row => row.normalizedKey), ['seo agency', 'local seo']);
    assert.equal(plan.duplicateCount, 2);
    assert.equal(plan.alreadyTracked.length, 0);
    assert.equal(plan.rejectedByCap.length, 0);
});

test('an active keyword is already tracked and does not consume another slot', () => {
    const plan = planKeywordAdds({
        entries: ['SEO Agency', 'New Keyword'],
        existing: [{ id: 'row-1', normalizedKey: 'seo agency', active: true }],
        hasLiveGscTarget: true,
        cap: 2,
    });
    assert.equal(plan.insert.length, 1);
    assert.equal(plan.insert[0].normalizedKey, 'new keyword');
    assert.equal(plan.alreadyTracked.length, 1);
    assert.equal(plan.rejectedByCap.length, 0);
    assert.equal(plan.seedGscTarget, false);
});

test('reactivates an inactive keyword inside the cap', () => {
    const plan = planKeywordAdds({
        entries: ['SEO Agency'],
        existing: [{ id: 'row-1', normalizedKey: 'seo agency', active: false }],
        hasLiveGscTarget: true,
        cap: 50,
    });
    assert.equal(plan.insert.length, 0);
    assert.equal(plan.reactivate.length, 1);
    assert.equal(plan.reactivate[0].id, 'row-1');
    assert.equal(plan.seedGscTarget, false);
});

test('rejects new keywords when the client is at the cap', () => {
    const plan = planKeywordAdds({
        entries: ['Brand new', 'Also new'],
        existing: existing(50),
        hasLiveGscTarget: false,
        cap: 50,
    });
    assert.equal(plan.activeCount, 50);
    assert.equal(plan.insert.length, 0);
    assert.equal(plan.reactivate.length, 0);
    assert.equal(plan.rejectedByCap.length, 2);
    assert.equal(plan.seedGscTarget, false);
    assert.match(describeKeywordAdd(plan), /at the 50 keyword cap/);
});

test('fills the remaining room and rejects the rest', () => {
    const plan = planKeywordAdds({
        entries: ['One', 'Two', 'Three'],
        existing: existing(49),
        hasLiveGscTarget: true,
        cap: 50,
    });
    assert.equal(plan.insert.length, 1);
    assert.equal(plan.insert[0].normalizedKey, 'one');
    assert.deepEqual(plan.rejectedByCap.map(row => row.normalizedKey), ['two', 'three']);
});

test('an inactive keyword at the cap is rejected instead of reactivated', () => {
    const plan = planKeywordAdds({
        entries: ['Paused'],
        existing: [
            ...existing(50),
            { id: 'paused', normalizedKey: 'paused', active: false },
        ],
        hasLiveGscTarget: true,
        cap: 50,
    });
    assert.equal(plan.reactivate.length, 0);
    assert.equal(plan.rejectedByCap.length, 1);
});

test('the first keyword to insert seeds the live GSC target', () => {
    const plan = planKeywordAdds({
        entries: ['plumber riverside'],
        existing: [],
        hasLiveGscTarget: false,
    });
    assert.equal(plan.seedGscTarget, true);
    assert.equal(plan.insert.length, 1);
    const row = gscTargetInsert(scope);
    assert.equal(row.label, GSC_ALL_TARGET_LABEL);
    assert.equal(row.label, 'GSC (all locations/devices)');
    assert.equal(row.engine, 'gsc');
    assert.equal('device' in row, false);
    assert.equal('location_name' in row, false);
    assert.equal('language_code' in row, false);
});

test('a later add does not seed when a live GSC target already exists', () => {
    const plan = planKeywordAdds({
        entries: ['second keyword'],
        existing: [{ id: 'row-1', normalizedKey: 'first', active: true }],
        hasLiveGscTarget: true,
    });
    assert.equal(plan.seedGscTarget, false);
});

test('the per-client cap defaults to 50', () => {
    assert.equal(DEFAULT_TRACKED_KEYWORD_CAP, 50);
    assert.equal(trackedKeywordCap(), 50);
    const plan = planKeywordAdds({
        entries: ['one more'],
        existing: existing(50),
        hasLiveGscTarget: true,
    });
    assert.equal(plan.cap, 50);
    assert.equal(plan.rejectedByCap.length, 1);
    assert.equal(plan.seedGscTarget, false);
});

test('the auto note uses keywords_changed and lists what changed', () => {
    const body = keywordsChangedNote(['SEO Agency', 'Local SEO']);
    assert.match(body, /^Tracked 2 keywords: SEO Agency, Local SEO\.$/);
    const row = keywordsChangedNoteInsert(scope, 'target-1', body, 'user-1');
    assert.equal(row.kind, 'keywords_changed');
    assert.equal(row.target_id, 'target-1');
    assert.equal(row.created_by, 'user-1');
    const keyword = trackedKeywordInsert(
        scope,
        'target-1',
        { keyword: 'SEO Agency', normalizedKey: 'seo agency' },
        'gsc_promote',
    );
    assert.equal(keyword.source, 'gsc_promote');
    assert.equal(keyword.target_id, 'target-1');
    assert.equal('normalized_key' in keyword, false);
});

function memoryStore(seed?: { keywords?: ExistingTrackedKeyword[]; targetId?: string | null }) {
    const calls = {
        targets: 0,
        keywords: [] as string[],
        notes: [] as string[],
        reactivated: [] as string[],
    };
    let targetId = seed?.targetId ?? null;
    const keywords = [...(seed?.keywords ?? [])];
    const store: KeywordTrackingStore = {
        async listKeywords() {
            return keywords;
        },
        async findLiveGscTarget() {
            return targetId;
        },
        async insertGscTarget() {
            calls.targets += 1;
            targetId = 'gsc-target';
            return targetId;
        },
        async insertKeywords(_scope, id, rows) {
            for (const row of rows) {
                calls.keywords.push(`${id}:${row.normalizedKey}`);
                keywords.push({ id: row.normalizedKey, normalizedKey: row.normalizedKey, active: true });
            }
        },
        async reactivateKeywords(_scope, ids) {
            calls.reactivated.push(...ids);
            for (const row of keywords) {
                if (ids.includes(row.id)) row.active = true;
            }
        },
        async insertNote(_scope, _targetId, body) {
            calls.notes.push(body);
        },
    };
    return { store, calls };
}

test('the first track writes the GSC target, the keyword, and one note', async () => {
    const { store, calls } = memoryStore();
    const result = await applyKeywordAdds(store, {
        scope,
        entries: splitKeywordPaste('SEO Agency\nseo   agency\nLocal SEO'),
        source: 'paste',
    });
    assert.equal(result.wrote, true);
    assert.equal(result.plan.seedGscTarget, true);
    assert.equal(calls.targets, 1);
    assert.deepEqual(calls.keywords, ['gsc-target:seo agency', 'gsc-target:local seo']);
    assert.equal(calls.notes.length, 1);
    assert.match(calls.notes[0], /SEO Agency, Local SEO/);

    const again = await applyKeywordAdds(store, {
        scope,
        entries: ['seo agency'],
        source: 'gsc_promote',
    });
    assert.equal(again.wrote, false);
    assert.equal(again.plan.alreadyTracked.length, 1);
    assert.equal(calls.targets, 1);
    assert.equal(calls.keywords.length, 2);
    assert.equal(calls.notes.length, 1);
});

test('at the cap, nothing is inserted and no target or note is written', async () => {
    const { store, calls } = memoryStore({ keywords: existing(50), targetId: 'gsc-target' });
    const result = await applyKeywordAdds(store, {
        scope,
        entries: ['fresh keyword'],
        source: 'paste',
        cap: 50,
    });
    assert.equal(result.wrote, false);
    assert.equal(result.plan.rejectedByCap.length, 1);
    assert.equal(result.plan.seedGscTarget, false);
    assert.equal(calls.targets, 0);
    assert.equal(calls.keywords.length, 0);
    assert.equal(calls.notes.length, 0);
});

test('flag off does not touch the keyword store', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    let called = false;
    const store: KeywordTrackingStore = {
        async listKeywords() { called = true; return []; },
        async findLiveGscTarget() { called = true; return null; },
        async insertGscTarget() { called = true; return 'nope'; },
        async insertKeywords() { called = true; },
        async reactivateKeywords() { called = true; },
        async insertNote() { called = true; },
    };
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        assert.equal(keywordTrackingEnabled(), false);
        const result = await addTrackedKeywords({
            ...scope,
            entries: ['plumber'],
            source: 'gsc_promote',
            store,
        });
        assert.equal(result.ok, false);
        assert.equal(result.wrote, false);
        assert.equal(result.message, 'Keyword tracking is off.');
        assert.equal(called, false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
