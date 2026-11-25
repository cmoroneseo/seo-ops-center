import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { call, client, database, expiry, hash, later, now, org, owner, post, task, viewer } from './test-database';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const migration = read('migrations/149_gbp_approval_video.sql');

test('149 enforces scoped, verified, exclusive video media through draft, release, token and retention RPCs', async t => {
    const db = await database();
    t.after(() => db.close());
    await db.exec('alter table public.users add column full_name text; alter table public.bot_api_keys add column revoked_at timestamptz');
    for (const name of ['144_approval_internal_review_links', '145_gbp_approval_multi_photo', '146_gbp_comment_only_notifications', '147_approval_staff_reviews']) {
        await db.exec(read(`migrations/${name}.sql`));
    }
    await db.exec(migration);
    assert.ok(read('schema.sql').includes(migration));
    const bucket = (await db.query("select file_size_limit, allowed_mime_types from storage.buckets where id='gbp-approval-uploads'")).rows[0];
    assert.deepEqual(bucket, { file_size_limit: 78643200, allowed_mime_types: [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime',
    ] });
    const roles = await db.query(`select role, has_function_privilege(role,'public.post_approval_version(uuid,uuid,jsonb,timestamptz)','EXECUTE') as allowed
        from unnest(array['anon','authenticated','service_role']) role`);
    assert.deepEqual(roles.rows, [{ role: 'anon', allowed: false }, { role: 'authenticated', allowed: false }, { role: 'service_role', allowed: true }]);

    const fixture = post('Video post');
    const external = 'https://example.test/first.mp4';
    const entry = { position: 1, payload: fixture.payload, videoPath: external };
    const create = (data: unknown, type = 'gbp_post') => call(db, 'select create_approval_request($1,$2,$3,$4,$5,$6,null,\'[]\',$7) result',
        [owner, org, client, task, type, 'Video draft', JSON.stringify([data])]);
    assert.equal((await create({ ...entry, photoPath: fixture.photoPath })).code, 'invalid_request');
    assert.equal((await create({ ...entry, photoPaths: [fixture.photoPath] })).code, 'invalid_request');
    assert.equal((await create({ ...entry, videoPath: ['https://example.test/a.mp4'] })).code, 'invalid_request');
    const page = { position: 1, payload: { schemaVersion: 1, pageKind: 'blog', title: 'Page', metaTitle: 'Page',
        metaDescription: 'Page', slug: 'page', body: { type: 'doc', content: [] } } };
    assert.equal((await create({ ...page, videoPath: external }, 'page')).code, 'invalid_request');
    const created = await create(entry);
    assert.equal(created.ok, true);
    const requestId = created.requestId;
    const row = (await db.query<{ id: string; video_path: string; photo_path: null; photo_paths: string[] }>(
        'select i.id,v.video_path,v.photo_path,v.photo_paths from approval_items i join approval_item_versions v on v.id=i.current_version_id where i.request_id=$1',
        [requestId])).rows[0];
    const itemId = row.id;
    assert.deepEqual(row, { id: itemId, video_path: external, photo_path: null, photo_paths: [] });
    await assert.rejects(db.query(`insert into approval_item_versions
      (organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,video_path,source)
      values ($1,$2,$3,2,1,$4,$5,array[$5::text],$6,'manual')`,
    [org, requestId, itemId, JSON.stringify(fixture.payload), fixture.photoPath, external]), /invalid GBP media selection/);

    const reserve = (kind: string, type: string, size: number, actor = owner) => call(db,
        'select reserve_approval_asset($1,$2,$3,$4,$5,$6) result', [actor, requestId, itemId, kind, type, size]);
    assert.equal((await reserve('mockup', 'video/mp4', 20)).code, 'invalid_request');
    assert.equal((await reserve('mockup', 'image/png', 10485761)).code, 'invalid_request');
    assert.equal((await reserve('video', 'video/webm', 20)).code, 'invalid_request');
    assert.equal((await reserve('video', 'video/mp4', 78643201)).code, 'invalid_request');
    assert.equal((await reserve('video', 'video/mp4', 20, viewer)).code, 'forbidden');
    const asset = await reserve('video', 'video/quicktime', 78643200);
    const poster = await reserve('video_poster', 'image/jpeg', 100);
    const abandoned = await reserve('video', 'video/mp4', 100);
    for (const value of [asset, poster, abandoned]) assert.equal(value.ok, true);

    const revise = (changes: Record<string, unknown>, rpc = 'post_approval_version') => call(db,
        `select ${rpc}($1,$2,$3,$4) result`, [owner, requestId, JSON.stringify([{ itemId, payload: fixture.payload, ...changes }]), later]);
    const media = { videoPath: asset.objectKey, videoPosterPath: poster.objectKey };
    assert.equal((await revise(media)).code, 'invalid_request');
    await db.query('update approval_assets set video_verified_at=$1 where object_key=$2', [now, asset.objectKey]);
    assert.equal((await revise({ ...media, photoPath: fixture.photoPath }, 'post_gbp_approval_version')).code, 'invalid_request');
    assert.equal((await revise({ ...media, photoPaths: [fixture.photoPath] })).code, 'invalid_request');
    assert.equal((await revise({ videoPath: poster.objectKey })).code, 'invalid_request');
    assert.equal((await revise({ videoPath: asset.objectKey, videoPosterPath: asset.objectKey })).code, 'invalid_request');
    assert.equal((await revise({ photoPaths: [asset.objectKey] })).code, 'invalid_request');
    assert.deepEqual(await revise(media, 'post_gbp_approval_version'), { ok: true, changed: true });
    assert.deepEqual(await revise({}), { ok: true, changed: false });

    const draftPatch = await call(db, 'select update_approval_draft($1,$2,$3,$4) result',
        [owner, requestId, JSON.stringify({ items: [{ ...entry, position: 2 }] }), now]);
    assert.equal(draftPatch.ok, true);
    const internalHash = hash('internal video');
    assert.equal((await call(db, 'select issue_approval_internal_link($1,null,$2,null,$3,7,null,$4,$5) result',
        [owner, requestId, internalHash, org, now])).ok, true);
    const internal = await call(db, 'select get_approval_internal_review($1,$2) result', [internalHash, now]);
    assert.deepEqual((internal.batches as { posts: Record<string, unknown>[] }[])[0].posts.map(p => p.videoPath), [asset.objectKey, external]);

    const clientHash = hash('client video');
    assert.equal((await call(db, 'select send_approval_request($1,$2,$3,$4,$5) result', [owner, requestId, clientHash, expiry, later])).ok, true);
    const get = async (rpc: string) => (await call(db, `select ${rpc}($1,$2) result`, [clientHash, later])).items as
        { status: string; version: { videoPath: string | null; videoPosterPath: string | null; previous?: { videoPath: string } } }[];
    for (const rpc of ['get_approval_by_token', 'get_gbp_approval_by_token']) {
        const items = await get(rpc);
        assert.equal(items[0].version.videoPath, asset.objectKey);
        assert.equal(items[0].version.videoPosterPath, poster.objectKey);
    }
    await db.query("update approval_items set status='approved' where id=$1", [itemId]);
    assert.equal((await revise({ videoPath: null, changeNote: 'Removed video' })).changed, true);
    const released = (await get('get_approval_by_token'))[0];
    assert.equal(released.status, 'pending');
    assert.equal(released.version.videoPath, null);
    assert.equal(released.version.previous?.videoPath, asset.objectKey);

    // Stage the previous video-bearing version as a separate revision.
    await db.query("update approval_items set current_version_id=previous_released_version_id,status='approved' where id=$1", [itemId]);
    assert.equal((await call(db, 'select release_approval_revision($1,$2,$3) result', [owner, requestId, later])).ok, true);
    const videoReleased = (await get('get_approval_by_token'))[0];
    assert.equal(videoReleased.status, 'pending');
    assert.equal(videoReleased.version.videoPath, asset.objectKey);

    await db.query('update approval_assets set created_at=$1 where request_id=$2', [now, requestId]);
    const keys = async (at: string, removed?: unknown[]) => (await call(db, 'select purge_gbp_approval_retention($1,$2) result', [at, removed ?? null])).objectKeys;
    assert.deepEqual(await keys('2026-12-01T00:00:00Z'), [abandoned.objectKey]);
    await keys('2026-12-01T00:00:00Z', [abandoned.objectKey]);
    const expired = '2028-01-01T00:00:00Z';
    assert.deepEqual(new Set(await keys(expired) as string[]), new Set([asset.objectKey, poster.objectKey]));
    await keys(expired, [asset.objectKey, poster.objectKey]);
    assert.deepEqual(await keys(expired), []);

    const archiveDraft = await create({ ...entry, videoPath: null, photoPaths: [fixture.photoPath] });
    const archiveItem = (await db.query<{ id: string }>('select id from approval_items where request_id=$1', [archiveDraft.requestId])).rows[0];
    const archiveAsset = await call(db, "select reserve_approval_asset($1,$2,$3,'video','video/mp4',20) result", [owner, archiveDraft.requestId, archiveItem.id]);
    await db.query('update approval_assets set video_verified_at=$1 where object_key=$2', [now, archiveAsset.objectKey]);
    assert.deepEqual(await call(db, 'select post_approval_version($1,$2,$3,$4) result',
        [owner, archiveDraft.requestId, JSON.stringify([{ itemId: archiveItem.id, payload: fixture.payload, videoPath: archiveAsset.objectKey }]), now]),
        { ok: true, changed: true });
    assert.deepEqual((await db.query('select photo_paths from approval_item_versions where video_path=$1', [archiveAsset.objectKey])).rows, [{ photo_paths: [] }]);
    assert.equal((await call(db, 'select archive_approval_request($1,$2,$3) result', [owner, archiveDraft.requestId, now])).ok, true);
    assert.deepEqual(await keys(expired), [archiveAsset.objectKey]);
});
