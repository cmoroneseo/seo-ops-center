import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgencyActor } from '../gbp-approvals/agency-auth';
import { mutation, sqlStatus, listRequests } from './staff';
import { GET as detail } from './detail';
import type { createAdminClient } from '../supabase/admin';
import { frozenApprovalWrite, frozenDocDrift } from './frozen';
import { readFileSync } from 'node:fs';
const context = {
  params: Promise.resolve({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  })
};
const bot = () => new Request('https://local.test/api/approval-requests', {
  method: 'POST',
  headers: {
    authorization: 'Bearer seo_bot_testkey',
    'Content-Type': 'application/json'
  },
  body: '{}'
});
test('all new staff mutations reject bot credentials before resolving sessions or RPCs', async () => {
  let calls = 0;
  const actor = createAgencyActor(async () => {
    calls++;
    return 'actor';
  });
  for (const action of ['draft', 'send', 'return-to-draft', 'versions', 'final', 'archive', 'unarchive', 'owner']) {
    const response = await mutation(action, {
      agencyActor: actor,
      createAdminClient: () => {
        throw new Error('Must not connect');
      }
    })(bot(), context);
    assert.equal(response.status, 403, action);
  }
  assert.equal(calls, 0);
});
test('list and full detail reject bot keys before any database access', async () => {
  assert.equal((await listRequests(bot())).status, 401);
  assert.equal((await detail(bot(), context)).status, 401);
});
test('send generates a hash and URL once and maps SQL permissions and conflicts', async () => {
  for (const code of ['forbidden', 'not_found', 'already_sent', 'invalid_request', null]) {
    let called = false;
    const handler = mutation('send', {
      agencyActor: async () => 'actor',
      createAdminClient: () => ({
        rpc: async (name: string, args: Record<string, unknown>) => {
          called = true;
          assert.equal(name, 'send_approval_request');
          assert.match(String(args.p_token_hash), /^[a-f0-9]{64}$/);
          assert.equal(args.p_actor, 'actor');
          return {
            error: null,
            data: code ? {
              ok: false,
              code
            } : {
              ok: true
            }
          };
        }
      }) as unknown as ReturnType<typeof createAdminClient>
    });
    const response = await handler(new Request('https://local.test/send', {
      method: 'POST'
    }), context);
    assert.equal(called, true);
    assert.equal(response.status, code ? sqlStatus(code) : 200);
    const body = await response.json();
    if (code) assert.equal(body.url, undefined); else assert.match(body.url, /^https:\/\/local.test\/r\//);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
test('return to draft calls the staff RPC and maps its result without caching', async () => {
  assert.equal(sqlStatus('not_sent'), 409);
  for (const [code, status] of [['not_sent', 409], ['archived', 409], ['forbidden', 403], ['not_found', 404], [null, 200]] as const) {
    let calls = 0;
    const handler = mutation('return-to-draft', {
      agencyActor: async () => 'actor',
      createAdminClient: () => ({
        rpc: async (name: string, args: Record<string, unknown>) => {
          calls++;
          assert.equal(name, 'return_approval_to_draft');
          assert.deepEqual(args, { p_actor: 'actor', p_request_id: (await context.params).id, p_now: args.p_now });
          assert.equal(new Date(String(args.p_now)).toISOString(), args.p_now);
          return { error: null, data: code ? { ok: false, code } : { ok: true } };
        },
      }) as unknown as ReturnType<typeof createAdminClient>,
    });
    const response = await handler(new Request('https://local.test/return-to-draft', { method: 'POST' }), context);
    assert.equal(calls, 1);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), code ? { error: 'The change could not be saved.', code } : { ok: true });
  }
});
test('draft patches reject release fields and non-object bodies', async () => {
  const handler = mutation('draft', {
    agencyActor: async () => 'actor',
    createAdminClient: () => {
      throw new Error('Must not connect');
    }
  });
  for (const body of [{
    stage: 'sent'
  }, [], null]) assert.equal((await handler(new Request('https://local.test', {
    method: 'PATCH',
    body: JSON.stringify(body)
  }), context)).status, 400);
});
test('057 writes are frozen and both cron methods are no-ops', async () => {
  const response = await frozenApprovalWrite();
  assert.equal(response.status, 410);
  assert.equal((await response.json()).code, 'frozen');
  for (const path of ['approvals/import-doc', 'approvals/share-link', 'approvals/suggestions', 'portal/[token]']) assert.match(readFileSync(new URL(`../../app/api/${path}/route.ts`, import.meta.url), 'utf8'), /export const POST = frozenApprovalWrite/);
  assert.deepEqual(await (await frozenDocDrift()).json(), {
    skipped: 'frozen'
  });
  const cron = readFileSync(new URL('../../app/api/cron/check-doc-drift/route.ts', import.meta.url), 'utf8');
  for (const method of ['GET', 'POST']) assert.ok(cron.includes(`export const ${method} = frozenDocDrift`));
});
