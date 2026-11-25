import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hashToken } from '@/lib/approvals/token';
import { createAgencyActor } from '@/lib/gbp-approvals/agency-auth';
import { BOT_INTERNAL_REVIEW_PATH, botRequestDecision } from '@/lib/bots/scope';
import type { createAdminClient } from '@/lib/supabase/admin';
import { createInternalFeedbackPost, createInternalReviewGet, createInternalReviewLoader } from './public';
import { createBotInternalLink, createStaffInternalLinks } from './manage';
import { UNAVAILABLE_REVIEW, publicInternalReviewPath } from './model';

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => {};
const { InternalReview } = require('@/components/internal-review/InternalReview') as typeof import('@/components/internal-review/InternalReview');
const { metadata } = require('@/app/ir/[token]/page') as typeof import('@/app/ir/[token]/page');

type Admin = ReturnType<typeof createAdminClient>;
const linkId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const versionId = '44444444-4444-4444-8444-444444444444';
const org = '55555555-5555-4555-8555-555555555555';
const client = '66666666-6666-4666-8666-666666666666';
const photoKey = `gbp-approvals/${requestId}/${itemId}`;
const token = 'a'.repeat(43);
const expiry = '2099-12-01T12:00:00Z';
const ctx = { params: Promise.resolve({ id: requestId }) };
const publicCtx = (value: string) => ({ params: Promise.resolve({ token: value }) });
const origin = 'https://local.test';

function request(method: string, body?: unknown, authorization?: string) {
    return new Request(origin, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(authorization ? { headers: { authorization } } : {}),
    });
}

function rpcAdmin(rpc: (name: string, args: Record<string, unknown>) => unknown) {
    return () => ({ rpc: async (name: string, args: Record<string, unknown>) => ({ data: rpc(name, args) }) }) as unknown as Admin;
}

const rawPost = {
    itemId, versionId, position: 1,
    title: 'Holiday post',
    body: 'Book your next visit.',
    postType: 'offer',
    scheduledDate: '2026-12-01',
    offerStart: '2026-12-01',
    offerEnd: '2026-12-31',
    terms: 'Book ahead.',
    ctaUrl: 'https://example.com/offer?utm_source=google&utm_campaign=winter',
    ctaLabel: 'Book',
    photoPath: photoKey,
    feedback: [{ reviewerName: 'Reviewer', decision: 'approved', comment: 'Ready', linkId: 'private-link-id', reviewerEmail: 'private@email' }],
    changeNote: 'private-change-note',
    staffComments: ['private-comment'],
};
const raw = {
    ok: true,
    clientName: 'Fixture Client',
    batches: [{ title: 'December', requestId, posts: [rawPost], taskId: 'private-task-id', taskTitle: 'private-task-title' }],
    hours: 12,
    notes: 'private-note',
    basecampId: 'private-basecamp',
    createdBy: 'private-creator',
    owner: 'private-owner',
    botKey: 'private-key',
};

test('public read projects only allowed fields and signs only request-scoped storage photos', async () => {
    const signed: string[] = [];
    const external = 'https://drive.google.com/thumbnail?id=sample';
    const load = createInternalReviewLoader(rpcAdmin((name, args) => {
        assert.equal(name, 'get_approval_internal_review');
        assert.equal(args.p_token_hash, hashToken(token));
        return {
            ...raw,
            batches: [{ ...raw.batches[0], posts: [
                rawPost,
                { ...rawPost, postType: 'update', offerStart: null, offerEnd: null, terms: '', photoPath: external, photoPaths: [external, photoKey] },
                { ...rawPost, photoPath: 'javascript:alert(1)', ctaUrl: 'data:text/html,example' },
                { ...rawPost, photoPath: `gbp-approvals/${itemId}/${itemId}` },
            ] }],
        };
    }), async path => {
        signed.push(path);
        return 'https://storage.example.com/signed';
    });
    const result = await createInternalReviewGet(load)(request('GET'), publicCtx(token));
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(result.headers.get('x-robots-tag'), 'noindex, nofollow');
    const body = await result.text();
    assert.doesNotMatch(body, /private|requestId|photoPath|hours|createdBy|owner|botKey|staffComments|changeNote|javascript:|data:text/);
    assert.deepEqual(signed, [photoKey, photoKey]);
    const view = JSON.parse(body);
    assert.deepEqual(view.batches[0].posts.map((post: { photoSrc: string | null }) => post.photoSrc),
        ['https://storage.example.com/signed', external, null, null]);
    assert.equal(view.batches[0].posts[0].ctaUrl, rawPost.ctaUrl);
    const update = view.batches[0].posts[1];
    assert.deepEqual(update.photoSrcs, [external, 'https://storage.example.com/signed']);
    assert.deepEqual(
        { postType: update.postType, offerStart: update.offerStart, offerEnd: update.offerEnd, terms: update.terms },
        { postType: 'update', offerStart: null, offerEnd: null, terms: '' },
    );
    const html = renderToStaticMarkup(createElement(InternalReview, { view, token }));
    assert.match(html, /src="https:\/\/drive.google.com\/thumbnail\?id=sample"[^>]+referrerPolicy="no-referrer"/i);
    assert.doesNotMatch(html, /private|javascript:|data:text/);
});

test('all unusable link reasons share one HTTP body and non-identifying view', async () => {
    let responseBody: string | undefined;
    let pageBody: string | undefined;
    for (const reason of ['malformed', 'unknown', 'revoked', 'expired', 'sent', 'archived', 'empty']) {
        const supplied = reason === 'malformed' ? '?' : token;
        const load = createInternalReviewLoader(rpcAdmin((name, args) => {
            assert.equal(name, 'get_approval_internal_review');
            assert.equal(String(args.p_token_hash).length, 64);
            assert.equal(args.p_token_hash === hashToken(token), reason !== 'malformed');
            return { ...raw, ok: false, code: reason };
        }), async () => assert.fail('unusable links must not sign a photo'));
        const result = await createInternalReviewGet(load)(request('GET'), publicCtx(supplied));
        assert.equal(result.status, 404);
        const body = await result.text();
        const html = renderToStaticMarkup(createElement(InternalReview, { view: await load(supplied) }));
        assert.equal(body, responseBody ??= JSON.stringify({ error: UNAVAILABLE_REVIEW }));
        assert.equal(html, pageBody ??= html);
        assert.match(html, /This link isn&#x27;t available/);
        assert.doesNotMatch(html, /Fixture Client|December|private/);
    }
    assert.equal(metadata.title, 'Internal review');
    assert.deepEqual(metadata.robots, { index: false, follow: false });
});

test('public feedback calls only the internal feedback RPC and handles stale, replay and unavailable results', async () => {
    const body = { itemId, versionId, reviewerName: ' Reviewer ', decision: null, comment: ' Good ', idempotencyKey: 'feedback-001' };
    for (const [value, status] of [
        [{ ok: false, code: 'not_found' }, 404],
        [{ ok: false, code: 'refresh_required' }, 409],
        [{ ok: false, code: 'rate_limited' }, 429],
        [{ ok: true, idempotent: true }, 200],
    ] as const) {
        let calls = 0;
        const result = await createInternalFeedbackPost(rpcAdmin((name, args) => {
            calls++;
            assert.equal(name, 'submit_approval_internal_feedback');
            assert.equal(args.p_token_hash, hashToken(token));
            assert.equal(args.p_reviewer_name, 'Reviewer');
            assert.equal(args.p_comment, 'Good');
            assert.equal(args.p_decision, null);
            return value;
        }))(request('POST', body), publicCtx(token));
        assert.equal(calls, 1);
        assert.equal(result.status, status);
        if (status === 404) assert.deepEqual(await result.json(), { error: UNAVAILABLE_REVIEW });
        if (status === 200) assert.deepEqual(await result.json(), { ok: true, idempotent: true });
    }
});

function fakeChain(result: unknown, calls: { method: string; args: unknown[] }[] = []) {
    const chain: Record<string, unknown> = {
        maybeSingle: async () => ({ data: result, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve),
    };
    for (const method of ['select', 'eq', 'in', 'or', 'is', 'gt', 'order', 'update']) {
        chain[method] = (...args: unknown[]) => {
            calls.push({ method, args });
            return chain;
        };
    }
    return chain;
}

test('staff control rejects unauthenticated, bearer and viewer writes and hides other organizations', async () => {
    for (const [actor, auth, role, visible, status] of [
        [null, undefined, 'member', true, 401],
        [itemId, 'Bearer seo_bot_fixture', 'member', true, 403],
        [itemId, undefined, 'viewer', true, 403],
        [itemId, undefined, 'member', false, 404],
    ] as const) {
        const calls: { method: string; args: unknown[] }[] = [];
        const handle = createStaffInternalLinks('POST', {
            agencyActor: createAgencyActor(async () => actor),
            createAdminClient: () => ({
                from: (table: string) => {
                    if (table === 'organization_members') return fakeChain([{ organization_id: org, role }]);
                    assert.equal(table, 'approval_requests');
                    return fakeChain(visible ? { organization_id: org, client_id: client } : null, calls);
                },
                rpc: () => assert.fail('denied staff cannot mint'),
            }) as unknown as Admin,
        });
        assert.equal((await handle(request('POST', { scope: 'client' }, auth), ctx)).status, status);
        if (actor && !auth) assert.deepEqual(calls.find(call => call.method === 'in')?.args, ['organization_id', [org]]);
    }
});

test('staff create returns the URL once, lists expiry and can revoke the protected scope', async () => {
    let tokenHash = '';
    let revoked = false;
    const calls: { method: string; args: unknown[] }[] = [];
    const deps = {
        agencyActor: async () => itemId,
        createAdminClient: () => ({
            from: (table: string) => {
                if (table === 'organization_members') return fakeChain([{ organization_id: org, role: 'member' }]);
                if (table === 'approval_requests') return fakeChain({ organization_id: org, client_id: client });
                assert.equal(table, 'approval_internal_links');
                return fakeChain(revoked ? [] : [{ id: linkId, scope: 'client', expires_at: expiry }], calls);
            },
            rpc: async (name: string, args: Record<string, unknown>) => {
                assert.equal(name, 'issue_approval_internal_link');
                assert.equal(args.p_client_id, client);
                assert.equal(args.p_request_id, requestId);
                assert.equal(args.p_expires_in_days, 7);
                tokenHash = String(args.p_token_hash);
                return { data: { ok: true, id: linkId, expiresAt: expiry } };
            },
        }) as unknown as Admin,
    };
    const create = await createStaffInternalLinks('POST', deps)(request('POST', { scope: 'client' }), ctx);
    assert.equal(create.status, 201);
    const { url } = await create.json();
    assert.equal(hashToken(new URL(url).pathname.split('/').at(-1)!), tokenHash);
    const list = await createStaffInternalLinks('GET', deps)(request('GET'), ctx);
    assert.deepEqual(await list.json(), { links: [{ id: linkId, scope: 'client', expiresAt: expiry }] });
    const revoke = await createStaffInternalLinks('DELETE', deps)(request('DELETE', { linkId }), ctx);
    assert.equal(revoke.status, 200);
    const update = calls.find(call => call.method === 'update')?.args[0] as Record<string, unknown>;
    assert.equal(update.revoked_by, itemId);
    assert.ok(update.revoked_at);
    assert.ok(calls.some(call => call.method === 'eq' && call.args[0] === 'client_id' && call.args[1] === client));
    assert.ok(calls.some(call => call.method === 'or' && call.args[0] === `scope.eq.client,request_id.eq.${requestId}`));
    revoked = Boolean(update.revoked_at);
    const load = createInternalReviewLoader(rpcAdmin(() => revoked ? { ok: false, code: 'not_found' } : raw));
    assert.deepEqual(await (await createInternalReviewGet(load)(request('GET'), publicCtx(new URL(url).pathname.split('/').at(-1)!))).json(), { error: UNAVAILABLE_REVIEW });
});

test('bot route checks the existing SEO allowlist, scopes the command and returns no URL on replay', async () => {
    let botName = 'call-tracking';
    let calls = 0;
    const post = createBotInternalLink(() => ({
        from: (table: string) => {
            assert.equal(table, 'bot_api_keys');
            return fakeChain({ id: linkId, organization_id: org, name: botName, revoked_at: null });
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
            assert.equal(name, 'issue_approval_internal_link');
            assert.equal(args.p_organization_id, org);
            assert.equal(args.p_bot_key_id, linkId);
            assert.equal(args.p_actor, null);
            assert.equal(args.p_request_id, requestId);
            assert.equal(args.p_client_id, null);
            return { data: { ok: true, id: linkId, expiresAt: expiry, idempotent: calls++ > 0 } };
        },
    }) as unknown as Admin);
    const payload = { idempotencyKey: 'review-bot-001', requestId };
    const auth = 'Bearer seo_bot_fixture';
    assert.equal((await post(request('POST', payload))).status, 401);
    assert.equal((await post(request('POST', payload, auth))).status, 403);
    assert.equal(calls, 0);
    botName = 'SEO-Manager';
    assert.equal((await post(request('POST', { ...payload, clientId: client }, auth))).status, 400);
    const created = await post(request('POST', payload, auth));
    assert.equal(created.status, 201);
    assert.match((await created.json()).url, /^https:\/\/local.test\/ir\/[A-Za-z\d_-]{43}$/);
    const retry = await post(request('POST', payload, auth));
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), { expiresAt: expiry, idempotent: true });
    assert.equal(botRequestDecision({ pathname: BOT_INTERNAL_REVIEW_PATH, method: 'POST', authorization: auth }), 'allow');
    assert.equal(botRequestDecision({ pathname: BOT_INTERNAL_REVIEW_PATH, method: 'DELETE', authorization: auth }), 'forbid');
});

test('the anonymous middleware exception is limited to the token page and its two API endpoints', () => {
    for (const path of ['/ir/token', '/api/public/internal-review/token', '/api/public/internal-review/token/feedback']) {
        assert.equal(publicInternalReviewPath(path), true);
    }
    for (const path of ['/ir', '/ir/token/more', '/api/public/internal-review', '/api/public/internal-review/token/revoke', '/api/public/internal-review-alias/token']) {
        assert.equal(publicInternalReviewPath(path), false);
    }
});

test('internal feedback forwards a numbered photo target through the existing RPC', async () => {
    const body = { itemId, versionId, reviewerName: 'Reviewer', decision: null, comment: 'Use this photo', idempotencyKey: 'gallery-feedback-1' };
    const submit = createInternalFeedbackPost(rpcAdmin((name, args) => {
        assert.equal(name, 'submit_approval_internal_feedback');
        if (args.p_comment === null) {
            assert.equal(args.p_photo_position, undefined);
            return { ok: false, code: 'invalid_request' };
        }
        assert.equal(args.p_version_id, versionId);
        assert.equal(args.p_photo_position, 2);
        return { ok: true };
    }));
    assert.equal((await submit(request('POST', { ...body, photoPosition: 2 }), publicCtx(token))).status, 200);
    assert.equal((await submit(request('POST', { ...body, photoPosition: 11 }), publicCtx(token))).status, 400);
});

test('internal review renders a scoped video and poster in the shared card', async () => {
    const videoPath = `approval-assets/${requestId}/${itemId}`;
    const videoPosterPath = `approval-assets/${requestId}/${versionId}`;
    const load = createInternalReviewLoader(rpcAdmin(() => ({
        ...raw, batches: [{ ...raw.batches[0], posts: [{ ...rawPost, photoPath: null, videoPath, videoPosterPath }] }],
    })), async path => path === videoPath ? 'https://storage.example.com/video.mp4' : 'https://storage.example.com/poster.jpg');
    const view = await load(token);
    assert.ok(view);
    const html = renderToStaticMarkup(createElement(InternalReview, { view, token }));
    assert.match(html, /<video[^>]+src="https:\/\/storage.example.com\/video.mp4"[^>]+poster="https:\/\/storage.example.com\/poster.jpg"/);
    assert.doesNotMatch(html, /Photo needed|<img[^>]+video.mp4/);
});
