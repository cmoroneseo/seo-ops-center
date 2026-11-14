import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';
import { hashToken } from '../approvals/token';
import { loadPublicReview } from './live';
import { createPublicGet } from './public-get-route';
import { createSubmit } from './submit-route';
import { createUpload } from './upload-route';
import { createAgencyActor } from './agency-auth';
import { createIssueLink } from './issue-link-route';
import { createExtendLink } from './extend-link-route';
import { createRevokeLink } from './revoke-link-route';
import { runApprovalRetention } from './retention';
import type { createAdminClient } from '../supabase/admin';
import type { PublicReviewView } from './public-view';

type Admin = ReturnType<typeof createAdminClient>;
function adminMock(value: unknown): Admin {
    return value as Admin;
}
const token = 'a-valid-long-unguessable-review-token';
const context = { params: Promise.resolve({ token }) };
const view: PublicReviewView = {
    state: 'active', title: 'Posts', clientName: 'Client', dueAt: null, round: 1,
    expiresAt: '2099-01-01', hadSubmission: false, posts: [], questions: [],
    summary: { approved: 0, changesRequested: 0, pending: 0, questionsAnswered: 0, questionsTotal: 0 },
};
function post(path: string, body: unknown) {
    return new Request('https://seo.test/api/public/approvals/' + token + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
}
function headers(response: Response) {
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
}

for (const state of ['active', 'expired', 'revoked'] as const) {
    test(`public GET, submit and upload enforce ${state} token state and privacy headers`, async () => {
        let storageCalls = 0;
        let submitCalls = 0;
        const chain = {
            select: () => chain, eq: () => chain,
            maybeSingle: async () => ({ error: null, data: {
                id: 'link', request_id: 'request',
                revoked_at: state === 'revoked' ? '2026-01-01' : null,
                expires_at: state === 'expired' ? '2020-01-01' : '2099-01-01',
            } }),
        };
        const admin = adminMock({
            from: () => chain,
            rpc: async (name: string, args: { p_token_hash: string }) => {
                assert.equal(args.p_token_hash, hashToken(token));
                if (name === 'get_gbp_approval_by_token') return { error: null, data: { ...view, state, ok: true, items: [] } };
                if (name === 'reserve_gbp_approval_upload') return {
                    error: null, data: state === 'active'
                        ? { ok: true, objectKey: 'gbp-approvals/request/reservation', reservationId: 'reservation' }
                        : { ok: false, code: state },
                };
                assert.equal(name, 'submit_gbp_approval');
                submitCalls++;
                return { error: null, data: { ok: true } };
            },
            storage: { from: (bucket: string) => {
                assert.equal(bucket, 'gbp-approval-uploads');
                storageCalls++;
                return { createSignedUploadUrl: async () => ({ data: { signedUrl: 'https://storage.test/upload', token: 'upload-token' }, error: null }) };
            } },
        });
        const get = createPublicGet({ loadPublicReview: (value, sign) => loadPublicReview(value, sign, () => admin), signApprovalPhoto: async () => null });
        const getResponse = await get(new Request('https://seo.test/api/public/approvals/' + token), context);
        assert.equal(getResponse.status, 200);
        assert.equal((await getResponse.json()).state, state);
        headers(getResponse);
        const submit = createSubmit({ createAdminClient: () => admin, clientIpHash: () => null });
        const submitted = await submit(post('/submit', {
            respondentName: 'Casey', idempotencyKey: 'submission-1',
            displayedVersionIds: ['version'], decisions: [], answers: [],
        }), context);
        assert.equal(submitted.status, state === 'active' ? 200 : 410);
        assert.equal(submitCalls, state === 'active' ? 1 : 0);
        headers(submitted);
        const upload = createUpload({ createAdminClient: () => admin });
        const uploaded = await upload(post('/photo-upload-url', { contentType: 'image/png', byteSize: 100 }), context);
        assert.equal(uploaded.status, state === 'active' ? 200 : 410);
        assert.equal(storageCalls, state === 'active' ? 1 : 0);
        headers(uploaded);
        for (const path of ['/r/' + token, '/api/public/approvals/' + token,
            '/api/public/approvals/' + token + '/submit', '/api/public/approvals/' + token + '/photo-upload-url']) {
            headers(await middleware(new NextRequest('https://seo.test' + path)));
        }
    });
}

for (const [action, create] of [['issue', createIssueLink], ['extend', createExtendLink], ['revoke', createRevokeLink]] as const) {
    test(`link ${action} rejects bot keys and unauthenticated sessions before admin access`, async () => {
        let sessionCalls = 0;
        const actor = createAgencyActor(async () => { sessionCalls++; return null; });
        const handler = create({
            agencyActor: actor,
            createAdminClient: () => { throw new Error('unauthorized admin access'); },
        });
        for (const authorization of ['Bearer seo_bot_test-key', null]) {
            const response = await handler(new Request('https://seo.test/api/gbp-approvals/requests/request/link/' + action, {
                method: 'POST', headers: authorization ? { authorization } : {},
            }), { params: Promise.resolve({ id: 'request' }) });
            assert.equal(response.status, 401);
        }
        assert.equal(sessionCalls, 1);
    });
}

test('retention removes Storage objects before acknowledging row deletion and retains rows on failure', async () => {
    for (const failed of [false, true]) {
        const calls: string[] = [];
        const admin = adminMock({
            rpc: async (_name: string, args: { p_removed_keys?: string[] }) => {
                if (args.p_removed_keys) {
                    calls.push('delete rows');
                    assert.deepEqual(args.p_removed_keys, ['orphan-key']);
                } else calls.push('select keys');
                return { data: { ok: true, objectKeys: ['orphan-key'] }, error: null };
            },
            storage: { from: (bucket: string) => {
                assert.equal(bucket, 'gbp-approval-uploads');
                return { remove: async (keys: string[]) => {
                    assert.deepEqual(keys, ['orphan-key']);
                    calls.push('remove objects');
                    return { error: failed ? { message: 'retry' } : null };
                } };
            } },
        });
        const response = await runApprovalRetention(admin);
        assert.equal(response.status, failed ? 500 : 200);
        assert.deepEqual(calls, failed ? ['select keys', 'remove objects'] : ['select keys', 'remove objects', 'delete rows']);
    }
});
