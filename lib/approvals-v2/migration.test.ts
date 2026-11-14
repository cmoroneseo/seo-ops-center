import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { database, call, post, hash, org, owner, viewer, member, client, task, now, later, expiry } from './test-database.ts';
import { canonicalJson } from './registry.ts';

const migration = readFileSync(new URL('../../migrations/132_approvals_v2.sql', import.meta.url), 'utf8');
const page = {
    schemaVersion: 1, pageKind: 'city', title: 'Mesa ☀', metaTitle: 'Mesa', metaDescription: '', slug: 'services/mesa',
    body: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_1' }, content: [{ type: 'text', text: 'Hello' }] }] },
};
const outline = [{ sectionId: '_intro', slug: '', level: 0, title: '', hash: hash('section'), blocks: [{ blockId: 'b_1', kind: 'paragraph', hash: hash('block'), len: 5 }] }];
async function create(db: Awaited<ReturnType<typeof database>>, type = 'page', items: unknown[] = [{ position: 1, payload: page, outline }]) {
    return call(db, `select public.create_approval_request($1,$2,$3,$4,$5,'Review',null,'[]',$6::jsonb) result`, [owner, org, client, task, type, JSON.stringify(items)]);
}
async function send(db: Awaited<ReturnType<typeof database>>, id: unknown, actor = owner, legacy = false) {
    return call(db, `select public.${legacy ? 'issue_gbp_approval_link' : 'send_approval_request'}($1,$2,$3,$4,$5) result`, [actor, id, hash(String(id)), expiry, now]);
}

test('132 backfills linked v1 versions and bot drafts without changing public GBP output', async () => {
    const db = await database('131');
    try {
        const r = await call(db, `select public.create_gbp_approval_request($1,$2,$3,$4,'Before',null,'[]',$5::jsonb) result`, [owner, org, client, task, JSON.stringify([post('Before')])]);
        await send(db, r.requestId, owner, true);
        const item = (await db.query<{ id: string }>(`select id from approval_items where request_id=$1`, [r.requestId])).rows[0];
        await call(db, `select public.post_gbp_approval_version($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify([{ itemId: item.id, payload: post('After').payload, changeNote: 'Changed', source: 'manual' }]), now]);
        const before = await call(db, `select public.get_gbp_approval_by_token($1,$2) result`, [hash(String(r.requestId)), now]);
        const bot = await call(db, `select public.create_gbp_approval_request($1,$2,$3,$4,'Bot',null,'[]',$5::jsonb,'bot-backfill',$6) result`, [owner, org, client, task, JSON.stringify([post('Bot')]), hash('bot')]);
        await db.exec(migration);
        const after = await call(db, `select public.get_gbp_approval_by_token($1,$2) result`, [hash(String(r.requestId)), now]);
        assert.deepEqual(after, before);
        const rows = (await db.query<{ id: string; stage: string; sent_at: unknown; created_via: string; owner_id: string | null; sent_by: string }>(`select * from approval_requests order by title`)).rows;
        const linked = rows.find(row => row.id === r.requestId)!;
        assert.equal(linked.stage, 'sent'); assert.ok(linked.sent_at); assert.equal(linked.sent_by, owner); assert.equal(linked.owner_id, owner);
        const unlinked = rows.find(row => row.id === bot.requestId)!;
        assert.equal(unlinked.stage, 'draft'); assert.equal(unlinked.sent_at, null); assert.equal(unlinked.created_via, 'bot'); assert.equal(unlinked.owner_id, null);
        const versions = (await db.query<{ released: number; previous: number }>(`select v.version_no released,p.version_no previous from approval_items i join approval_item_versions v on v.id=i.released_version_id join approval_item_versions p on p.id=i.previous_released_version_id where i.id=$1`, [item.id])).rows[0];
        assert.deepEqual(versions, { released: 2, previous: 1 });
    } finally { await db.close(); }
});

test('draft edits do not release, reset, lock or bump; Send permissions and bot actor exclusion', async () => {
    const db = await database();
    try {
        const r = await create(db);
        assert.equal(r.ok, true);
        assert.equal((await db.query(`select * from approval_links`)).rows.length, 0);
        const item = (await db.query<{ id: string }>(`select id from approval_items`)).rows[0];
        const edited = await call(db, `select public.post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify([{ itemId: item.id, payload: { ...page, title: 'Edited' }, outline }]), now]);
        assert.equal(edited.ok, true);
        const state = (await db.query<{ round: number; stage: string; released_version_id: null; decision_locked_at: null }>(`select r.round,r.stage,i.released_version_id,i.decision_locked_at from approval_items i join approval_requests r on r.id=i.request_id`)).rows[0];
        assert.deepEqual(state, { round: 1, stage: 'draft', released_version_id: null, decision_locked_at: null });
        for (const actor of [member, viewer]) for (const legacy of [true, false]) assert.equal((await send(db, r.requestId, actor, legacy)).code, 'forbidden');
        await db.query(`insert into approval_bot_actors(user_id,label) values ($1,'Bot')`, [owner]);
        for (const legacy of [true, false]) assert.equal((await send(db, r.requestId, owner, legacy)).code, 'forbidden');
        assert.equal((await call(db, `select public.set_approval_owner($1,$2,$1) result`, [owner, r.requestId])).code, 'forbidden');
        await db.query(`update clients set account_manager_id=$1 where id=$2`, [member, client]);
        assert.equal((await send(db, r.requestId, member, true)).ok, true);
        const released = (await db.query<{ stage: string; same: boolean; previous_released_version_id: null }>(`select r.stage,i.current_version_id=i.released_version_id same,i.previous_released_version_id from approval_items i join approval_requests r on r.id=i.request_id`)).rows[0];
        assert.deepEqual(released, { stage: 'sent', same: true, previous_released_version_id: null });
    } finally { await db.close(); }
});

test('page type, limits, canonical hash parity and outline validation are enforced', async () => {
    const db = await database();
    try {
        assert.equal((await create(db, 'gbp_post')).ok, false);
        assert.equal((await create(db, 'page', [{ position: 1, itemType: 'gbp_post', payload: page, outline }])).ok, false);
        assert.equal((await create(db, 'page', [{ position: 1, payload: post('Wrong').payload }])).ok, false);
        assert.equal((await create(db, 'page', [{ position: 1, payload: { ...page, body: { type: 'doc', content: [{ text: 'a'.repeat(1048577) }] } } }])).ok, false);
        assert.equal((await create(db, 'page', [{ position: 1, payload: page, outline: [outline[0], outline[0]] }])).ok, false);
        for (const len of [undefined, -1, 1.5, '5', null, 2147483648]) {
            const invalidOutline = [{ ...outline[0], blocks: [{ ...outline[0].blocks[0], len }] }];
            assert.equal((await create(db, 'page', [{ position: 1, payload: page, outline: invalidOutline }])).ok, false, String(len));
        }
        const r = await create(db); assert.equal(r.ok, true);
        await assert.rejects(db.query(`insert into approval_items(organization_id,request_id,item_type,position) values($1,$2,'gbp_post',2)`, [org, r.requestId]));
        const canonical = (await db.query<{ value: string }>(`select approval_canonical_json($1) value`, [JSON.stringify(page.body)])).rows[0].value;
        assert.equal(canonical, canonicalJson(page.body));
        const stored = (await db.query<{ body_hash: string }>(`select body_hash from approval_item_versions`)).rows[0];
        assert.equal(stored.body_hash, hash(canonicalJson(page.body)));
    } finally { await db.close(); }
});

test('submit validates highlight, overlapping highlights, block/image pins, mockups and page comments atomically', async () => {
    const db = await database();
    try {
        const imageOutline = [{ ...outline[0], blocks: [...outline[0].blocks, { blockId: 'image', kind: 'image', hash: hash('image'), len: 0 }] }];
        const r = await create(db, 'page', [{ position: 1, payload: page, outline: imageOutline }]);
        const i = (await db.query<{ id: string; current_version_id: string }>(`select * from approval_items`)).rows[0];
        const asset = await call(db, `select reserve_approval_asset($1,$2,$3,'mockup','image/png',100) result`, [owner, r.requestId, i.id]);
        await call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify([{ itemId: i.id, payload: page, outline: imageOutline, photoPath: asset.objectKey }]), now]);
        await send(db, r.requestId);
        const versionId = (await db.query<{ released_version_id: string }>(`select released_version_id from approval_items where id=$1`, [i.id])).rows[0].released_version_id;
        const other = await create(db);
        const otherItem = (await db.query<{ id: string; current_version_id: string }>(`select * from approval_items where request_id=$1`, [other.requestId])).rows[0];
        const base = { itemId: i.id, versionId, body: 'Please review' };
        const highlight = { ...base, anchorKind: 'highlight', sectionId: '_intro', blockId: 'b_1', targetHash: hash('block'), rangeStart: 0, rangeEnd: 5, quote: 'Hello', quotePrefix: 'x'.repeat(64), quoteSuffix: 'y'.repeat(64), suggestedText: 'Hi' };
        const comments = [highlight, { ...highlight, rangeStart: 1, rangeEnd: 4, quote: 'ell' },
            { ...base, anchorKind: 'pin', pinTarget: 'block', sectionId: '_intro', blockId: 'image', targetHash: hash('image') },
            { ...base, anchorKind: 'pin', pinTarget: 'mockup', targetHash: hash(String(asset.objectKey)) }, { ...base, anchorKind: 'page' }];
        let n = 0;
        const submit = (cs: unknown[], suggestion?: unknown) => call(db, `select submit_approval($1,$2::jsonb,null,$3) result`, [hash(String(r.requestId)), JSON.stringify({
            idempotencyKey: `comment-${++n}`, requestHash: hash(String(n)), respondentName: 'Casey', displayedVersionIds: [versionId],
            decisions: [{ itemId: i.id, versionId, decision: 'changes_requested', ...(suggestion ? { suggestion } : {}) }], answers: [], comments: cs,
        }), now]);
        const badComments = [
            { ...base, anchorKind: 'field' }, { ...highlight, fieldKey: 'title' }, { ...highlight, blockId: 'invented' },
            { ...highlight, targetHash: hash('wrong') }, { ...highlight, rangeEnd: 6, quote: 'Hello!' },
            { ...highlight, quote: 'Hi' }, { ...highlight, itemId: otherItem.id }, { ...highlight, versionId: otherItem.current_version_id },
            { ...highlight, quotePrefix: 'x'.repeat(65) }, { ...highlight, rangeStart: 0.5 },
            { ...comments[2], rangeStart: 0 }, { ...comments[4], targetHash: hash('block') },
        ];
        for (const bad of badComments) {
            assert.equal((await submit([comments[4], bad])).ok, false, JSON.stringify(bad));
            // Keep rate limiting independent of the invalid-payload cases.
            await db.exec(`delete from approval_public_hits`);
        }
        for (const key of ['title', 'metaTitle', 'metaDescription', 'slug']) assert.equal((await submit([highlight], { [key]: 'No' })).code, 'invalid_request');
        assert.equal((await db.query(`select id from approval_submissions`)).rows.length, 0);
        assert.equal((await db.query(`select id from approval_comments`)).rows.length, 0);
        assert.equal((await db.query(`select id from approval_responses`)).rows.length, 0);
        assert.equal((await submit(comments)).ok, true);
        const detail = await call(db, `select get_approval_item_by_token($1,$2,$3) result`, [hash(String(r.requestId)), i.id, now]);
        const stored = detail.comments as Record<string, unknown>[];
        assert.equal(stored.length, 5);
        assert.ok(stored.every(c => c.carryState === 'unchanged'));
        assert.equal(stored[0].quote_hash, hash('Hello'));
        assert.equal(stored[0].quote_prefix, highlight.quotePrefix);
        assert.equal(stored[0].range_end, 5);
        assert.equal((await call(db, `select get_approval_item_by_token($1,$2,$3) result`, [hash(String(r.requestId)), owner, now])).code, 'out_of_scope');
        // A mockup pin requires a photo on that exact version.
        await send(db, other.requestId);
        const noPhoto = await call(db, `select submit_approval($1,$2::jsonb,null,$3) result`, [hash(String(other.requestId)), JSON.stringify({
            idempotencyKey: 'no-photo-pin', requestHash: hash('no-photo'), respondentName: 'Casey', displayedVersionIds: [otherItem.current_version_id], decisions: [],
            comments: [{ ...comments[3], itemId: otherItem.id, versionId: otherItem.current_version_id }],
        }), now]);
        assert.equal(noPhoto.code, 'invalid_request');
    } finally { await db.close(); }
});

test('resolution and reopening are staff-only, preserve immutable comments and record events', async () => {
    const db = await database();
    try {
        const r = await create(db); await send(db, r.requestId);
        const i = (await db.query<{ id: string; current_version_id: string }>(`select * from approval_items`)).rows[0];
        const c = (await db.query<{ id: string }>(`insert into approval_comments(organization_id,request_id,item_id,version_id,author_kind,author_name,anchor_kind,body) values($1,$2,$3,$4,'staff','Owner','page','Review') returning id`, [org, r.requestId, i.id, i.current_version_id])).rows[0];
        const resolve = (actor = owner, version: string | null = i.current_version_id) => call(db, `select resolve_approval_comment($1,$2,$3,$4) result`, [actor, c.id, version, now]);
        assert.equal((await resolve(viewer)).code, 'forbidden');
        await db.query(`insert into approval_bot_actors(user_id,label) values($1,'Bot')`, [member]);
        assert.equal((await resolve(member)).code, 'forbidden');
        const other = await create(db);
        const otherVersion = (await db.query<{ current_version_id: string }>(`select current_version_id from approval_items where request_id=$1`, [other.requestId])).rows[0].current_version_id;
        assert.equal((await resolve(owner, otherVersion)).ok, false);
        assert.equal((await resolve()).ok, true);
        assert.deepEqual((await db.query(`select resolved_by,resolved_in_version_id from approval_comments where id=$1`, [c.id])).rows[0], { resolved_by: owner, resolved_in_version_id: i.current_version_id });
        assert.equal((await call(db, `select reopen_approval_comment($1,$2,$3) result`, [member, c.id, later])).code, 'forbidden');
        assert.equal((await call(db, `select reopen_approval_comment($1,$2,$3) result`, [owner, c.id, later])).ok, true);
        assert.deepEqual((await db.query(`select resolved_at,resolved_by,resolved_in_version_id from approval_comments where id=$1`, [c.id])).rows[0], { resolved_at: null, resolved_by: null, resolved_in_version_id: null });
        assert.deepEqual((await db.query<{ kind: string }>(`select kind from approval_events where kind like 'comment_%' order by created_at`)).rows.map(x => x.kind), ['comment_resolved', 'comment_reopened']);
        for (const sql of [`update approval_comments set body='Changed'`, `update approval_comments set section_id='changed'`, `delete from approval_comments`]) await assert.rejects(db.exec(sql));
        assert.equal((await resolve(owner, null)).ok, true);
    } finally { await db.close(); }
});

test('archive handles drafts, revokes sent links; assets cannot cross request boundaries', async () => {
    const db = await database();
    try {
        const a = await create(db), b = await create(db);
        const asset = await call(db, `select public.reserve_approval_asset($1,$2,null,'mockup','image/png',100) result`, [owner, a.requestId]);
        assert.equal(asset.ok, true);
        const i = (await db.query<{ id: string }>(`select id from approval_items where request_id=$1`, [b.requestId])).rows[0];
        const edit = (photoPath: unknown) => call(db, `select public.post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, b.requestId, JSON.stringify([{ itemId: i.id, payload: page, outline, photoPath }]), now]);
        assert.equal((await edit(asset.objectKey)).ok, false);
        const own = await call(db, `select public.reserve_approval_asset($1,$2,$3,'mockup','image/png',100) result`, [owner, b.requestId, i.id]);
        assert.equal((await edit(own.objectKey)).ok, true);
        const archive = (id: unknown, undo = false) => call(db, `select public.${undo ? 'unarchive' : 'archive'}_approval_request($1,$2,$3) result`, [owner, id, later]);
        assert.equal((await archive(a.requestId)).ok, true);
        assert.equal((await send(db, a.requestId)).code, 'archived');
        assert.equal((await archive(a.requestId, true)).ok, true);
        assert.equal((await send(db, b.requestId)).ok, true);
        await archive(b.requestId);
        assert.equal((await call(db, `select public.get_approval_by_token($1,$2) result`, [hash(String(b.requestId)), later])).state, 'revoked');
        await archive(b.requestId, true);
        assert.equal((await call(db, `select public.get_approval_by_token($1,$2) result`, [hash(String(b.requestId)), later])).state, 'revoked');
    } finally { await db.close(); }
});

test('all 132 functions and tables are private; member SELECT is scoped', async () => {
    const db = await database();
    try {
        const names = [...migration.matchAll(/create or replace function public\.(\w+)\(/g)].map(m => m[1]);
        for (const role of ['anon', 'authenticated']) {
            const grants = await db.query<{ name: string }>(`select proname name from pg_proc where pronamespace='public'::regnamespace and proname=any($1::text[]) and has_function_privilege($2,oid,'EXECUTE')`, [names, role]);
            assert.deepEqual(grants.rows, []);
        }
        await create(db);
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role}`);
            await assert.rejects(db.query(`select * from approval_bot_actors`));
            if (role === 'anon') for (const table of ['approval_comments', 'approval_assets']) await assert.rejects(db.query(`select * from ${table}`));
            else for (const table of ['approval_comments', 'approval_assets']) assert.equal((await db.query(`select * from ${table}`)).rows.length, 0);
            await db.exec('reset role');
        }
    } finally { await db.close(); }
});

test('draft patch reorders/removes/adds items atomically; sent identity and immutable versions stay protected', async () => {
    const db = await database();
    try {
        const r = await create(db, 'page', [{ position: 1, payload: page, outline }, { position: 2, payload: page, outline }]);
        const ids = (await db.query<{ id: string }>(`select id from approval_items order by position`)).rows.map(x => x.id);
        const patch = (value: unknown) => call(db, `select update_approval_draft($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify(value), now]);
        assert.equal((await patch({ title: 'Reordered', itemOrder: ids.toReversed(), questions: [{ prompt: 'When?', itemPosition: 1 }] })).ok, true);
        assert.deepEqual((await db.query<{ id: string }>(`select id from approval_items order by position`)).rows.map(x => x.id), ids.toReversed());
        assert.equal((await patch({ title: 'Must roll back', removeItemIds: [owner] })).code, 'out_of_scope');
        assert.equal((await db.query<{ title: string }>(`select title from approval_requests`)).rows[0].title, 'Reordered');
        assert.equal((await patch({ removeItemIds: [ids[0]], items: [{ payload: page, outline }] })).ok, true);
        assert.equal((await db.query(`select id from approval_items`)).rows.length, 2);
        assert.equal((await send(db, r.requestId)).ok, true);
        assert.equal((await patch({ title: 'No' })).code, 'not_draft');
        await assert.rejects(db.query(`delete from approval_items where id=$1`, [ids[1]]));
        await assert.rejects(db.query(`update approval_items set position=50 where id=$1`, [ids[1]]));
        await assert.rejects(db.query(`update approval_item_versions set payload=payload`));
        await assert.rejects(db.query(`delete from approval_item_versions`));
    } finally { await db.close(); }
});

test('every visible page revision resets approval; anchor ids and staff keyword do not', async () => {
    const db = await database();
    try {
        const r = await create(db); await send(db, r.requestId);
        const i = (await db.query<{ id: string; released_version_id: string }>(`select * from approval_items`)).rows[0];
        const first = i.released_version_id;
        assert.equal((await call(db, `select submit_approval($1,$2::jsonb,null,$3) result`, [hash(String(r.requestId)), JSON.stringify({
            idempotencyKey: 'page-approved', requestHash: hash('approved'), respondentName: 'Casey', displayedVersionIds: [first], decisions: [{ itemId: i.id, versionId: first, decision: 'approved' }],
        }), now])).ok, true);
        const edit = (payload: unknown) => call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify([{ itemId: i.id, payload, outline, changeNote: 'Revision' }]), later]);
        const same = { ...page, targetKeyword: 'staff-only', body: { ...page.body, content: [{ ...page.body.content[0], attrs: { blockId: 'b_renamed' } }] } };
        assert.equal((await edit(same)).changed, false);
        assert.equal((await db.query<{ status: string }>(`select status from approval_items`)).rows[0].status, 'approved');
        const revised = { ...same, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }] }] } };
        assert.equal((await edit(revised)).changed, true);
        const state = (await db.query<{ status: string; round: number; locked: unknown; previous: number }>(`select i.status,r.round,i.decision_locked_at locked,p.version_no previous from approval_items i join approval_requests r on r.id=i.request_id join approval_item_versions p on p.id=i.previous_released_version_id`)).rows[0];
        assert.deepEqual(state, { status: 'pending', round: 2, locked: null, previous: 2 });
    } finally { await db.close(); }
});

test('asset images are request-scoped, and retention only removes acknowledged unreferenced old assets', async () => {
    const db = await database();
    try {
        const a = await create(db), b = await create(db);
        const reserve = (id: unknown) => call(db, `select reserve_approval_asset($1,$2,null,'doc_image','image/png',100) result`, [owner, id]);
        const old = await reserve(a.requestId), used = await reserve(a.requestId), fresh = await reserve(a.requestId);
        const i = (await db.query<{ id: string }>(`select id from approval_items where request_id=$1`, [a.requestId])).rows[0];
        const imagePayload = { ...page, body: { type: 'doc', content: [{ type: 'image', attrs: { src: used.objectKey } }] } };
        assert.equal((await call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, a.requestId, JSON.stringify([{ itemId: i.id, payload: imagePayload, outline }]), now])).ok, true);
        const j = (await db.query<{ id: string }>(`select id from approval_items where request_id=$1`, [b.requestId])).rows[0];
        assert.equal((await call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, b.requestId, JSON.stringify([{ itemId: j.id, payload: imagePayload, outline }]), now])).ok, false);
        await db.query(`update approval_assets set created_at='2026-10-01' where object_key=any($1::text[])`, [[old.objectKey, used.objectKey]]);
        const selected = await call(db, `select purge_gbp_approval_retention($1) result`, [now]);
        assert.deepEqual(selected.objectKeys, [old.objectKey]);
        assert.equal(selected.orphansDeleted, 0);
        const purged = await call(db, `select purge_gbp_approval_retention($1,$2::text[]) result`, [now, [old.objectKey, used.objectKey, fresh.objectKey]]);
        assert.equal(purged.orphansDeleted, 1);
        assert.equal((await db.query(`select id from approval_assets`)).rows.length, 2);
    } finally { await db.close(); }
});

test('generic bot creation records key and actor, creates no link, and replay creates no duplicate notification', async () => {
    const db = await database();
    try {
        await db.query(`insert into bot_api_keys(id,organization_id) values($1,$2)`, [member, org]);
        await db.query(`insert into approval_bot_actors(user_id,label) values($1,'Writer')`, [member]);
        const createBot = () => call(db, `select create_approval_request($1,$2,$3,$4,'gbp_post','Bot',null,'[]',$5::jsonb,'bot',$1,'bot-generic',$6) result`, [member, org, client, task, JSON.stringify([post('Bot post')]), hash('unchanged-v1-command')]);
        const first = await createBot(); assert.equal(first.ok, true);
        assert.equal((await createBot()).requestId, first.requestId);
        const row = (await db.query<{ created_via: string; owner_id: null; bot_key_id: string; stage: string }>(`select created_via,owner_id,bot_key_id,stage from approval_requests`)).rows[0];
        assert.deepEqual(row, { created_via: 'bot', owner_id: null, bot_key_id: member, stage: 'draft' });
        assert.equal((await db.query(`select id from approval_links`)).rows.length, 0);
        assert.equal((await db.query(`select id from notifications where type='approval_draft_ready'`)).rows.length, 1);
        assert.equal((await send(db, first.requestId, member)).code, 'forbidden');
    } finally { await db.close(); }
});

test('asset SELECT policy exposes only members’ organizations', async () => {
    const db = await database();
    try {
        const r = await create(db);
        await call(db, `select reserve_approval_asset($1,$2,null,'mockup','image/png',10) result`, [owner, r.requestId]);
        await db.exec(`select set_config('test.org','22222222-2222-4222-8222-222222222222',false); set role authenticated;`);
        assert.equal((await db.query(`select * from approval_assets`)).rows.length, 0);
        await db.exec(`reset role; select set_config('test.org','${org}',false); set role authenticated;`);
        assert.equal((await db.query(`select * from approval_assets`)).rows.length, 1);
        await assert.rejects(db.query(`delete from approval_assets`));
        await db.exec('reset role');
    } finally { await db.close(); }
});

test('SQL carry keeps original quote data and returns only exact block, section and image fallbacks', async () => {
    const db = await database();
    try {
        const photo = 'https://example.com/mockup.png';
        const r = await create(db, 'page', [{ position: 1, payload: page, outline, photoPath: photo }]);
        await send(db, r.requestId);
        const i = (await db.query<{ id: string; current_version_id: string }>(`select * from approval_items`)).rows[0];
        const root = (await db.query<{ id: string }>(`insert into approval_comments(organization_id,request_id,item_id,version_id,author_kind,author_name,anchor_kind,section_id,block_id,target_hash,range_start,range_end,quote,quote_hash,quote_prefix,quote_suffix,body)
            values($1,$2,$3,$4,'staff','Owner','highlight','_intro','b_1',$5,1,3,'☀🙂',$6,'before','after','Review') returning id`, [org, r.requestId, i.id, i.current_version_id, hash('block'), hash('☀🙂')])).rows[0];
        await assert.rejects(db.query(`insert into approval_comments(organization_id,request_id,item_id,version_id,author_kind,author_name,anchor_kind,section_id,block_id,target_hash,range_start,range_end,quote,quote_hash,body)
            values($1,$2,$3,$4,'staff','Owner','highlight','_intro','b_1',$5,1,3,'☀🙂',$5,'Bad hash')`, [org, r.requestId, i.id, i.current_version_id, hash('block')]));
        await db.query(`insert into approval_comments(organization_id,request_id,item_id,version_id,author_kind,author_name,anchor_kind,pin_target,target_hash,body)
            values($1,$2,$3,$4,'staff','Owner','pin','mockup',$5,'Image')`, [org, r.requestId, i.id, i.current_version_id, hash(photo)]);
        await db.query(`insert into approval_comments(organization_id,request_id,item_id,version_id,parent_id,author_kind,author_name,anchor_kind,body)
            values($1,$2,$3,$4,$5,'staff','Owner','page','Reply')`, [org, r.requestId, i.id, i.current_version_id, root.id]);
        await assert.rejects(db.query(`update approval_comments set quote='XY' where id=$1`, [root.id]));
        const read = async () => (await call(db, `select get_approval_item_by_token($1,$2,$3) result`, [hash(String(r.requestId)), i.id, now])).comments as Record<string, unknown>[];
        let revision = 0;
        const revise = async (nextOutline: unknown, photoPath = photo) => {
            const payload = { ...page, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Revision ${++revision}` }] }] } };
            assert.equal((await call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, r.requestId, JSON.stringify([{ itemId: i.id, payload, outline: nextOutline, photoPath, changeNote: 'Updated content' }]), now])).ok, true);
        };
        assert.equal((await read())[0].carryState, 'unchanged');
        await revise([{ ...outline[0], blocks: [{ ...outline[0].blocks[0], hash: hash('changed') }] }]);
        assert.equal((await read())[0].carryState, 'text_changed');
        // Hash elsewhere never causes a SQL "moved" state; 1D owns re-matching.
        await revise([{ ...outline[0], blocks: [{ ...outline[0].blocks[0], blockId: 'replacement' }] }]);
        let carried = await read();
        assert.equal(carried[0].carryState, 'text_changed');
        assert.equal(carried[0].carrySectionId, '_intro');
        assert.equal(carried[0].quote, '☀🙂');
        assert.equal(carried[0].range_start, 1);
        assert.equal(carried[0].range_end, 3);
        assert.equal(carried[0].quote_prefix, 'before');
        assert.equal(carried[0].quote_suffix, 'after');
        await revise([], 'https://example.com/new.png');
        carried = await read();
        assert.equal(carried[0].carryState, 'earlier');
        assert.equal(carried[1].carryState, 'image_changed');
        assert.equal(carried[2].carryState, 'earlier');
        // Resolution after a newer release still updates the original version's comment.
        assert.equal((await call(db, `select resolve_approval_comment($1,$2,null,$3) result`, [owner, root.id, now])).ok, true);
    } finally { await db.close(); }
});

test('GBP accepts only page comments and preserves v1 title/body suggestions', async () => {
    const db = await database();
    try {
        const r = await create(db, 'gbp_post', [post('GBP')]); await send(db, r.requestId);
        const i = (await db.query<{ id: string; current_version_id: string }>(`select * from approval_items`)).rows[0];
        let n = 0;
        const submit = (anchorKind: string) => call(db, `select submit_approval($1,$2::jsonb,null,$3) result`, [hash(String(r.requestId)), JSON.stringify({
            idempotencyKey: `gbp-comment-${++n}`, requestHash: hash(String(n)), respondentName: 'Casey', displayedVersionIds: [i.current_version_id],
            decisions: [{ itemId: i.id, versionId: i.current_version_id, decision: 'changes_requested', comment: 'Change title', suggestedTitle: 'New title', suggestedBody: 'New body' }],
            comments: [{ itemId: i.id, versionId: i.current_version_id, anchorKind, body: 'Review' }],
        }), now]);
        assert.equal((await submit('highlight')).code, 'invalid_request');
        assert.equal((await submit('pin')).code, 'invalid_request');
        assert.equal((await submit('page')).ok, true);
        assert.deepEqual((await db.query(`select suggestion from approval_responses`)).rows[0].suggestion, { title: 'New title', body: 'New body' });
    } finally { await db.close(); }
});

test('schema mirror includes exactly migration 132 and the removed field hash is absent', async () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.equal(schema.split('-- Migration 132: Approvals v2\n')[1], migration);
    const db = await database();
    try {
        assert.equal((await db.query(`select oid from pg_proc where proname='approval_field_hash'`)).rows.length, 0);
    } finally { await db.close(); }
});
