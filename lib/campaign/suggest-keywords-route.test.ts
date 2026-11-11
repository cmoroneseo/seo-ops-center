import test from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestKeywordsHandler } from './suggest-keywords-route';

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';

function post(body: unknown): Request {
    return new Request('https://app.test/api/campaign/suggest-keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function handler(onComplete: () => void, signedIn = true) {
    return createSuggestKeywordsHandler({
        requireClientOrgMember: async (clientId) => {
            if (!signedIn) return { ok: false, status: 401, error: 'Unauthorized' };
            return clientId === client
                ? { ok: true, userId: 'user', organizationId: org, clientId: client, role: 'member' }
                : { ok: false, status: 403, error: 'Forbidden' };
        },
        complete: async () => {
            onComplete();
            return '```json\n[{"keyword":"emergency plumber"}]\n```';
        },
    });
}

test('a signed-out caller never reaches the model', async () => {
    let called = false;
    const response = await handler(() => { called = true; }, false).POST(post({ clientId: client, clientName: 'Northside' }));
    assert.equal(response.status, 401);
    assert.equal(called, false);
});

test('a client in another organization, or no client at all, never reaches the model', async () => {
    let called = false;
    const api = handler(() => { called = true; });
    assert.equal((await api.POST(post({ clientId: foreign }))).status, 403);
    assert.equal((await api.POST(post({ clientName: 'No client id' }))).status, 403);
    assert.equal(called, false);
});

test('a member of the client organization gets keyword ideas', async () => {
    let called = false;
    const response = await handler(() => { called = true; }).POST(post({ clientId: client, clientName: 'Northside' }));
    assert.equal(response.status, 200);
    assert.equal(called, true);
    assert.deepEqual((await response.json()).keywords, [{ keyword: 'emergency plumber' }]);
});

test('a missing API key is reported only after the caller is authorized', async () => {
    const api = createSuggestKeywordsHandler({
        requireClientOrgMember: async () => ({ ok: false, status: 401, error: 'Unauthorized' }),
        complete: null,
    });
    assert.equal((await api.POST(post({ clientId: client }))).status, 401);
});
