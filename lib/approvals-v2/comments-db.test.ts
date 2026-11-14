import assert from 'node:assert/strict';
import test from 'node:test';
import { database, call, hash, org, owner, viewer, client, task, now, expiry } from './test-database.ts';
import { parsePagePayload } from './page-body.ts';
import { highlightAnchor } from './carry.ts';
import { applyCommentSuggestion } from './apply-comment.ts';
const parsed = parsePagePayload({ schemaVersion: 1, pageKind: 'blog', title: 'Page', metaTitle: 'Title', metaDescription: 'Description', slug: 'page', body: { format: 'markdown', text: '## Start\n\nHello 😀 world.\n\n![Kitchen](https://example.com/current.jpg)' } });
if (!parsed.ok)
  throw new Error(parsed.error);
const page = parsed.payload;
test('PAGE comments, superseding replacements, accept next draft only, release, reopen, and decline through PGlite', async () => {
  const db = await database();
  try {
    const created = await call(db, `select create_approval_request($1,$2,$3,$4,'page','Pages',null,'[]',$5::jsonb) result`, [owner, org, client, task, JSON.stringify([{ position: 1, payload: page, outline: parsed.outline }])]);
    const requestId = created.requestId;
    const token = hash(String(requestId));
    const item = (await db.query<{
      id: string;
      current_version_id: string;
    }>('select id,current_version_id from approval_items where request_id=$1', [requestId])).rows[0];
    const versionId = item.current_version_id;
    await call(db, 'select send_approval_request($1,$2,$3,$4,$5) result', [owner, requestId, token, expiry, now]);
    const textBlock = parsed.outline[0].blocks[1];
    const anchor = highlightAnchor((page.body.content as never[])[1], textBlock.hash, 6, 7);
    let sequence = 0;
    async function submit(comments: unknown[], verified: string[] = []) {
      await db.query("delete from approval_public_hits where token_hash=$1 and action='submit'", [token]);
      return call(db, 'select submit_approval($1,$2::jsonb,null,$3) result', [token, JSON.stringify({ idempotencyKey: `comments-${++sequence}`, requestHash: hash(String(sequence)), respondentName: 'Casey', displayedVersionIds: [versionId], decisions: [{ itemId: item.id, versionId, decision: 'changes_requested' }], comments, verifiedReservationIds: verified }), now]);
    }
    const textComment = { ...anchor, itemId: item.id, versionId, body: 'Please use this wording', suggestedText: 'beautiful' };
    assert.equal((await submit([{ ...textComment, anchorKind: 'field', fieldKey: 'metaTitle' }])).ok, false);
    assert.equal((await submit([textComment])).ok, true);
    const comment = (await db.query<{
      id: string;
    }>('select id from approval_comments where suggested_text is not null')).rows[0];
    const edited = applyCommentSuggestion(page.body, parsed.outline, anchor, 'beautiful');
    assert.equal((await call(db, 'select accept_approval_suggestion($1,$2,$3::jsonb,null,$4,$5::jsonb,$6) result', [viewer, comment.id, JSON.stringify({ ...page, body: edited.body }), now, JSON.stringify(edited.outline), versionId])).code, 'forbidden');
    assert.equal((await call(db, 'select accept_approval_suggestion($1,$2,$3::jsonb,null,$4,$5::jsonb,$6) result', [owner, comment.id, JSON.stringify({ ...page, body: edited.body }), now, JSON.stringify(edited.outline), versionId])).ok, true);
    let saved = (await db.query<{
      current_version_id: string;
      released_version_id: string;
    }>('select current_version_id,released_version_id from approval_items where id=$1', [item.id])).rows[0];
    assert.notEqual(saved.current_version_id, versionId);
    assert.equal(saved.released_version_id, versionId);
    const addressed = (await db.query<{
      suggestion_status: string;
      resolved_in_version_id: string;
    }>('select suggestion_status,resolved_in_version_id from approval_comments where id=$1', [comment.id])).rows[0];
    assert.equal(addressed.suggestion_status, 'accepted');
    assert.equal(addressed.resolved_in_version_id, saved.current_version_id);
    assert.equal((await call(db, 'select reopen_approval_comment($1,$2,$3) result', [owner, comment.id, now])).ok, true);
    assert.equal((await call(db, 'select decline_approval_suggestion($1,$2,$3,$4) result', [owner, comment.id, 'We will keep this wording.', now])).ok, true);
    const declined = (await db.query<{
      suggestion_status: string;
      suggestion_reply: string;
    }>('select suggestion_status,suggestion_reply from approval_comments where id=$1', [comment.id])).rows[0];
    assert.equal(declined.suggestion_status, 'declined');
    assert.equal(declined.suggestion_reply, 'We will keep this wording.');
    const imageBlock = parsed.outline[0].blocks[2];
    async function replacement() {
      const reserved = await call(db, 'select reserve_approval_image_upload($1,$2,$3,$4,$5,$6) result', [token, item.id, versionId, 'image/heic', 100, now]);
      assert.equal(reserved.ok, true);
      assert.equal((await call(db, 'select set_approval_upload_preview($1,$2) result', [reserved.reservationId, `${reserved.objectKey}.preview.jpg`])).ok, true);
      return { id: String(reserved.reservationId), key: String(reserved.objectKey) };
    }
    const pin = { itemId: item.id, versionId, anchorKind: 'pin', pinTarget: 'block', blockId: imageBlock.blockId, sectionId: parsed.outline[0].sectionId, targetHash: imageBlock.hash, body: '' };
    const first = await replacement();
    assert.equal((await submit([{ ...pin, suggestedImageReservationId: first.id }])).ok, false, 'unverified upload rejected');
    assert.equal((await submit([{ ...pin, suggestedImageReservationId: first.id }], [first.id])).ok, true);
    const second = await replacement();
    assert.equal((await submit([{ ...pin, suggestedImageReservationId: second.id }], [second.id])).ok, true);
    const images = (await db.query<{
      id: string;
      suggested_image_key: string;
      suggestion_status: string;
    }>('select id,suggested_image_key,suggestion_status from approval_comments where suggested_image_key is not null order by suggested_image_key')).rows;
    assert.equal(images.find(comment => comment.suggested_image_key === first.key)?.suggestion_status, 'superseded');
    const pending = images.find(comment => comment.suggested_image_key === second.key)!;
    assert.equal(pending.suggestion_status, 'pending');
    const imageEdit = applyCommentSuggestion(edited.body, edited.outline, { ...pin, anchorKind: 'pin', pinTarget: 'block' }, null, second.key);
    assert.equal((await call(db, 'select accept_approval_suggestion($1,$2,$3::jsonb,null,$4,$5::jsonb,$6) result', [owner, pending.id, JSON.stringify({ ...page, body: imageEdit.body }), now, JSON.stringify(imageEdit.outline), saved.current_version_id])).ok, true);
    assert.equal((await db.query('select released_version_id from approval_items where id=$1', [item.id])).rows[0].released_version_id, versionId);
    assert.equal((await call(db, 'select release_approval_revision($1,$2,$3) result', [owner, requestId, now])).ok, true);
    saved = (await db.query<{
      current_version_id: string;
      released_version_id: string;
    }>('select current_version_id,released_version_id from approval_items where id=$1', [item.id])).rows[0];
    assert.equal(saved.current_version_id, saved.released_version_id);
    assert.equal((await db.query('select count(*) from approval_comments')).rows[0].count, 3);
  }
  finally {
    await db.close();
  }
});
