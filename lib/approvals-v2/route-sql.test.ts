import assert from 'node:assert/strict';
import test from 'node:test';
import { mutation } from './staff';
import { createIssueLink } from '../gbp-approvals/issue-link-route';
import { createExtendLink } from '../gbp-approvals/extend-link-route';
import { createRevokeLink } from '../gbp-approvals/revoke-link-route';
import type { createAdminClient } from '../supabase/admin';
import { database, call, post, org, owner, member, viewer, client, task } from './test-database';
test('staff HTTP actions execute the actual 132 contracts and Send gates without a remote database', async () => {
  const db = await database();
  try {
    const created = await call(db, `select create_approval_request($1,$2,$3,$4,'gbp_post','Draft',null,'[]',$5::jsonb) result`, [owner, org, client, task, JSON.stringify([post('Draft')])]);
    const id = String(created.requestId);
    const context = {
      params: Promise.resolve({
        id
      })
    };
    const item = (await db.query<{
      id: string;
    }>('select id from approval_items where request_id=$1', [id])).rows[0];
    const clientFactory = () => ({
      rpc: async (name: string, args: Record<string, unknown>) => {
        const entries = Object.entries(args);
        const cast = (key: string) => key === 'p_items' || key === 'p_patch' ? 'jsonb' : key === 'p_now' || key === 'p_expires_at' ? 'timestamptz' : key === 'p_token_hash' ? 'text' : 'uuid';
        const sql = `select public.${name}(${entries.map(([key], index) => `${key}=>$${index + 1}::${cast(key)}`).join(',')}) result`;
        const values = entries.map(([key, value]) => cast(key) === 'jsonb' ? JSON.stringify(value) : value);
        return {
          data: await call(db, sql, values),
          error: null
        };
      }
    }) as unknown as ReturnType<typeof createAdminClient>;
    const request = (body: unknown = {}) => new Request('https://local.test/action', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    const run = (action: string, actor = owner, body: unknown = {}) => mutation(action, {
      agencyActor: async () => actor,
      createAdminClient: clientFactory
    })(request(body), context);
    assert.equal((await run('draft', owner, {
      title: 'Edited draft'
    })).status, 200);
    assert.equal((await run('versions', owner, {
      items: [{
        itemId: item.id,
        payload: post('Edited body').payload
      }]
    })).status, 200);
    assert.equal((await run('owner', owner, {
      ownerId: member
    })).status, 200);
    assert.equal((await run('send', member)).status, 403);
    assert.equal((await run('send', viewer)).status, 403);
    const issueAsMember = createIssueLink({
      agencyActor: async () => member,
      createAdminClient: clientFactory
    });
    assert.equal((await issueAsMember(request(), context)).status, 403);
    await db.query('update clients set account_manager_id=$1 where id=$2', [member, client]);
    const sent = await run('send', member);
    assert.equal(sent.status, 200);
    assert.match((await sent.json()).url, /\/r\//);
    assert.equal((await run('send')).status, 409);
    const deps = {
      agencyActor: async () => owner,
      createAdminClient: clientFactory
    };
    assert.equal((await createExtendLink(deps)(request(), context)).status, 200);
    assert.equal((await createRevokeLink(deps)(request(), context)).status, 200);
    assert.equal((await createIssueLink(deps)(request(), context)).status, 200);
    // A client decision is a prerequisite for Mark final.
    await db.query(`update approval_items set status='approved' where id=$1`, [item.id]);
    assert.equal((await run('final', owner, {
      itemId: item.id
    })).status, 200);
    assert.equal((await run('archive')).status, 200);
    assert.ok((await db.query<{
      archived_at: string;
    }>('select archived_at from approval_requests where id=$1', [id])).rows[0].archived_at);
    assert.equal((await run('unarchive')).status, 200);
    assert.equal((await db.query<{
      archived_at: string | null;
    }>('select archived_at from approval_requests where id=$1', [id])).rows[0].archived_at, null);
  } finally {
    await db.close();
  }
});
