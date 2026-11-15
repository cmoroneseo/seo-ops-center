import { parseBotApproval, botApprovalUnauthorized, botApprovalRpcArgs } from '@/lib/bots/approvals';
import { resolveBotActorLookup, hashBotKey } from '@/lib/bots/keys';
import { bearerToken } from '@/lib/bots/scope';
import { createAdminClient } from '@/lib/supabase/admin';
function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

/** Bots can create the request. They cannot mint or share the client link. */
export function createBotApprovalRoute(dependencies = {
  createAdminClient,
  resolveBotActorLookup
}) {
  return async function POST(request: Request) {
    const unauthorized = botApprovalUnauthorized(request.headers.get('authorization'));
    if (unauthorized) return json({
      error: unauthorized.error,
      code: unauthorized.code
    }, unauthorized.status);
    const token = bearerToken(request.headers.get('authorization'));
    if (!token) return json({
      error: 'Missing API key.',
      code: 'missing_api_key'
    }, 401);
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({
        error: 'Request body must be JSON.',
        code: 'invalid_json'
      }, 400);
    }
    const parsed = parseBotApproval(payload);
    if (!parsed.ok) return json({
      error: parsed.error,
      code: parsed.code
    }, parsed.status);
    const admin = dependencies.createAdminClient();
    const key = await admin.from('bot_api_keys').select('id, organization_id, revoked_at').eq('key_hash', hashBotKey(token)).maybeSingle();
    if (key.error || !key.data || key.data.revoked_at) return json({
      error: 'Invalid API key.',
      code: 'invalid_api_key'
    }, 401);
    let lookup: ReturnType<typeof resolveBotActorLookup>;
    try {
      lookup = dependencies.resolveBotActorLookup();
    } catch {
      return json({
        error: 'The approval could not be attributed.',
        code: 'actor_not_found'
      }, 409);
    }
    const actor = await admin.from('users').select('id').eq(lookup.kind, lookup.value).maybeSingle();
    if (actor.error || !actor.data) return json({
      error: 'The approval could not be attributed.',
      code: 'actor_not_found'
    }, 409);
    const command = parsed.command;
    let clientId = command.clientId ?? null;
    if (!clientId && command.clientName) {
      const found = await admin.from('clients').select('id').eq('organization_id', key.data.organization_id).eq('name', command.clientName);
      if (found.error || found.data?.length !== 1) return json({
        error: 'Client not found.',
        code: 'client_not_found'
      }, found.data && found.data.length > 1 ? 409 : 404);
      clientId = found.data[0].id;
    }
    let taskId = command.taskId ?? null;
    if (!taskId && command.taskTitle && clientId) {
      const found = await admin.from('tasks').select('id').eq('organization_id', key.data.organization_id).eq('client_id', clientId).eq('title', command.taskTitle);
      if (found.error || found.data?.length !== 1) return json({
        error: 'Task not found.',
        code: 'task_not_found'
      }, found.data && found.data.length > 1 ? 409 : 404);
      taskId = found.data[0].id;
    }
    if (!clientId || !taskId) return json({
      error: 'Name the client and the task.',
      code: 'invalid_request'
    }, 400);
    const previous = await admin.from('approval_requests').select('id, request_hash').eq('organization_id', key.data.organization_id).eq('idempotency_key', command.idempotencyKey).maybeSingle();
    if (previous.error) return json({
      error: 'Retry identity could not be checked.',
      code: 'unavailable'
    }, 503);
    const created = await admin.rpc('create_approval_request', {
      ...botApprovalRpcArgs(command, actor.data.id, key.data.organization_id, clientId, taskId),
      p_item_type: command.itemType ?? 'gbp_post',
      p_created_via: 'bot',
      p_bot_key_id: key.data.id
    });
    if (created.error || !created.data) return json({
      error: 'The approval could not be saved.',
      code: 'invalid_request'
    }, 400);
    const result = created.data as {
      ok?: boolean;
      code?: string;
      requestId?: string;
      idempotent?: boolean;
      reused?: boolean;
    };
    if (result.ok === false) return json({
      error: 'The approval could not be saved.',
      code: result.code ?? 'invalid_request'
    }, result.code === 'forbidden' ? 403 : result.code === 'idempotency_conflict' ? 409 : 400);
    return json({
      requestId: result.requestId,
      stage: 'draft',
      linked: false,
      reviewUrl: `/approvals/${result.requestId}`,
      ...(previous.data || result.idempotent || result.reused ? {
        idempotent: true
      } : {})
    }, 201);
  };
}
