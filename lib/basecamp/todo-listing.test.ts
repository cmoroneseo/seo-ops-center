import test from 'node:test';
import assert from 'node:assert/strict';
import { todoRequestUrls, mergeTodosById } from './api.ts';

/**
 * These guard a Basecamp API shape that produced a silent wrong answer.
 *
 * `todos.json` returns ONLY active to-dos. Completed ones come back ONLY from
 * `?completed=true`. The picker used to request the default response and then
 * filter it for completed work, which returned an empty set every time — the
 * code read as correct and no error was ever raised. A completed to-do
 * ("XERF landing page" in the Vitatherapy SEO list) simply never appeared.
 */

const BASE = 'https://3.basecampapi.com/1/buckets/2/todolists/3/todos.json';

test('including completed work requires a second, differently-parameterized request', () => {
    const urls = todoRequestUrls(BASE, true);
    assert.equal(urls.length, 2);
    assert.ok(urls.some(u => u === BASE), 'the active to-dos still need the default URL');
    assert.ok(urls.some(u => u.includes('completed=true')), 'completed to-dos need their own request');
});

test('excluding completed work asks only once', () => {
    assert.deepEqual(todoRequestUrls(BASE, false), [BASE]);
});

test('a to-do returned by both requests is kept once', () => {
    const merged = mergeTodosById([
        [{ id: 1, title: 'active' }],
        [{ id: 1, title: 'active' }, { id: 2, title: 'done' }],
    ]);
    assert.deepEqual(merged.map(t => t.id), [1, 2]);
});

test('merging preserves entries that appear in only one response', () => {
    const merged = mergeTodosById([[{ id: 7 }], [{ id: 8 }]]);
    assert.deepEqual(merged.map(t => t.id), [7, 8]);
});
