import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { TopicalMapRecord } from '../types.ts';
import {
    advanceBaseline,
    changedSpecPatch,
    createSerialQueue,
    dateFieldPatch,
    mergeSpecSave,
    specBaseline,
    specSaveLabel,
    textFieldPatch,
    wordRangePatch,
} from './spec-save.ts';

function record(overrides: Partial<TopicalMapRecord> = {}): TopicalMapRecord {
    return {
        id: 'r-1', siloId: 's-1', mapId: 'm-1', organizationId: 'o-1',
        pageType: 'blog_post', action: 'create', title: 'Local SEO Services',
        targetQuery: 'local seo services', wordCountMin: 0, wordCountMax: 0, buildPhase: 1,
        scopeExclusions: [], outgoingLinks: [], status: 'pending', sortOrder: 0,
        createdAt: '', updatedAt: '',
        ...overrides,
    };
}

test('a keystroke does not schedule a write, and blur writes the field value', () => {
    assert.equal(textFieldPatch('change', 'uniqueAngle', 'A vertical, not a calculator.', null), null);
    assert.equal(textFieldPatch('blur', 'uniqueAngle', 'A vertical, not a calculator.', null)?.uniqueAngle, 'A vertical, not a calculator.');
    assert.equal(textFieldPatch('close', 'uniqueAngle', 'A vertical, not a calculator.', 'A vertical, not a calculator.'), null);
    assert.equal(textFieldPatch('blur', 'answerFirst60', 'Same answer', 'Same answer'), null);
});

test('a date is saved from the input on change and on blur, and an unchanged blur is skipped', () => {
    assert.deepEqual(dateFieldPatch('2026-10-20', null), { ok: true, patch: { scheduledFor: '2026-10-20' } });
    assert.deepEqual(dateFieldPatch('2026-10-20', '2026-10-20'), { ok: true, patch: null });
    assert.deepEqual(dateFieldPatch('', '2026-10-20'), { ok: true, patch: { scheduledFor: null } });
    assert.equal(dateFieldPatch('2026-13-40', null).ok, false);
});

test('a status save does not wipe an angle typed while that save is in flight', () => {
    const local = record({ uniqueAngle: 'A vertical, not a calculator.', specStatus: 'ready' });
    const server = record({ specStatus: 'ready', updatedAt: '2026-10-12T00:00:01.000Z' });
    const merged = mergeSpecSave(
        local,
        server,
        { specStatus: 'ready' },
        { specStatus: 1 },
        { specStatus: 1, uniqueAngle: 2 },
    );
    assert.equal(merged.uniqueAngle, 'A vertical, not a calculator.');
    assert.equal(merged.specStatus, 'ready');

    const saved = advanceBaseline(specBaseline(record()), merged, { specStatus: 'ready' }, { specStatus: 1 }, { specStatus: 1, uniqueAngle: 2 });
    assert.deepEqual(changedSpecPatch(specBaseline(merged), saved), { uniqueAngle: 'A vertical, not a calculator.' });
});

test('an older angle response does not replace a newer edit', () => {
    const local = record({ uniqueAngle: 'Newer angle' });
    const server = record({ uniqueAngle: 'Older angle', updatedAt: 'later' });
    const merged = mergeSpecSave(local, server, { uniqueAngle: 'Older angle' }, { uniqueAngle: 1 }, { uniqueAngle: 2 });
    assert.equal(merged.uniqueAngle, 'Newer angle');
    assert.equal(merged.updatedAt, 'later');
});

test('a matching angle response is stored and then treated as saved', () => {
    const angle = 'A vertical, not a calculator.';
    const local = record({ uniqueAngle: angle });
    const server = record({ uniqueAngle: angle, updatedAt: 'saved' });
    const merged = mergeSpecSave(local, server, { uniqueAngle: angle }, { uniqueAngle: 1 }, { uniqueAngle: 1 });
    const saved = advanceBaseline(specBaseline(record()), merged, { uniqueAngle: angle }, { uniqueAngle: 1 }, { uniqueAngle: 1 });
    assert.equal(merged.uniqueAngle, angle);
    assert.equal(changedSpecPatch(specBaseline(merged), saved), null);
});

test('word range and save label stay quiet until a real change is flushed', () => {
    assert.deepEqual(wordRangePatch('', ''), { wordCountMin: null, wordCountMax: null });
    assert.equal(changedSpecPatch(wordRangePatch('', ''), specBaseline(record())), null);
    assert.equal(specSaveLabel('idle'), '');
    assert.equal(specSaveLabel('saving'), 'Saving…');
    assert.equal(specSaveLabel('saved'), 'Saved');
    assert.equal(specSaveLabel('error'), '');
});

test('spec writes run one at a time and in the order they were asked', async () => {
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const enqueue = createSerialQueue();
    const first = enqueue(async () => {
        order.push('start-a');
        await gate;
        order.push('end-a');
        return 'a';
    });
    const second = enqueue(async () => {
        order.push('b');
        return 'b';
    });
    await Promise.resolve();
    assert.deepEqual(order, ['start-a']);
    release();
    assert.equal(await first, 'a');
    assert.equal(await second, 'b');
    assert.deepEqual(order, ['start-a', 'end-a', 'b']);
});

test('the drawer flushes on close and does not write text on each keystroke', () => {
    const panel = readFileSync(new URL('../../components/topical-map/RecordDetailPanel.tsx', import.meta.url), 'utf8');
    const section = readFileSync(new URL('../../components/topical-map/SpecSection.tsx', import.meta.url), 'utf8');
    assert.match(panel, /flushPending/);
    assert.match(panel, /changedSpecPatch/);
    assert.match(section, /commitText\('change', 'uniqueAngle'/);
    assert.match(section, /commitText\('blur', 'uniqueAngle'/);
    assert.match(section, /commitText\('change', 'answerFirst60'/);
    assert.match(section, /commitDate\(event\.target\.value\)/);
    assert.match(section, /commitDate\(event\.currentTarget\.value\)/);
    assert.equal(section.includes('onChange={event => onDraft({ uniqueAngle'), false);
});
