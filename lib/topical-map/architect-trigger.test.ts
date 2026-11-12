import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { resetArchitectTriggerForTests, triggerArchitectOnce, type ArchitectFetch } from './architect-trigger.ts';

// Mock fetch only. Nothing here reaches the generate route or Anthropic.
function deferredFetch() {
    const calls: { input: string; body: unknown }[] = [];
    let settle: ((res: Response | Error) => void) | null = null;
    const fetchImpl: ArchitectFetch = (input, init) => {
        calls.push({ input, body: JSON.parse(String(init.body)) });
        return new Promise<Response>((resolve, reject) => {
            settle = value => (value instanceof Error ? reject(value) : resolve(value));
        });
    };
    return { calls, fetchImpl, settle: (value: Response | Error) => settle?.(value) };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
    resetArchitectTriggerForTests();
});

test('a second poll while the first generate is running does not fire again', () => {
    const mock = deferredFetch();
    assert.equal(triggerArchitectOnce('map-1', mock.fetchImpl), true);
    assert.equal(triggerArchitectOnce('map-1', mock.fetchImpl), false);
    assert.equal(triggerArchitectOnce('map-1', mock.fetchImpl), false);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0]?.input, '/api/topical-map/generate-architect');
    assert.deepEqual(mock.calls[0]?.body, { mapId: 'map-1' });
});

test('another map is not blocked by a run in flight', () => {
    const mock = deferredFetch();
    triggerArchitectOnce('map-1', mock.fetchImpl);
    assert.equal(triggerArchitectOnce('map-2', mock.fetchImpl), true);
    assert.equal(mock.calls.length, 2);
});

test('after success the map is never re-sent', async () => {
    const mock = deferredFetch();
    triggerArchitectOnce('map-1', mock.fetchImpl);
    mock.settle(new Response('{}', { status: 200 }));
    await flush();
    assert.equal(triggerArchitectOnce('map-1', mock.fetchImpl), false);
    assert.equal(mock.calls.length, 1);
});

test('a network error keeps the guard because the server may still be running', async () => {
    const mock = deferredFetch();
    triggerArchitectOnce('map-1', mock.fetchImpl);
    mock.settle(new TypeError('network down'));
    await flush();
    assert.equal(triggerArchitectOnce('map-1', mock.fetchImpl), false);
    assert.equal(mock.calls.length, 1);
});

test('409 (already done) keeps the guard; a failed run can be retried', async (t) => {
    t.mock.method(console, 'error', () => {});
    const done = deferredFetch();
    triggerArchitectOnce('map-1', done.fetchImpl);
    done.settle(new Response('{"error":"done"}', { status: 409 }));
    await flush();
    assert.equal(triggerArchitectOnce('map-1', done.fetchImpl), false);

    const failed = deferredFetch();
    triggerArchitectOnce('map-2', failed.fetchImpl);
    failed.settle(new Response('{"error":"boom"}', { status: 500 }));
    await flush();
    assert.equal(triggerArchitectOnce('map-2', failed.fetchImpl), true);
    assert.equal(failed.calls.length, 2);
});
