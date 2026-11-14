import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaffApproval } from './create-route';
import { mutation } from './staff';
import { createBotApprovalRoute } from '../bots/approval-route';
import { createPublicItem, signRequestAsset } from './public';
import { createSubmit } from '../gbp-approvals/submit-route';
import { createAssetUpload } from './assets';
import { typeLabel } from './list';
import type { createAdminClient } from '../supabase/admin';
type Admin = ReturnType<typeof createAdminClient>;
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const org = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const task = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const client = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const foreign = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const token = 'a-valid-token-with-at-least-20-characters';
const payload = {
  schemaVersion: 1,
  pageKind: 'city',
  title: 'Kitchen in Mesa',
  metaTitle: 'Kitchen Mesa',
  metaDescription: 'Remodel your kitchen',
  slug: 'kitchens/mesa',
  targetKeyword: 'Internal secret',
  body: {
    format: 'markdown',
    text: '## Start\n\nHello world.'
  }
};
const context = {
  params: Promise.resolve({
    id
  })
};
const request = (value: unknown, bot = false) => new Request('https://local.test', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(bot ? {
      authorization: 'Bearer seo_bot_fixture'
    } : {})
  },
  body: JSON.stringify(value)
});
function query(data: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data,
      error: null
    })
  };
  return chain;
}
test('staff creates page drafts and posts sanitized page versions with outlines', async () => {
  const calls: string[] = [];
  const admin = {
    from: (table: string) => query(table === 'tasks' ? {
      id: task,
      organization_id: org,
      client_id: client
    } : {
      role: 'member'
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name);
      const item = (args.p_items as {
        payload: {
          body: {
            type: string;
          };
          targetKeyword: string;
        };
        outline: unknown[];
      }[])[0];
      assert.equal(item.payload.body.type, 'doc');
      assert.ok(item.outline.length);
      assert.equal(item.payload.targetKeyword, 'Internal secret');
      if (name === 'create_approval_request') assert.equal(args.p_item_type, 'page');
      return {
        data: {
          ok: true,
          requestId: id
        },
        error: null
      };
    }
  } as unknown as Admin;
  const dependencies = {
    agencyActor: async () => id,
    createAdminClient: () => admin
  };
  const created = await createStaffApproval(dependencies)(request({
    taskId: task,
    title: 'Pages',
    itemType: 'page',
    items: [{
      position: 1,
      payload
    }]
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).stage, 'draft');
  const edited = await mutation('versions', dependencies)(request({
    items: [{
      itemId: id,
      payload,
      changeNote: 'Fixed typo'
    }]
  }), context);
  assert.equal(edited.status, 200);
  assert.deepEqual(calls, ['create_approval_request', 'post_approval_version']);
});
test('bot page create returns 201 draft and cannot send', async () => {
  let calls = 0;
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
      } : null),
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'create_approval_request');
        assert.equal(args.p_item_type, 'page');
        assert.equal(args.p_created_via, 'bot');
        calls++;
        return {
          data: {
            ok: true,
            requestId: id
          },
          error: null
        };
      }
    }) as unknown as Admin
  });
  const command = {
    itemType: 'page',
    idempotencyKey: 'bot-page-create-001',
    title: 'City pages',
    taskId: task,
    clientId: client,
    items: [{
      position: 1,
      payload
    }]
  };
  const response = await handler(request(command, true));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    requestId: id,
    stage: 'draft',
    linked: false,
    reviewUrl: `/approvals/${id}`
  });
  assert.equal((await handler(request({
    ...command,
    send: true
  }, true))).status, 400);
  assert.equal(calls, 1);
});
test('public body route returns the released version only, removes internal fields, and never signs foreign assets', async () => {
  const signed: string[] = [];
  const own = `approval-assets/${id}/${client}`;
  const other = `approval-assets/${foreign}/${client}`;
  const handler = createPublicItem({
    createAdminClient: () => ({
      from: () => query({
        request_id: id
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'get_approval_item_by_token');
        if (args.p_item_id !== id) return {
          data: {
            ok: false,
            code: 'out_of_scope'
          },
          error: null
        };
        return {
          data: {
            ok: true,
            itemType: 'page',
            version: {
              id: client,
              versionNo: 2,
              payload: {
                ...payload,
                body: {
                  type: 'doc',
                  content: [{
                    type: 'image',
                    attrs: {
                      src: own,
                      alt: 'Own'
                    }
                  }, {
                    type: 'image',
                    attrs: {
                      src: other
                    }
                  }]
                }
              },
              photoPath: own,
              outline: []
            },
            previous: {
              payload: {
                title: 'Old'
              }
            },
            comments: [{
              body: 'Not in 1C'
            }]
          },
          error: null
        };
      }
    }) as unknown as Admin,
    signApprovalPhoto: async path => {
      signed.push(path);
      return 'https://signed.test/image';
    }
  });
  const response = await handler(new Request('https://local.test'), {
    params: Promise.resolve({
      token,
      itemId: id
    })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version.id, client);
  assert.equal(body.version.payload.targetKeyword, undefined);
  assert.equal(body.previous, undefined);
  assert.equal(body.comments, undefined);
  assert.deepEqual(signed, [own]);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal((await handler(new Request('https://local.test'), {
    params: Promise.resolve({
      token,
      itemId: foreign
    })
  })).status, 404);
  assert.equal(await signRequestAsset(id, other, async () => {
    throw new Error('Must not sign');
  }), null);
});
test('page submit maps the required change note to a page anchor and preserves existing submission contract', async () => {
  const handler = createSubmit({
    clientIpHash: () => null,
    createAdminClient: () => ({
      from: () => query({
        id,
        request_id: id,
        revoked_at: null,
        expires_at: '2099-01-01'
      }),
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'submit_gbp_approval');
        const body = args.p_payload as {
          comments: unknown[];
          displayedVersionIds: string[];
          requestHash: string;
        };
        assert.deepEqual(body.comments, [{
          itemId: id,
          versionId: client,
          anchorKind: 'page',
          body: 'Fix the typo.'
        }]);
        assert.deepEqual(body.displayedVersionIds, [client]);
        assert.match(body.requestHash, /^[0-9a-f]{64}$/);
        return {
          data: {
            ok: true
          },
          error: null
        };
      }
    }) as unknown as Admin
  });
  const response = await handler(request({
    itemType: 'page',
    respondentName: 'Casey',
    idempotencyKey: 'page-submit-001',
    displayedVersionIds: [client],
    decisions: [{
      itemId: id,
      versionId: client,
      decision: 'changes_requested',
      comment: 'Fix the typo.'
    }]
  }), {
    params: Promise.resolve({
      token
    })
  });
  assert.equal(response.status, 200);
});
test('mockup reservations reject bad types/sizes before RPC; mixed page kinds use Pages chip', async () => {
  const handler = createAssetUpload({
    agencyActor: async () => id,
    createAdminClient: () => {
      throw new Error('Must not connect');
    }
  });
  for (const patch of [{
    contentType: 'image/svg+xml',
    size: 10
  }, {
    contentType: 'image/png',
    size: 10485761
  }]) assert.equal((await handler(request({
    itemId: id,
    ...patch
  }), context)).status, 400);
  assert.equal(typeLabel({
    itemType: 'page',
    pageKinds: ['blog', 'city']
  }), 'Pages');
  assert.equal(typeLabel({
    itemType: 'page',
    pageKinds: ['city']
  }), 'City page');
});
