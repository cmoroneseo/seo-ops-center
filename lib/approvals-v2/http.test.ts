import assert from 'node:assert/strict';
import test from 'node:test';
import { createBotApprovalRoute } from '../bots/approval-route';
import { createStaffApproval } from './create-route';
import { listRequests, mutation, staffLink } from './staff';
import { createAgencyActor } from '../gbp-approvals/agency-auth';
import { canSendApproval } from './permissions';
import type { createAdminClient } from '../supabase/admin';
type Admin = ReturnType<typeof createAdminClient>;
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const task = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const client = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const payload = {
  schemaVersion: 1,
  postType: 'update',
  title: 'Title',
  body: 'Post body',
  scheduledDate: '2026-11-14',
  ctaUrl: 'https://example.com',
  ctaLabel: 'Learn more',
  offerStart: null,
  offerEnd: null,
  terms: ''
};
const command = {
  idempotencyKey: 'bot-fixture-001',
  clientId: client,
  taskId: task,
  title: 'Draft',
  items: [{
    position: 1,
    payload
  }]
};
const post = (body: unknown, authorization = 'Bearer seo_bot_fixture') => new Request('https://local.test/api/approvals', {
  method: 'POST',
  headers: {
    authorization,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});

// PostgREST-style thenable: no fetch or credentials are involved in these tests.
function query(data: unknown, inspect?: (method: string, args: unknown[]) => void) {
  const chain = {
    select: (...args: unknown[]) => {
      inspect?.('select', args);
      return chain;
    },
    eq: (...args: unknown[]) => {
      inspect?.('eq', args);
      return chain;
    },
    in: (...args: unknown[]) => {
      inspect?.('in', args);
      return chain;
    },
    order: (...args: unknown[]) => {
      inspect?.('order', args);
      return chain;
    },
    range: (...args: unknown[]) => {
      inspect?.('range', args);
      return chain;
    },
    maybeSingle: async () => ({
      data,
      error: null
    }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({
      data,
      error: null
    }).then(resolve)
  };
  return chain;
}
test('bot create and retry both return 201 draft with a staff URL and no share link', async () => {
  let saved = false;
  let rpcCalls = 0;
  const handler = createBotApprovalRoute({
    resolveBotActorLookup: () => ({
      kind: 'id',
      value: id
    }),
    createAdminClient: () => ({
      from: (table: string) => query(table === 'bot_api_keys' ? {
        id,
        organization_id: org,
        revoked_at: null
      } : table === 'users' ? {
        id
      } : saved ? {
        id,
        request_hash: 'hash'
      } : null),
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'create_approval_request');
        assert.equal(args.p_created_via, 'bot');
        assert.equal(args.p_item_type, 'gbp_post');
        assert.equal(args.p_bot_key_id, id);
        assert.match(String(args.p_request_hash), /^[a-f0-9]{64}$/);
        assert.equal('p_send' in args, false);
        rpcCalls++;
        saved = true;
        return {
          error: null,
          data: {
            ok: true,
            requestId: id,
            round: 1
          }
        };
      }
    }) as unknown as Admin
  });
  for (const replay of [false, true]) {
    const response = await handler(post(command));
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      requestId: id,
      stage: 'draft',
      linked: false,
      reviewUrl: `/approvals/${id}`,
      ...(replay ? {
        idempotent: true
      } : {})
    });
  }
  // Only SQL creates notifications; the route calls no notification writer.
  assert.equal(rpcCalls, 2);
});
test('bot release controls and invalid page bodies fail before any service client is created', async () => {
  const handler = createBotApprovalRoute({
    createAdminClient: () => {
      throw new Error('Must not connect');
    },
    resolveBotActorLookup: () => ({
      kind: 'id',
      value: id
    })
  });
  for (const key of ['send', 'stage', 'status', 'sentAt', 'released', 'releasedVersionId', 'releasedAt']) {
    const response = await handler(post({
      ...command,
      [key]: false
    }));
    assert.equal(response.status, 400, key);
    assert.equal((await response.json()).code, 'forbidden');
  }
  const page = await handler(post({
    ...command,
    itemType: 'page'
  }));
  assert.equal(page.status, 400);
  assert.equal((await page.json()).code, 'invalid_request');
});
test('staff create saves only a draft and rejects every save-and-send field', async () => {
  const calls: string[] = [];
  const handler = createStaffApproval({
    agencyActor: async () => id,
    createAdminClient: () => ({
      from: (table: string) => query(table === 'tasks' ? {
        id: task,
        organization_id: org,
        client_id: client
      } : {
        role: 'member'
      }),
      rpc: async (name: string) => {
        calls.push(name);
        return {
          error: null,
          data: {
            ok: true,
            requestId: id
          }
        };
      }
    }) as unknown as Admin
  });
  const response = await handler(post({
    taskId: task,
    title: 'Draft',
    items: [{
      position: 1,
      payload
    }]
  }, ''));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    requestId: id,
    stage: 'draft',
    linked: false,
    reviewUrl: `/approvals/${id}`
  });
  assert.deepEqual(calls, ['create_approval_request']);
  for (const key of ['send', 'stage', 'sentAt']) assert.equal((await handler(post({
    ...command,
    [key]: false
  }, ''))).status, 400);
  for (const body of [null, [], 'bad']) assert.equal((await handler(post(body, ''))).status, 400);
});
test('list route scopes the embedded query to caller organizations and handles a unique link object', async () => {
  const operations: Array<[string, unknown[]]> = [];
  const handlerAdmin = {
    from: (table: string) => query(table === 'organization_members' ? [{
      organization_id: org,
      role: 'member'
    }] : [{
      id,
      title: 'Draft',
      client_id: client,
      item_type: 'gbp_post',
      stage: 'draft',
      created_via: 'bot',
      owner_id: null,
      created_at: '2026-11-14',
      updated_at: '2026-11-14',
      archived_at: null,
      clients: {
        id: client,
        name: 'Client'
      },
      owner: null,
      bot_api_keys: {
        name: 'Writer'
      },
      approval_items: [{
        status: 'pending',
        page_kind: null
      }],
      approval_links: {
        expires_at: '2099-01-01',
        revoked_at: null
      }
    }], (method, args) => {
      operations.push([method, args]);
    })
  } as unknown as Admin;
  const response = await listRequests(new Request('https://local.test/api/approval-requests?client=' + client), undefined, {
    agencyActor: async () => id,
    createAdminClient: () => handlerAdmin
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.rows[0].group, 'ready_to_send');
  assert.equal(body.rows[0].linkState, 'active');
  assert.equal(body.badgeCount, 1);
  assert.ok(operations.some(([method, args]) => method === 'in' && args[0] === 'organization_id' && JSON.stringify(args[1]) === JSON.stringify([org])));
});
test('Send permissions allow admins/owners/account manager, and deny viewers, members and bot actors', () => {
  for (const role of ['owner', 'admin']) assert.equal(canSendApproval(role, id, null), true);
  assert.equal(canSendApproval('member', id, id), true);
  assert.equal(canSendApproval('member', id, null), false);
  assert.equal(canSendApproval('viewer', id, id), false);
  assert.equal(canSendApproval('owner', id, id, true), false);
});
test('new send and compatibility link aliases reject bots with 403 before any RPC', async () => {
  const context = {
    params: Promise.resolve({
      id
    })
  };
  const resolve = createAgencyActor(async () => {
    throw new Error('Must not resolve a bot session');
  });
  assert.equal((await mutation('send', {
    agencyActor: resolve,
    createAdminClient: () => {
      throw new Error('Must not connect');
    }
  })(post({}), context)).status, 403);
  const handler = staffLink(async () => {
    throw new Error('Must not reach the v1 helper');
  });
  for (const action of ['issue', 'extend', 'revoke']) {
    const response = await handler(new Request(`https://local.test/api/approval-requests/${id}/link/${action}`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer seo_bot_fixture'
      }
    }), context);
    assert.equal(response.status, 403);
  }
});
test('detail returns released/current versions, decisions, link facts and signs request-scoped photos for both types after membership scoping', async () => {
  const {
    createStaffDetail
  } = await import('./detail');
  const current = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const released = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const historicPhoto = 'approval-assets/' + id + '/photo';
  const signed: string[] = [];
  let scoped = false;
  const records: Record<string, unknown> = {
    organization_members: [{
      organization_id: org,
      role: 'member'
    }],
    approval_requests: {
      id,
      organization_id: org,
      stage: 'sent',
      item_type: 'gbp_post',
      clients: {
        name: 'Client',
        account_manager_id: null
      },
      owner: null,
      bot_api_keys: null
    },
    approval_items: [{
      id: task,
      current_version_id: current,
      released_version_id: released
    }],
    approval_item_versions: [{
      id: current,
      photo_path: 'https://example.com/current.jpg'
    }, {
      id: released,
      version_no: 1,
      photo_path: 'https://example.com/primary.jpg',
      photo_paths: ['https://example.com/primary.jpg', historicPhoto]
    }],
    approval_responses: [{
      item_id: task,
      version_id: released,
      decision: 'approved',
      replacement_photo_path: 'https://example.com/replacement.jpg'
    }],
    approval_questions: [],
    approval_events: [],
    approval_links: {
      created_at: '2026-11-14',
      expires_at: '2099-01-01',
      revoked_at: null,
      last_viewed_at: null,
      view_count: 0
    },
    approval_comments: [{ id: 'client-feedback', item_id: task, version_id: released, photo_position: 2, body: 'Use this photo' }],
    approval_internal_feedback: [{
      id: 'internal-feedback',
      item_id: task,
      version_id: released,
      photo_position: 2,
      reviewer_name: 'Internal reviewer',
      decision: 'approved',
      comment: 'Ready to send'
    }],
    approval_bot_actors: null
  };
  const handler = createStaffDetail({
    agencyActor: async () => id,
    createAdminClient: () => ({
      from: (table: string) => query(records[table], (method, args) => {
        if (table === 'approval_requests' && method === 'in' && args[0] === 'organization_id') scoped = true;
      })
    }) as unknown as Admin,
    signApprovalPhoto: async path => {
      assert.equal(scoped, true);
      signed.push(path);
      return `signed:${path}`;
    }
  });
  const context = {
    params: Promise.resolve({
      id
    })
  };
  const response = await handler(new Request('https://local.test'), context);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.items[0].version.id, current);
  assert.equal(data.items[0].releasedVersion.id, released);
  assert.equal(data.items[0].response.decision, 'approved');
  assert.deepEqual(data.internalFeedback, [{
    id: 'internal-feedback', itemId: task, versionNo: 1,
    reviewerName: 'Internal reviewer', decision: 'approved', comment: 'Ready to send',
    photoPosition: 2, photoUrl: `signed:${historicPhoto}`
  }]);
  assert.equal(data.comments[0].photoUrl, `signed:${historicPhoto}`);
  assert.equal(data.canSend, false);
  assert.match(data.sendReason, /account manager/);
  assert.equal(data.link.state, 'active');
  assert.equal(signed.length, 4);
  (records.approval_requests as {
    item_type: string;
  }).item_type = 'page';
  records.approval_comments = [];
  signed.length = 0;
  await handler(new Request('https://local.test'), context);
  assert.equal(signed.length, 4);
});
