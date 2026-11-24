import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { call, client, database, expiry, hash, later, now, org, owner, post, task } from './test-database.ts';

const migration = readFileSync(new URL('../../migrations/145_gbp_approval_multi_photo.sql', import.meta.url), 'utf8');
const primary = 'https://drive.google.com/thumbnail?id=fixture';
const secondary = 'https://example.com/second.jpg';
const update = {
    ...post('Holiday hours').payload,
    postType: 'update',
    offerStart: null,
    offerEnd: null,
};
const legacy = { position: 1, payload: update, photoPath: primary };
type Db = Awaited<ReturnType<typeof database>>;

function create(db: Db, entry: unknown = legacy) {
    return call(db, "select create_approval_request($1,$2,$3,$4,'gbp_post','December drafts',null,'[]',$5) result",
        [owner, org, client, task, JSON.stringify([entry])]);
}

async function current(db: Db, requestId: unknown) {
    const { rows } = await db.query<{ itemId: string; versionId: string; photo_path: string | null; photo_paths: string[] }>(
        'select i.id "itemId", v.id "versionId", v.photo_path, v.photo_paths from approval_items i join approval_item_versions v on v.id=i.current_version_id where i.request_id=$1',
        [requestId]);
    assert.equal(rows.length, 1);
    return rows[0];
}

function revise(db: Db, requestId: unknown, item: unknown) {
    return call(db, 'select post_approval_version($1,$2,$3,$4) result', [owner, requestId, JSON.stringify([item]), later]);
}

test('145 migrates historical GBP updates, preserves gallery order and keeps versions immutable', async t => {
    const db = await database();
    t.after(() => db.close());
    await db.exec(readFileSync(new URL('../../migrations/144_approval_internal_review_links.sql', import.meta.url), 'utf8'));
    const legacyPage = { position: 1, photoPath: secondary, payload: {
        schemaVersion: 1, pageKind: 'blog', title: 'Page with a mockup', metaTitle: 'Page with a mockup',
        metaDescription: 'Description', slug: 'mockup', body: { type: 'doc', content: [] },
    } };
    const createPage = (entry = legacyPage) => call(db, "select create_approval_request($1,$2,$3,$4,'page','Pages',null,'[]',$5) result",
        [owner, org, client, task, JSON.stringify([entry])]);
    const oldPage = await createPage();
    assert.equal(oldPage.ok, true);
    const old = await create(db);
    assert.equal(old.ok, true);
    await db.exec(migration);
    const stored = await current(db, old.requestId);
    assert.deepEqual(stored.photo_paths, [primary]);
    assert.deepEqual((await current(db, oldPage.requestId)).photo_paths, [secondary]);
    const newPage = await createPage();
    assert.equal(newPage.ok, true);
    const pageVersion = await current(db, newPage.requestId);
    assert.deepEqual(pageVersion.photo_paths, [secondary]);
    assert.equal((await revise(db, newPage.requestId, {
        itemId: pageVersion.itemId, payload: legacyPage.payload, photoPath: primary,
    })).ok, true);
    assert.deepEqual((await current(db, newPage.requestId)).photo_paths, [primary]);
    assert.equal(stored.photo_path, primary);
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').endsWith(migration));
    assert.equal((await create(db)).ok, true);
    for (const invalid of [null, [primary, null], [primary, 'data:image/png;base64,bad'], [primary, 'javascript:alert(1)'], Array(11).fill(primary)]) {
        assert.equal((await create(db, { ...legacy, photoPaths: invalid })).code, 'invalid_request');
    }
    const full = await create(db, { ...legacy, photoPaths: [primary, secondary] });
    assert.equal(full.ok, true);
    await db.exec(migration);
    const multi = await current(db, full.requestId);
    assert.deepEqual(multi.photo_paths, [primary, secondary]);
    assert.equal(multi.photo_path, primary);
    await assert.rejects(db.query('update approval_item_versions set photo_paths=array[$1::text] where id=$2', [secondary, multi.versionId]), /immutable/);

    const key = 'approval-assets/' + full.requestId + '/11111111-1111-4111-8111-111111111111';
    const change = { itemId: multi.itemId, expectedVersionId: multi.versionId, payload: update };
    assert.equal((await revise(db, full.requestId, { ...change, photoPaths: [primary, key] })).code, 'invalid_request');
    const reservation = await call(db, "select reserve_approval_asset($1,$2,$3,'mockup','image/jpeg',250) result", [owner, full.requestId, multi.itemId]);
    assert.equal(reservation.ok, true);
    const photoPaths = [primary, String(reservation.objectKey)];
    assert.deepEqual(await revise(db, full.requestId, { ...change, photoPaths }), { ok: true, changed: true });
    assert.equal((await revise(db, full.requestId, { ...change, photoPaths: [] })).code, 'conflict');
    assert.deepEqual((await current(db, full.requestId)).photo_paths, photoPaths);
    const oldGallery = await db.query('select photo_paths from approval_item_versions where id=$1', [multi.versionId]);
    assert.deepEqual(oldGallery.rows[0], { photo_paths: [primary, secondary] });
    const retention = await call(db, 'select purge_gbp_approval_retention($1) result', ['2027-01-01T00:00:00Z']);
    assert.ok(!(retention.objectKeys as string[]).includes(reservation.objectKey));

    assert.equal((await revise(db, full.requestId, { itemId: multi.itemId, payload: update, photoPath: secondary })).ok, true);
    assert.deepEqual((await current(db, full.requestId)).photo_paths, [secondary, reservation.objectKey]);
    assert.equal((await revise(db, full.requestId, { itemId: multi.itemId, payload: update, photoPaths: [] })).ok, true);
    const removed = await current(db, full.requestId);
    assert.equal(removed.photo_path, null);
    assert.deepEqual(removed.photo_paths, []);
});

test('145 saves public and internal photo feedback against the reviewed GBP version', async t => {
    const db = await database();
    t.after(() => db.close());
    await db.exec('alter table public.bot_api_keys add column revoked_at timestamptz');
    await db.exec(readFileSync(new URL('../../migrations/144_approval_internal_review_links.sql', import.meta.url), 'utf8'));
    await db.exec(migration);
    const draft = await create(db, { ...legacy, photoPaths: [primary, secondary] });
    assert.equal(draft.ok, true);
    const requestId = draft.requestId;
    const reviewed = await current(db, requestId);
    const internalHash = hash('internal-gallery');
    assert.equal((await call(db, 'select issue_approval_internal_link($1,null,$2,null,$3,7,null,$4,$5) result',
        [owner, requestId, internalHash, org, now])).ok, true);
    const internalFeedback = (position: number) => call(db,
        "select submit_approval_internal_feedback($1,$2,$3,'Reviewer',null,'Use this one','photo-feedback',$4,$5) result",
        [internalHash, reviewed.itemId, reviewed.versionId, later, position]);
    assert.equal((await internalFeedback(3)).code, 'invalid_request');
    assert.equal((await internalFeedback(2)).ok, true);
    assert.equal((await internalFeedback(2)).idempotent, true);
    assert.equal((await internalFeedback(1)).code, 'idempotency_conflict');
    const internal = await call(db, 'select get_approval_internal_review($1,$2) result', [internalHash, later]);
    assert.match(JSON.stringify(internal.batches), /"photoPosition":2/);
    assert.match(JSON.stringify(internal.batches), /second\.jpg/);
    assert.match(JSON.stringify(internal.batches), /"offerStart":null/);

    const clientHash = hash('client-gallery');
    assert.equal((await call(db, 'select send_approval_request($1,$2,$3,$4,$5) result', [owner, requestId, clientHash, expiry, later])).ok, true);
    const notifications = await db.query('select count(*) from notifications');
    const submit = (position: number, versionId = reviewed.versionId, key = 'client-photo-feedback') =>
        call(db, 'select submit_gbp_approval($1,$2,null,$3) result', [clientHash, JSON.stringify({
            idempotencyKey: key, requestHash: hash(`${position}/${versionId}`), respondentName: 'Client reviewer',
            displayedVersionIds: [versionId], decisions: [], answers: [],
            comments: [{ itemId: reviewed.itemId, versionId, anchorKind: 'page', body: 'Use the other one', photoPosition: position }],
        }), later]);
    assert.equal((await submit(3)).code, 'invalid_request');
    assert.equal((await submit(2)).ok, true);
    assert.equal((await submit(2)).idempotent, true);
    assert.equal((await submit(1)).code, 'idempotency_conflict');
    assert.deepEqual((await db.query('select version_id, photo_position from approval_comments')).rows,
        [{ version_id: reviewed.versionId, photo_position: 2 }]);
    assert.deepEqual((await db.query('select count(*) from notifications')).rows, notifications.rows);
    assert.equal((await db.query<{ status: string }>('select status from tasks where id=$1', [task])).rows[0].status, 'todo');
    const review = await call(db, 'select get_approval_by_token($1,$2) result', [clientHash, later]);
    assert.match(JSON.stringify(review.items), /"photoPosition":2/);
    assert.match(JSON.stringify(review.items), /"photoPaths":\["https:\/\/drive/);
    const approved = await call(db, 'select submit_gbp_approval($1,$2,null,$3) result', [clientHash, JSON.stringify({
        idempotencyKey: 'approval-before-replace', requestHash: hash('approved'), respondentName: 'Client reviewer',
        displayedVersionIds: [reviewed.versionId], answers: [],
        decisions: [{ itemId: reviewed.itemId, versionId: reviewed.versionId, decision: 'approved' }],
    }), later]);
    assert.equal(approved.ok, true);
    const change = { itemId: reviewed.itemId, payload: update, photoPaths: [primary, 'https://example.com/third.jpg'] };
    assert.equal((await revise(db, requestId, change)).code, 'change_note_required');
    assert.deepEqual(await revise(db, requestId, { ...change, changeNote: 'Second photo replaced' }), { ok: true, changed: true });
    assert.equal((await db.query<{ status: string }>('select status from approval_items where id=$1', [reviewed.itemId])).rows[0].status, 'pending');
    assert.equal((await submit(2, reviewed.versionId, 'stale-photo-feedback')).code, 'refresh_required');
});
