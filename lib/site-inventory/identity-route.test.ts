import assert from 'node:assert/strict';
import test from 'node:test';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SiteIdentityError } from '../supabase/site-identity.ts';
import {
    createSiteIdentityHandlers,
    type SiteIdentityRouteDependencies,
} from './identity-route.ts';

const IDS = {
    client: '11111111-1111-4111-8111-111111111111',
    canonicalClient: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    source: '22222222-2222-4222-8222-222222222222',
    target: '33333333-3333-4333-8333-333333333333',
    sourceSnapshot: '44444444-4444-4444-8444-444444444444',
    targetSnapshot: '55555555-5555-4555-8555-555555555555',
    organization: '66666666-6666-4666-8666-666666666666',
    user: '77777777-7777-4777-8777-777777777777',
} as const;

type Calls = {
    authorizedClientIds: unknown[];
    adminCount: number;
    reads: unknown[][];
    writes: unknown[];
};

const authorized = (role: 'owner' | 'admin' | 'member' | 'viewer' = 'member') => ({
    ok: true as const,
    userId: IDS.user,
    actorName: 'Reviewer',
    organizationId: IDS.organization,
    clientId: IDS.canonicalClient,
    role,
});

function setup(overrides: Partial<SiteIdentityRouteDependencies> = {}) {
    const calls: Calls = { authorizedClientIds: [], adminCount: 0, reads: [], writes: [] };
    const admin = { boundary: 'admin' } as unknown as SupabaseClient;
    const dependencies: SiteIdentityRouteDependencies = {
        async getActiveClaims(...args) { calls.reads.push(args); return { claims: [] }; },
        async authorize(clientId) {
            calls.authorizedClientIds.push(clientId);
            return authorized();
        },
        createAdmin() {
            calls.adminCount += 1;
            return admin;
        },
        async getReview(...args) {
            calls.reads.push(args);
            return {
                source: { pageId: IDS.source, primaryUrl: 'https://example.com/source', redirectHops: [], discoverySources: [], limitationFlags: [] },
                candidates: [],
                unmatchedSignals: [],
                resolution: { requestedPageId: IDS.source, resolvedPageId: IDS.source, path: [IDS.source], claimed: false },
                decisions: [],
            };
        },
        async setDecision(_admin, input) {
            calls.writes.push(input);
            return {
                id: '88888888-8888-4888-8888-888888888888',
                sourcePageId: input.sourcePageId,
                ...(input.targetPageId ? { targetPageId: input.targetPageId } : {}),
                decisionKind: input.decisionKind,
                reasonCode: input.reasonCode,
                ...(input.note ? { note: input.note } : {}),
                createdBy: input.createdBy,
                createdAt: '2026-09-11T12:00:00.000Z',
            };
        },
        ...overrides,
    };
    return { handlers: createSiteIdentityHandlers(dependencies), calls, admin };
}

function getRequest(query = `clientId=${IDS.client}&pageId=${IDS.source}`) {
    return new Request(`https://app.test/api/site-inventory/identity?${query}`);
}

function decisionRequest(body: unknown) {
    return new Request('https://app.test/api/site-inventory/identity/decisions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const claimBody = {
    clientId: IDS.client,
    pageId: IDS.source,
    targetPageId: IDS.target,
    decisionKind: 'claim_into',
    reasonCode: 'redirect_alias',
    note: '  Reviewed redirect evidence.  ',
    expectedSourceSnapshotId: IDS.sourceSnapshot,
    expectedTargetSnapshotId: IDS.targetSnapshot,
    expectedActiveDecisionId: null,
    expectedTargetResolution: { path: [IDS.target], decisionIds: [] },
};

test('GET authorizes the requested client before loading its review with canonical tenant scope', async () => {
    const { handlers, calls, admin } = setup();

    const response = await handlers.GET(getRequest());

    assert.equal(response.status, 200);
    assert.deepEqual(calls.authorizedClientIds, [IDS.client]);
    assert.equal(calls.adminCount, 1);
    assert.deepEqual(calls.reads, [[admin, IDS.organization, IDS.canonicalClient, IDS.source]]);
    assert.equal((await response.json()).source.pageId, IDS.source);
});

test('invalid GET identifiers fail before authorization or admin construction', async () => {
    const { handlers, calls } = setup();

    const response = await handlers.GET(getRequest('clientId=not-a-uuid&pageId=also-bad'));

    assert.equal(response.status, 400);
    assert.deepEqual(calls.authorizedClientIds, []);
    assert.equal(calls.adminCount, 0);
    assert.equal(calls.reads.length, 0);
});

test('GET returns the authorization result before constructing an admin client', async () => {
    const { handlers, calls } = setup({
        authorize: async () => ({ ok: false, status: 404, error: 'Client not found' }),
    });

    const response = await handlers.GET(getRequest());

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Client not found' });
    assert.equal(calls.adminCount, 0);
    assert.equal(calls.reads.length, 0);
});

test('malformed POST JSON fails before authorization or admin construction', async () => {
    const { handlers, calls } = setup();
    const request = new Request('https://app.test/api/site-inventory/identity/decisions', {
        method: 'POST',
        body: '{',
    });

    const response = await handlers.POST(request);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
    assert.deepEqual(calls.authorizedClientIds, []);
    assert.equal(calls.adminCount, 0);
});

test('viewer authorization is denied before admin construction or decision creation', async () => {
    const { handlers, calls } = setup({ authorize: async () => authorized('viewer') });

    const response = await handlers.POST(decisionRequest(claimBody));

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Forbidden' });
    assert.equal(calls.adminCount, 0);
    assert.equal(calls.writes.length, 0);
});

test('POST derives tenant and actor fields from authorization and ignores browser authority fields', async () => {
    const { handlers, calls } = setup();

    const response = await handlers.POST(decisionRequest({
        ...claimBody,
        organizationId: '99999999-9999-4999-8999-999999999999',
        createdBy: '99999999-9999-4999-8999-999999999999',
        reviewer: '99999999-9999-4999-8999-999999999999',
        evidenceSnapshot: { secret: true },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(calls.authorizedClientIds, [IDS.client]);
    assert.equal(calls.adminCount, 1);
    assert.deepEqual(calls.writes, [{
        organizationId: IDS.organization,
        clientId: IDS.canonicalClient,
        createdBy: IDS.user,
        sourcePageId: IDS.source,
        targetPageId: IDS.target,
        decisionKind: 'claim_into',
        reasonCode: 'redirect_alias',
        note: 'Reviewed redirect evidence.',
        expectedSourceSnapshotId: IDS.sourceSnapshot,
        expectedTargetSnapshotId: IDS.targetSnapshot,
        expectedActiveDecisionId: null,
        expectedTargetResolution: { path: [IDS.target], decisionIds: [] },
    }]);
    assert.equal((calls.writes[0] as Record<string, unknown>).evidenceSnapshot, undefined);
    assert.equal((await response.json()).decisionKind, 'claim_into');
});

test('POST rejects invalid decision fields before admin construction', async () => {
    const cases: Array<[string, unknown]> = [
        ['non-object body', 'decision'],
        ['missing fields', {}],
        ['invalid page id', { ...claimBody, pageId: 'page' }],
        ['invalid source snapshot', { ...claimBody, expectedSourceSnapshotId: 'snapshot' }],
        ['unknown kind', { ...claimBody, decisionKind: 'merge' }],
        ['unknown reason', { ...claimBody, reasonCode: 'because' }],
        ['reason not allowed for kind', { ...claimBody, reasonCode: 'distinct_intent' }],
        ['other without note', { ...claimBody, reasonCode: 'other', note: '  ' }],
        ['note over 2000 characters', { ...claimBody, note: 'x'.repeat(2001) }],
        ['claim without target', { ...claimBody, targetPageId: null }],
        ['claim without target snapshot', { ...claimBody, expectedTargetSnapshotId: null }],
        ['keep separate without target', { ...claimBody, targetPageId: null, decisionKind: 'keep_separate', reasonCode: 'distinct_intent' }],
        ['missing active state', { ...claimBody, expectedActiveDecisionId: undefined }],
        ['missing target path', { ...claimBody, expectedTargetResolution: null }],
        ['malformed target path', { ...claimBody, expectedTargetResolution: { path: [IDS.target], decisionIds: [IDS.user] } }],
        ['research with target snapshot', { ...claimBody, targetPageId: null, decisionKind: 'needs_research', reasonCode: 'ownership_unknown' }],
        ['reopen with target', { ...claimBody, decisionKind: 'reopen', reasonCode: 'new_evidence' }],
    ];

    for (const [name, body] of cases) {
        const { handlers, calls } = setup();
        const response = await handlers.POST(decisionRequest(body));
        assert.equal(response.status, 400, name);
        assert.equal(calls.adminCount, 0, name);
        assert.equal(calls.writes.length, 0, name);
    }
});

test('targetless research accepts nullable fields and reopen checks the specifically confirmed claim', async () => {
    const cases = [
        {
            body: { ...claimBody, targetPageId: null, expectedTargetSnapshotId: null, expectedTargetResolution: null, decisionKind: 'needs_research', reasonCode: 'ownership_unknown' },
            expected: { decisionKind: 'needs_research', reasonCode: 'ownership_unknown' },
        },
        {
            body: { ...claimBody, targetPageId: null, expectedActiveDecisionId: IDS.user, decisionKind: 'reopen', reasonCode: 'new_evidence' },
            expected: { decisionKind: 'reopen', reasonCode: 'new_evidence', expectedTargetSnapshotId: IDS.targetSnapshot },
        },
    ];

    for (const { body, expected } of cases) {
        const { handlers, calls } = setup();
        const response = await handlers.POST(decisionRequest(body));
        assert.equal(response.status, 200);
        const write = calls.writes[0] as Record<string, unknown>;
        assert.equal(write.targetPageId, undefined);
        assert.equal(write.decisionKind, expected.decisionKind);
        assert.equal(write.reasonCode, expected.reasonCode);
        assert.equal(write.expectedTargetSnapshotId, expected.expectedTargetSnapshotId);
    }
});

test('paired keep-separate and research decisions retain the selected target and confirmed state', async () => {
    for (const [decisionKind, reasonCode] of [['keep_separate', 'distinct_intent'], ['needs_research', 'conflicting_signals']]) {
        const { handlers, calls } = setup();
        assert.equal((await handlers.POST(decisionRequest({ ...claimBody, decisionKind, reasonCode }))).status, 200);
        const write = calls.writes[0] as Record<string, unknown>;
        assert.equal(write.targetPageId, IDS.target);
        assert.equal(write.expectedTargetSnapshotId, IDS.targetSnapshot);
        assert.deepEqual(write.expectedTargetResolution, { path: [IDS.target], decisionIds: [] });
    }
});

test('active-claim listing authorizes scope even without a selected crawl page', async () => {
    const { handlers, calls, admin } = setup();
    const response = await handlers.GET(getRequest(`clientId=${IDS.client}&view=active_claims&cursor=${IDS.source}`));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.reads, [[admin, IDS.organization, IDS.canonicalClient, IDS.source]]);
    const denied = setup({ authorize: async () => ({ ok: false, status: 403, error: 'Forbidden' }) });
    assert.equal((await denied.handlers.GET(getRequest(`clientId=${IDS.client}&view=active_claims`))).status, 403);
    assert.equal(denied.calls.adminCount, 0);
});

test('stable persistence failures map to safe HTTP statuses', async () => {
    const cases: Array<[SiteIdentityError['code'], number, string]> = [
        ['not_found', 404, 'The site identity page was not found.'],
        ['stale', 409, 'The crawl evidence changed. Refresh the review and try again.'],
        ['conflict', 409, 'The identity decision conflicts with the current review state.'],
        ['read_failed', 500, 'Unable to load the site identity review.'],
        ['write_failed', 500, 'Unable to save the site identity decision.'],
    ];

    for (const [code, status, message] of cases) {
        const { handlers } = setup({ setDecision: async () => { throw new SiteIdentityError(code); } });
        const response = await handlers.POST(decisionRequest(claimBody));
        assert.equal(response.status, status, code);
        assert.deepEqual(await response.json(), { error: message }, code);
    }
});

test('unexpected persistence failures return a generic 500 without leaking raw errors', async () => {
    const { handlers } = setup({ setDecision: async () => { throw new Error('secret database details'); } });

    const response = await handlers.POST(decisionRequest(claimBody));
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.deepEqual(body, { error: 'Unable to save the site identity decision.' });
    assert.equal(JSON.stringify(body).includes('secret'), false);
});

test('GET maps missing pages and unexpected read failures without leaking provider errors', async () => {
    const missing = setup({ getReview: async () => { throw new SiteIdentityError('not_found'); } });
    const missingResponse = await missing.handlers.GET(getRequest());
    assert.equal(missingResponse.status, 404);

    const failed = setup({ getReview: async () => { throw new Error('secret database details'); } });
    const failedResponse = await failed.handlers.GET(getRequest());
    assert.equal(failedResponse.status, 500);
    assert.deepEqual(await failedResponse.json(), { error: 'Unable to load the site identity review.' });
});
