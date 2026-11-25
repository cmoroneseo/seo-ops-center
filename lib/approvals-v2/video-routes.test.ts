import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAdminClient } from '@/lib/supabase/admin';
import { createGbpVersionPost } from '@/lib/gbp-approvals/versions-route';
import { createPublicGet } from '@/lib/gbp-approvals/public-get-route';
import { loadPublicReview } from '@/lib/gbp-approvals/live';
import { createInternalReviewGet, createInternalReviewLoader } from '@/lib/internal-review/public';
import { createAssetUpload } from './assets';
import { loadApprovalReviewForToken } from './public';
import { mutation } from './staff';
import { post } from './test-database';

type Admin = ReturnType<typeof createAdminClient>;
const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const key = `approval-assets/${id}/33333333-3333-4333-8333-333333333333`;
const poster = `approval-assets/${id}/44444444-4444-4444-8444-444444444444`;
const ctx = { params: Promise.resolve({ id }) };
const token = 'video-review-fixture-token';
const reviewCtx = { params: Promise.resolve({ token }) };
const fixture = post('Preview with video');
const payload = fixture.payload;
const actor = async () => 'actor';
const request = (body: unknown, method = 'POST') => new Request('https://local.test', { method, body: JSON.stringify(body) });

test('staff asset route reserves, verifies, serves and deletes video uploads', async () => {
    const contents = readFileSync(new URL('../../public/dev/gbp-approvals/sample.mp4', import.meta.url));
    const asset = { object_key: key, organization_id: 'org', kind: 'video', byte_size: contents.byteLength, video_verified_at: null as string | null };
    const good = new Blob([new Uint8Array(contents)]);
    let blob = good;
    let role = 'member';
    let updated = 0;
    let removed = 0;
    let deleted = 0;
    let downloads = 0;
    const admin = {
        from(table: string) {
            const query = {
                select: () => query, eq: () => query,
                update(fields: { video_verified_at: string }) { updated++; asset.video_verified_at = fields.video_verified_at; return query; },
                delete() { deleted++; return query; },
                is: async () => ({ error: null }),
                maybeSingle: async () => ({ data: table === 'organization_members' ? { role } : asset }),
            };
            return query;
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
            assert.equal(name, 'reserve_approval_asset');
            assert.deepEqual(args, {
                p_actor: 'actor', p_request_id: id, p_item_id: itemId, p_kind: 'video', p_content_type: 'video/quicktime', p_size: good.size,
            });
            return { data: { ok: true, objectKey: key } };
        },
        storage: { from: (bucket: string) => {
            assert.equal(bucket, 'gbp-approval-uploads');
            return {
                createSignedUploadUrl: async (path: string) => { assert.equal(path, key); return { data: { signedUrl: 'https://storage.test/upload' } }; },
                createSignedUrl: async (path: string) => { assert.equal(path, key); return { data: { signedUrl: 'https://storage.test/watch' } }; },
                download: async (path: string) => { assert.equal(path, key); downloads++; return { data: blob }; },
                remove: async (paths: string[]) => { assert.deepEqual(paths, [key]); removed++; return {}; },
            };
        } },
    } as unknown as Admin;
    const handle = createAssetUpload({ agencyActor: actor, createAdminClient: () => admin });
    const reserve = { itemId, kind: 'video', contentType: 'video/quicktime', size: good.size, durationSeconds: 3, width: 1280, height: 720 };
    for (const invalid of [{ size: 78643201 }, { durationSeconds: 31 }, { height: 719 }, { contentType: 'video/webm' }]) {
        assert.equal((await handle(request({ ...reserve, ...invalid }), ctx)).status, 400);
    }
    assert.deepEqual(await (await handle(request(reserve), ctx)).json(), { objectKey: key, signedUrl: 'https://storage.test/upload' });
    const sign = { objectKey: key, itemId };
    const verify = { ...sign, action: 'verify-video' };
    assert.equal((await handle(request(sign), ctx)).status, 400);
    assert.equal((await handle(request({ ...verify, objectKey: key.replace(id, itemId) }), ctx)).status, 404);
    role = 'viewer';
    assert.equal((await handle(request(verify), ctx)).status, 403);
    assert.equal(downloads, 0);
    role = 'member';
    blob = new Blob([new Uint8Array(good.size)]);
    const invalid = await handle(request(verify), ctx);
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /MP4 or MOV/);
    assert.equal(removed, 1);
    assert.equal(deleted, 1);
    assert.equal(updated, 0);

    blob = good;
    const signed = { ok: true, videoUrl: 'https://storage.test/watch', assetUrl: 'https://storage.test/watch', photoUrl: 'https://storage.test/watch' };
    assert.deepEqual(await (await handle(request(verify), ctx)).json(), signed);
    assert.equal(updated, 1);
    assert.deepEqual(await (await handle(request(verify), ctx)).json(), signed);
    assert.deepEqual(await (await handle(request(sign), ctx)).json(), signed);
    assert.equal(downloads, 2);
});

test('both version routes and the draft patch reject mixed media and pass video to their RPCs', async () => {
    for (const [action, rpc] of [
        ['versions', 'post_approval_version'], ['legacy', 'post_gbp_approval_version'], ['draft', 'update_approval_draft'],
    ] as const) {
        let calls = 0;
        const deps = { agencyActor: actor, createAdminClient: () => ({
            rpc: async (name: string, args: { p_items?: Record<string, unknown>[]; p_patch?: { items: Record<string, unknown>[] } }) => {
                assert.equal(name, rpc);
                const [item] = args.p_items ?? args.p_patch!.items;
                assert.equal(item.videoPath, key);
                assert.equal(item.videoPosterPath, poster);
                calls++;
                return { data: { ok: true } };
            },
        }) as unknown as Admin };
        const handle = action === 'legacy' ? createGbpVersionPost(deps) : mutation(action, deps);
        const item = { itemId, payload, videoPath: key, videoPosterPath: poster };
        const send = (changes = {}) => handle(request({ items: [{ ...item, ...changes }] }, action === 'draft' ? 'PATCH' : 'POST'), ctx);
        for (const bad of [{ photoPath: fixture.photoPath }, { photoPaths: [fixture.photoPath] }, { videoPath: [key] }, { videoPath: null }]) {
            assert.equal((await send(bad)).status, 400);
        }
        assert.equal(calls, 0);
        assert.equal((await send({ photoPaths: [] })).status, 200);
        assert.equal(calls, 1);
    }
});

test('both client loaders and the internal review endpoint project signed video and poster URLs', async () => {
    const raw = { ok: true, state: 'active', itemType: 'gbp_post', items: [{
        id: itemId, position: 1, version: { id: itemId, versionNo: 1, payload, photoPaths: [], videoPath: key, videoPosterPath: poster },
    }] };
    const signer = async (path: string) => {
        assert.ok(path === key || path === poster);
        return path === key ? 'https://storage.test/watch' : 'https://storage.test/poster';
    };
    const adminFactory = () => {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null }) };
        return { from: () => query, rpc: async () => ({ data: raw }) } as unknown as Admin;
    };
    const current = await loadApprovalReviewForToken(token, { createAdminClient: adminFactory, signApprovalPhoto: signer });
    assert.ok(current && 'posts' in current);
    assert.equal(current.posts[0].videoSrc, 'https://storage.test/watch');
    assert.equal(current.posts[0].videoPosterSrc, 'https://storage.test/poster');

    const legacy = createPublicGet({ loadPublicReview: (token, sign) => loadPublicReview(token, sign, adminFactory), signApprovalPhoto: signer });
    const legacyResult = await legacy(new Request('https://local.test/r/' + token), reviewCtx);
    assert.equal(legacyResult.status, 200);
    assert.equal((await legacyResult.json()).posts[0].videoSrc, 'https://storage.test/watch');

    const internal = createInternalReviewLoader(() => ({
        rpc: async () => ({ data: { ok: true, clientName: 'Client', batches: [{ requestId: id, title: 'Batch', posts: [
            { ...payload, position: 1, itemId, versionId: itemId, photoPath: null, videoPath: key, videoPosterPath: poster, feedback: [] },
            { ...payload, position: 2, itemId, versionId: itemId, photoPath: null, videoPath: key.replace(id, itemId), feedback: [] },
        ] }] } }),
    }) as unknown as Admin, signer);
    const response = await createInternalReviewGet(internal)(new Request('https://local.test/ir/' + token), reviewCtx);
    assert.equal(response.status, 200);
    const body = await response.text();
    const { posts } = JSON.parse(body).batches[0];
    assert.equal(posts[0].videoSrc, 'https://storage.test/watch');
    assert.equal(posts[0].videoPosterSrc, 'https://storage.test/poster');
    assert.equal(posts[1].videoSrc, null);
    assert.doesNotMatch(body, /approval-assets|videoPath|videoPosterPath/);
});
