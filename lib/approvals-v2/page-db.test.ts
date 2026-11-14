import assert from 'node:assert/strict';
import test from 'node:test';
import { database, call, hash, org, owner, client, task, now, expiry } from './test-database.ts';
import { parsePagePayload } from './page-body.ts';
import { canonicalJson, pageType } from './registry.ts';
const raw = {
  schemaVersion: 1,
  pageKind: 'blog',
  title: 'Page',
  metaTitle: 'Search title',
  metaDescription: 'Description',
  slug: 'page',
  plannedDate: '2026-11-30',
  mockupAlt: 'Alt',
  targetKeyword: 'internal',
  body: {
    format: 'markdown',
    text: '## Start\n\nHello world.'
  }
};
const parsed = parsePagePayload(raw);
if (!parsed.ok) throw new Error(parsed.error);
const page = parsed.payload;
test('page drafts, released-only token bodies, page submit, and visible approval resets work through 132', async () => {
  const db = await database();
  try {
    const create = () => call(db, `select create_approval_request($1,$2,$3,$4,'page','Pages',null,'[]',$5::jsonb) result`, [owner, org, client, task, JSON.stringify([{
      position: 1,
      payload: page,
      outline: parsed.outline
    }])]);
    const request = await create();
    assert.equal(request.ok, true);
    const other = await create();
    const token = hash(String(request.requestId));
    const item = (await db.query<{
      id: string;
      current_version_id: string;
    }>('select id,current_version_id from approval_items where request_id=$1', [request.requestId])).rows[0];
    const revise = async (payload: unknown, photoPath: string | null = null) => call(db, `select post_approval_version($1,$2,$3::jsonb,$4) result`, [owner, request.requestId, JSON.stringify([{
      itemId: item.id,
      payload,
      outline: parsed.outline,
      photoPath,
      changeNote: 'Updated page'
    }]), now]);
    assert.equal((await revise({
      ...page,
      title: 'Draft edit'
    })).ok, true);
    assert.equal((await db.query('select released_version_id from approval_items where id=$1', [item.id])).rows[0].released_version_id, null);
    assert.equal((await call(db, `select send_approval_request($1,$2,$3,$4,$5) result`, [owner, request.requestId, token, expiry, now])).ok, true);
    let sequence = 0;
    async function approve(decision = 'approved', comment = '') {
      await db.query("delete from approval_public_hits where token_hash=$1 and action='submit'", [token]);
      const current = (await db.query<{
        released_version_id: string;
      }>('select released_version_id from approval_items where id=$1', [item.id])).rows[0].released_version_id;
      return call(db, `select submit_approval($1,$2::jsonb,null,$3) result`, [token, JSON.stringify({
        idempotencyKey: `page-submit-${++sequence}`,
        requestHash: hash(String(sequence)),
        respondentName: 'Reviewer',
        displayedVersionIds: [current],
        decisions: [{
          itemId: item.id,
          versionId: current,
          decision,
          comment
        }],
        comments: comment ? [{
          itemId: item.id,
          versionId: current,
          anchorKind: 'page',
          body: comment
        }] : []
      }), now]);
    }
    assert.equal((await approve('changes_requested')).code, 'comment_required');
    assert.equal((await approve('changes_requested', 'Please revise the introduction.')).ok, true);
    assert.equal((await db.query('select anchor_kind,body from approval_comments')).rows[0].anchor_kind, 'page');
    assert.equal((await approve()).ok, true);
    const status = async () => (await db.query<{
      status: string;
    }>('select status from approval_items where id=$1', [item.id])).rows[0].status;
    let current = {
      ...page,
      title: 'Draft edit'
    };
    // Every client-visible field, including a one-character typo, must reset.
    const patches = [{
      title: 'New title'
    }, {
      metaTitle: 'New search title'
    }, {
      metaDescription: 'New description'
    }, {
      slug: 'new-page'
    }, {
      plannedDate: '2026-12-01'
    }, {
      mockupAlt: 'New alt'
    }, {
      pageKind: 'city' as const
    }, {
      body: {
        ...page.body,
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'Hello worlds.'
          }]
        }]
      }
    }, ...['bold', 'https://example.com/a', 'https://example.com/b'].map(mark => ({
      body: {
        type: 'doc' as const,
        content: [{
          type: 'paragraph',
          content: [{
            type: 'text',
            text: 'Hello worlds.',
            marks: [{
              type: mark === 'bold' ? 'bold' : 'link',
              ...(mark === 'bold' ? {} : {
                attrs: {
                  href: mark
                }
              })
            }]
          }]
        }]
      }
    })), {
      body: {
        type: 'doc' as const,
        content: [{
          type: 'image',
          attrs: {
            src: 'https://example.com/body.png',
            alt: 'Body image'
          }
        }]
      }
    }];
    for (const patch of patches) {
      current = {
        ...current,
        ...patch
      };
      assert.equal((await revise(current)).ok, true, JSON.stringify(patch));
      assert.equal(await status(), 'pending');
      assert.equal((await approve()).ok, true);
    }
    assert.equal((await revise(current, 'https://example.com/mockup.png')).ok, true);
    assert.equal(await status(), 'pending');
    assert.equal((await approve()).ok, true);
    const internal = structuredClone(current);
    internal.targetKeyword = 'Different internal keyword';
    (internal.body.content[0] as {
      attrs?: Record<string, unknown>;
    }).attrs = {
      ...(internal.body.content[0] as {
        attrs?: Record<string, unknown>;
      }).attrs,
      blockId: 'new_anchor',
      sectionId: 'new_section'
    };
    assert.equal((await revise(internal, 'https://example.com/mockup.png')).ok, true);
    assert.equal(await status(), 'approved');
    assert.deepEqual(pageType.visibleSnapshot(current, null), pageType.visibleSnapshot({
      ...current,
      targetKeyword: 'Different'
    }, null));
    const body = await call(db, `select get_approval_item_by_token($1,$2,$3) result`, [token, item.id, now]);
    const version = body.version as {
      id: string;
      payload: Record<string, unknown>;
      bodyHash: string;
    };
    assert.equal(version.payload.targetKeyword, undefined);
    assert.equal(version.bodyHash, hash(canonicalJson(internal.body)));
    const foreign = (await db.query<{
      id: string;
    }>('select id from approval_items where request_id=$1', [other.requestId])).rows[0].id;
    assert.equal((await call(db, `select get_approval_item_by_token($1,$2,$3) result`, [token, foreign, now])).code, 'out_of_scope');
    assert.equal((await db.query('select page_kind from approval_items where id=$1', [item.id])).rows[0].page_kind, 'city');
    assert.ok((await db.query('select id from notifications')).rows.length > 0);
  } finally {
    await db.close();
  }
});
