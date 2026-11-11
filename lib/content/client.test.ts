import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { declineContentRecord } from './client.ts';

test('decline is sent to the content API, not written from the browser', async () => {
    const calls: { url: string; method?: string; body: unknown }[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
        return Response.json({ error: 'You can view this content, not change it.' }, { status: 403 });
    }) as typeof fetch;
    try {
        const result = await declineContentRecord({ clientId: 'client-1', recordId: 'record-1' });
        assert.equal(result.record, null);
        assert.equal(result.error, 'You can view this content, not change it.');
    } finally {
        globalThis.fetch = original;
    }
    assert.deepEqual(calls, [{
        url: '/api/content/records',
        method: 'PATCH',
        body: { clientId: 'client-1', recordId: 'record-1', productionStatus: 'declined' },
    }]);

    const panel = readFileSync(new URL('../../components/topical-map/RecordDetailPanel.tsx', import.meta.url), 'utf8');
    assert.match(panel, /declineContentRecord\(/);
    assert.equal(/\bdeclineRecord\b/.test(panel), false);
    const browserLib = readFileSync(new URL('../supabase/topical-map.ts', import.meta.url), 'utf8');
    assert.equal(/export async function declineRecord\b/.test(browserLib), false);
});
