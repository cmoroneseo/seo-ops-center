import test from 'node:test';
import assert from 'node:assert/strict';
import { isGa4EventName, readGa4KeyEvents, resolveGa4KeyEvents } from './key-events.ts';

test('conversions default to the property key events and an override is a subset', () => {
    assert.deepEqual(resolveGa4KeyEvents(['purchase', 'generate_lead'], null), ['purchase', 'generate_lead']);
    assert.deepEqual(resolveGa4KeyEvents(['purchase', 'generate_lead'], ['generate_lead', 'not_on_property']), ['generate_lead']);
    assert.equal(resolveGa4KeyEvents(['purchase'], []), null);
    assert.equal(resolveGa4KeyEvents([], null), null);
    assert.equal(isGa4EventName('purchase'), true);
    assert.equal(isGa4EventName('9bad'), false);
});

test('keyEvents.list follows the page token and logs only the status', async () => {
    const urls: string[] = [];
    const request: typeof fetch = async (input, init) => {
        const url = String(input);
        urls.push(url);
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer token-secret');
        if (!url.includes('pageToken=')) {
            return Response.json({
                keyEvents: [{ eventName: 'purchase' }, { eventName: 'not valid' }],
                nextPageToken: 'next',
            });
        }
        return Response.json({ keyEvents: [{ eventName: 'generate_lead' }] });
    };
    const events = await readGa4KeyEvents('token-secret', 'properties/9', request, () => { throw new Error('must not log success'); });
    assert.deepEqual(events.map(event => event.eventName), ['generate_lead', 'purchase']);
    assert.match(urls[0] ?? '', /properties\/9\/keyEvents/);
    assert.equal(urls.join('\n').includes('token-secret'), false);
    const logs: number[] = [];
    await assert.rejects(
        () => readGa4KeyEvents('token-secret', 'properties/9', async () => new Response('token-secret', { status: 403 }), status => logs.push(status)),
        (error: Error) => !error.message.includes('token-secret'),
    );
    assert.deepEqual(logs, [403]);
});
