import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { assignee, call, client, database, expiry, hash, later, member, now, org, owner, post, task } from './test-database.ts';

const migration = readFileSync(new URL('../../migrations/146_gbp_comment_only_notifications.sql', import.meta.url), 'utf8');
const tokenHash = hash('public-gbp-review');
const title = 'Holiday hours';
const respondentName = 'Client reviewer';
const comment = 'Use the daytime photo.';
const replayTime = '2026-11-21T17:00:00.000Z';
type Db = Awaited<ReturnType<typeof database>>;

async function setup(t: TestContext) {
    const db = await database();
    t.after(() => db.close());
    await db.exec('alter table public.bot_api_keys add column revoked_at timestamptz');
    for (const filename of ['144_approval_internal_review_links.sql', '145_gbp_approval_multi_photo.sql']) {
        await db.exec(readFileSync(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8'));
    }
    await db.exec(migration);
    return db;
}

async function draft(db: Db, questions: { prompt: string }[] = []) {
    const result = await call(db, "select create_approval_request($1,$2,$3,$4,'gbp_post',$5,null,$6,$7) result",
        [owner, org, client, task, title, JSON.stringify(questions), JSON.stringify([post(title)])]);
    assert.equal(result.ok, true);
    const requestId = String(result.requestId);
    const { rows: [item] } = await db.query<{ itemId: string; versionId: string }>(
        'select id "itemId", current_version_id "versionId" from approval_items where request_id=$1', [requestId]);
    return { requestId, item };
}

async function send(db: Db, requestId: string) {
    assert.equal((await call(db, 'select send_approval_request($1,$2,$3,$4,$5) result',
        [owner, requestId, tokenHash, expiry, now])).ok, true);
}

function submit(db: Db, idempotencyKey: string, versionId: string, feedback: Record<string, unknown>, at = later,
    rpc: 'submit_approval' | 'submit_gbp_approval' = 'submit_gbp_approval') {
    return call(db, `select ${rpc}($1,$2,null,$3) result`, [tokenHash, JSON.stringify({
        idempotencyKey, requestHash: hash(idempotencyKey), respondentName, displayedVersionIds: [versionId],
        decisions: [], answers: [], ...feedback,
    }), at]);
}

async function taskState(db: Db) {
    return (await db.query('select status, status_history, due_date from tasks where id=$1', [task])).rows[0];
}

async function events(db: Db, requestId: string) {
    return (await db.query('select kind, detail from approval_events where request_id=$1 order by created_at, id', [requestId])).rows;
}

async function notifications(db: Db) {
    return (await db.query('select organization_id, user_id, type, title, body, entity_type, entity_id, client_id from notifications order by user_id')).rows;
}

test('146 notifies only organization owners and task assignees for comment-only GBP reviews, once across replays', async t => {
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration));
    const db = await setup(t);
    const { requestId, item } = await draft(db);
    assert.equal((await call(db, 'select set_approval_owner($1,$2,$3) result', [owner, requestId, member])).ok, true);
    const secondOwner = '33333333-3333-4333-8333-333333333333';
    await db.query("insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')", [org, secondOwner]);
    await db.query('update tasks set assignee_ids=array[$1::uuid,$2::uuid] where id=$3', [assignee, owner, task]);
    await send(db, requestId);
    const before = await taskState(db);
    const originalEvents = await events(db, requestId);
    const feedback = { comments: [{ ...item, anchorKind: 'page', body: comment, photoPosition: 1 }] };
    const result = await submit(db, 'comment-only', item.versionId, feedback);
    assert.deepEqual(result, {
        ok: true, idempotent: false, submissionId: result.submissionId, taskAdvanced: false,
        summary: { approved: 0, changesRequested: 0, pending: 1, questionsAnswered: 0, questionsTotal: 0 },
    });
    const replay = await submit(db, 'comment-only', item.versionId, feedback, replayTime);
    assert.deepEqual(replay, { ok: true, idempotent: true, submissionId: result.submissionId });
    assert.deepEqual(await notifications(db), [owner, secondOwner, assignee].sort().map(userId => ({
        organization_id: org, user_id: userId, type: 'gbp_approval_response', title: 'A client sent a review',
        body: `${respondentName} sent a review of ${title}. 0 approved, 0 changes requested.`,
        entity_type: 'gbp_approval_request', entity_id: requestId, client_id: client,
    })));
    assert.deepEqual((await db.query('select body, version_id, photo_position, submission_id from approval_comments')).rows,
        [{ body: comment, version_id: item.versionId, photo_position: 1, submission_id: result.submissionId }]);
    assert.deepEqual((await db.query('select stage, updated_at from approval_requests where id=$1', [requestId])).rows,
        [{ stage: 'sent', updated_at: new Date(later) }]);
    assert.deepEqual(await taskState(db), before);
    assert.deepEqual(await events(db, requestId), originalEvents);
});

test('146 comment-only reviews keep the task in todo after approval while answers can advance it', async t => {
    const db = await setup(t);
    const { requestId, item } = await draft(db, [{ prompt: 'When should this go live?' }]);
    await send(db, requestId);
    const approved = await submit(db, 'approve-post', item.versionId, { decisions: [{ ...item, decision: 'approved' }] });
    assert.equal(approved.taskAdvanced, true);
    await db.query("update tasks set status='todo' where id=$1", [task]);
    const before = await taskState(db);
    const originalEvents = await events(db, requestId);
    const previousNotifications = (await notifications(db)).length;
    const { rows: [{ id: questionId }] } = await db.query<{ id: string }>('select id from approval_questions where request_id=$1', [requestId]);

    const commentOnly = await submit(db, 'comment-after-approval', item.versionId, {
        comments: [{ ...item, anchorKind: 'page', body: comment }],
        answers: [{ questionId, answer: ' ' }],
    }, replayTime, 'submit_approval');
    assert.equal(commentOnly.ok, true);
    assert.equal(commentOnly.taskAdvanced, false);
    assert.deepEqual(commentOnly.summary, { approved: 1, changesRequested: 0, pending: 0, questionsAnswered: 0, questionsTotal: 1 });
    assert.deepEqual(await taskState(db), before);
    assert.deepEqual(await events(db, requestId), originalEvents);
    const notes = await notifications(db);
    assert.equal(notes.length, previousNotifications + 2);
    assert.deepEqual(notes.filter(note => note.type === 'approval_request_response'), [owner, assignee].sort().map(userId => ({
        organization_id: org, user_id: userId, type: 'approval_request_response', title: 'A client sent a review',
        body: `${respondentName} sent a review of ${title}. 1 approved, 0 changes requested.`,
        entity_type: 'approval_request', entity_id: requestId, client_id: client,
    })));

    const answered = await submit(db, 'answer-question', item.versionId, {
        answers: [{ questionId, answer: 'Friday morning' }],
    }, replayTime);
    assert.equal(answered.taskAdvanced, true);
    assert.equal((await events(db, requestId)).filter(event => event.kind === 'task_advanced').length, 2);
});

test('146 keeps internal GBP feedback private and leaves requests, items, events, and tasks untouched', async t => {
    const db = await setup(t);
    const { requestId, item } = await draft(db);
    const internalHash = hash('internal-gbp-review');
    assert.equal((await call(db, 'select issue_approval_internal_link($1,null,$2,null,$3,7,null,$4,$5) result',
        [owner, requestId, internalHash, org, now])).ok, true);
    const snapshot = async () => ({
        requests: (await db.query('select * from approval_requests where id=$1', [requestId])).rows,
        items: (await db.query('select * from approval_items where request_id=$1', [requestId])).rows,
        task: await taskState(db),
        events: await events(db, requestId),
        notifications: await notifications(db),
    });
    const before = await snapshot();
    const feedback = await call(db, "select submit_approval_internal_feedback($1,$2,$3,'Staff reviewer',null,$4,'internal-comment',$5,1) result",
        [internalHash, item.itemId, item.versionId, comment, later]);
    assert.equal(feedback.ok, true);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.query('select comment, photo_position from approval_internal_feedback')).rows,
        [{ comment, photo_position: 1 }]);
});
