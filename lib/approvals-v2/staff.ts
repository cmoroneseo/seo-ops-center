import { parsePagePayload } from './page-body';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateToken, hashToken } from '@/lib/approvals/token';
import { approvalGroup, embeddedOne, linkState, parseListQuery, summarizeRows, uuid, type ApprovalRow } from './list';
import { parseGbpPhotoPaths, parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
import { isBotKeyToken, bearerToken } from '@/lib/bots/scope';
export const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store'
  }
});
export function sqlStatus(code?: string) {
  return code === 'forbidden' ? 403 : code === 'not_found' ? 404 : ['already_sent', 'not_sent', 'not_draft', 'archived', 'link_exists', 'refresh_required', 'idempotency_conflict', 'conflict'].includes(code ?? '') ? 409 : 400;
}
export async function staffContext(request: Request, dependencies = {
  agencyActor,
  createAdminClient
}) {
  const actor = await dependencies.agencyActor(request);
  if (!actor) return null;
  const admin = dependencies.createAdminClient();
  const members = await admin.from('organization_members').select('organization_id, role').eq('user_id', actor);
  return {
    actor,
    admin,
    members: members.data ?? [],
    unavailable: !!members.error
  };
}
export async function listRequests(request: Request, taskId?: string, dependencies = {
  agencyActor,
  createAdminClient
}) {
  const ctx = await staffContext(request, dependencies);
  if (!ctx) return json({
    error: 'Unauthorized',
    code: 'unauthorized'
  }, 401);
  if (ctx.unavailable) return json({
    error: 'Memberships unavailable.',
    code: 'unavailable'
  }, 503);
  if (taskId && !uuid.test(taskId)) return json({
    error: 'Invalid task ID.',
    code: 'invalid_request'
  }, 400);
  let filters;
  try {
    const params = new URL(request.url).searchParams;
    if (taskId && !params.has('archived')) params.set('archived', 'true');
    filters = parseListQuery(params);
  } catch {
    return json({
      error: 'Invalid filters.',
      code: 'invalid_request'
    }, 400);
  }
  const {
    admin,
    actor,
    members
  } = ctx;
  const orgs = members.map(m => m.organization_id);
  if (!orgs.length) return json(summarizeRows([], filters, actor));
  // Bounded chunks avoid PostgREST's default 1000-row truncation. Fail visibly at
  // the safety ceiling rather than returning misleading counts or missing rows.
  const records = [];
  for (let offset = 0; offset <= 10000; offset += 500) {
    let query = admin.from('approval_requests').select('id,title,stage,item_type,client_id,owner_id,created_via,created_at,updated_at,archived_at,clients!approval_requests_client_id_fkey(id,name),owner:users!approval_requests_owner_id_fkey(id,full_name),bot_api_keys!approval_requests_bot_key_id_fkey(name),approval_items(status,page_kind,released_version_id),approval_responses(decision,version_id,created_at),approval_links(expires_at,revoked_at)').in('organization_id', orgs).order('id').range(offset, offset + 499);
    if (taskId) query = query.eq('task_id', taskId);
    const result = await query;
    if (result.error) return json({
      error: 'Approvals could not be loaded.',
      code: 'unavailable'
    }, 503);
    records.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 500) break;
    if (offset === 10000) return json({
      error: 'Too many requests to summarize safely. Narrow this task.',
      code: 'result_limit'
    }, 503);
  }
  const rows: ApprovalRow[] = records.map(r => {
    const client = r.clients as unknown as {
      id: string;
      name: string;
    } | null;
    const owner = r.owner as unknown as {
      id: string;
      full_name: string;
    } | null;
    const bot = r.bot_api_keys as unknown as {
      name: string;
    } | null;
    const link = embeddedOne(r.approval_links);
    const releasedIds = new Set(r.approval_items.map(item => item.released_version_id));
    const approvedAt = (r.approval_responses ?? []).filter(response => response.decision === 'approved' && releasedIds.has(response.version_id)).map(response => response.created_at).sort().at(-1) ?? null;
    return {
      id: r.id,
      title: r.title,
      client: client ?? {
        id: r.client_id,
        name: 'Client'
      },
      itemType: r.item_type,
      pageKinds: [...new Set(r.approval_items.map(i => i.page_kind).filter(Boolean))] as string[],
      itemCount: r.approval_items.length,
      group: approvalGroup(r.stage, r.approval_items),
      linkState: linkState(link),
      linkExpiresAt: link?.expires_at ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      owner: owner ? {
        id: owner.id,
        name: owner.full_name
      } : null,
      createdVia: r.created_via,
      botName: bot?.name ?? null,
      archivedAt: r.archived_at,
      approvedAt
    };
  });
  return json(summarizeRows(rows, filters, actor, taskId ? 10500 : 50));
}
export function mutation(action: string, dependencies = {
  agencyActor,
  createAdminClient
}) {
  return async (request: Request, context: {
    params: Promise<{
      id: string;
    }>;
  }) => {
    const actor = await dependencies.agencyActor(request);
    if (!actor) {
      const bot = isBotKeyToken(bearerToken(request.headers.get('authorization')));
      return json({
        error: bot ? 'Forbidden' : 'Unauthorized',
        code: bot ? 'forbidden' : 'unauthorized'
      }, bot ? 403 : 401);
    }
    const {
      id
    } = await context.params;
    if (!uuid.test(id)) return json({
      error: 'Invalid request ID.',
      code: 'invalid_request'
    }, 400);
    const body = await request.json().catch(() => null);
    if ((!body || typeof body !== 'object' || Array.isArray(body)) && ['draft', 'owner', 'versions', 'final'].includes(action)) return json({
      error: 'Invalid JSON.',
      code: 'invalid_request'
    }, 400);
    if (action === 'owner' && (!('ownerId' in body) || body.ownerId !== null && body.ownerId !== 'me' && (typeof body.ownerId !== 'string' || !uuid.test(body.ownerId)))) return json({
      error: 'Choose an owner.',
      code: 'invalid_request'
    }, 400);
    if (action === 'final' && (typeof body.itemId !== 'string' || !uuid.test(body.itemId))) return json({
      error: 'Choose an item.',
      code: 'invalid_request'
    }, 400);
    if (action === 'versions' && Buffer.byteLength(JSON.stringify(body)) > 4194304) return json({ error: 'Request exceeds 4 MB.', code: 'invalid_request' }, 400);
    if (action === 'versions') {
      if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) return json({
        error: 'Choose items to revise.',
        code: 'invalid_request'
      }, 400);
      const items = [];
      for (const item of body.items) {
        if (!item || typeof item !== 'object' || typeof item.itemId !== 'string' || !uuid.test(item.itemId)) return json({
          error: 'Invalid item.',
          code: 'invalid_request'
        }, 400);
        const parsed = item.payload?.pageKind ? parsePagePayload(item.payload) : parseGbpPostPayload(item.payload);
        if (!parsed.ok) return json({
          error: parsed.error,
          code: 'invalid_request'
        }, 400);
        if ('photoPaths' in item && ('outline' in parsed || !parseGbpPhotoPaths(item.photoPaths))) return json({
          error: 'A GBP post can include up to 10 valid photos.',
          code: 'invalid_request'
        }, 400);
        items.push({
          ...item,
          payload: parsed.payload,
          ...('outline' in parsed ? { outline: parsed.outline } : {})
        });
      }
      body.items = items;
    }
    const now = new Date().toISOString();
    const token = action === 'send' ? generateToken() : null;
    const expiresAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const names: Record<string, string> = {
      draft: 'update_approval_draft',
      send: 'send_approval_request',
      'return-to-draft': 'return_approval_to_draft',
      archive: 'archive_approval_request',
      unarchive: 'unarchive_approval_request',
      owner: 'set_approval_owner',
      versions: 'post_approval_version',
      final: 'mark_gbp_approval_final',
      release: 'release_approval_revision'
    };
    if (action === 'draft' && Object.keys(body).some(k => !['title', 'dueAt', 'questions', 'removeItemIds', 'itemOrder'].includes(k))) return json({
      error: 'Invalid draft patch.',
      code: 'invalid_request'
    }, 400);
    const args: Record<string, unknown> = {
      p_actor: actor,
      p_request_id: id,
      ...(action === 'owner' ? {
        p_owner: body.ownerId === 'me' ? actor : body.ownerId ?? null
      } : {
        p_now: now
      }),
      ...(action === 'draft' ? {
        p_patch: body
      } : {}),
      ...(action === 'versions' ? {
        p_items: body.items
      } : {}),
      ...(action === 'final' ? {
        p_item_id: body.itemId
      } : {}),
      ...(token ? {
        p_token_hash: hashToken(token),
        p_expires_at: expiresAt
      } : {})
    };
    const result = await dependencies.createAdminClient().rpc(names[action], args);
    const value = result.data as {
      ok?: boolean;
      code?: string;
    } | null;
    if (result.error || !value || value.ok === false) return json({
      error: 'The change could not be saved.',
      code: value?.code ?? 'invalid_request'
    }, sqlStatus(value?.code));
    return json({
      ...value,
      ...(token ? {
        url: `${new URL(request.url).origin}/r/${token}`,
        expiresAt
      } : {})
    });
  };
}

/** Session-only aliases preserve the v1 helpers while returning explicit bot denials. */
export function staffLink(handler: (request: Request, context: {
  params: Promise<{
    id: string;
  }>;
}) => Promise<Response>) {
  return async (request: Request, context: {
    params: Promise<{
      id: string;
    }>;
  }) => {
    if (isBotKeyToken(bearerToken(request.headers.get('authorization')))) return json({
      error: 'Forbidden',
      code: 'forbidden'
    }, 403);
    if (!uuid.test((await context.params).id)) return json({
      error: 'Invalid request ID.',
      code: 'invalid_request'
    }, 400);
    const response = await handler(request, context);
    if (response.ok) return response;
    const value = await response.json().catch(() => ({}));
    return json({
      ...value,
      code: value.code ?? (response.status === 401 ? 'unauthorized' : 'invalid_request')
    }, response.status);
  };
}
