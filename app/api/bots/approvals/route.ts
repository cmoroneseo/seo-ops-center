import { parseBotApproval, botApprovalUnauthorized } from '@/lib/bots/approvals';
import { BOT_ACTOR_EMAIL, hashBotKey } from '@/lib/bots/keys';
import { bearerToken } from '@/lib/bots/scope';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

function json(body: unknown, status: number) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Bots can create the request. They cannot mint or share the client link. */
export async function POST(request: Request) {
    const unauthorized = botApprovalUnauthorized(request.headers.get('authorization'));
    if (unauthorized) return json({ error: unauthorized.error, code: unauthorized.code }, unauthorized.status);
    const token = bearerToken(request.headers.get('authorization'));
    if (!token) return json({ error: 'Missing API key.', code: 'missing_api_key' }, 401);
    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return json({ error: 'Request body must be JSON.', code: 'invalid_json' }, 400);
    }
    const parsed = parseBotApproval(payload);
    if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status);
    const admin = createAdminClient();
    const key = await admin.from('bot_api_keys').select('id, organization_id, revoked_at').eq('key_hash', hashBotKey(token)).maybeSingle();
    if (key.error || !key.data || key.data.revoked_at) return json({ error: 'Invalid API key.', code: 'invalid_api_key' }, 401);
    const actor = await admin.from('users').select('id').eq('email', BOT_ACTOR_EMAIL).maybeSingle();
    if (actor.error || !actor.data) return json({ error: 'The approval could not be attributed.', code: 'actor_not_found' }, 409);
    const command = parsed.command;
    let clientId = command.clientId ?? null;
    if (!clientId && command.clientName) {
        const found = await admin.from('clients').select('id').eq('organization_id', key.data.organization_id).eq('name', command.clientName);
        if (found.error || found.data?.length !== 1) return json({ error: 'Client not found.', code: 'client_not_found' }, found.data && found.data.length > 1 ? 409 : 404);
        clientId = found.data[0].id;
    }
    let taskId = command.taskId ?? null;
    if (!taskId && command.taskTitle && clientId) {
        const found = await admin.from('tasks').select('id').eq('organization_id', key.data.organization_id).eq('client_id', clientId).eq('title', command.taskTitle);
        if (found.error || found.data?.length !== 1) return json({ error: 'Task not found.', code: 'task_not_found' }, found.data && found.data.length > 1 ? 409 : 404);
        taskId = found.data[0].id;
    }
    if (!clientId || !taskId) return json({ error: 'Name the client and the task.', code: 'invalid_request' }, 400);
    const created = await admin.rpc('create_gbp_approval_request', {
        p_actor: actor.data.id,
        p_organization_id: key.data.organization_id,
        p_client_id: clientId,
        p_task_id: taskId,
        p_title: command.title,
        p_due_at: command.dueAt,
        p_questions: command.questions,
        p_items: command.items,
    });
    if (created.error || !created.data) return json({ error: 'The approval could not be saved.', code: 'invalid_request' }, 400);
    const result = created.data as { ok?: boolean; code?: string; requestId?: string };
    if (result.ok === false) return json({ error: 'The approval could not be saved.', code: result.code ?? 'invalid_request' }, result.code === 'forbidden' ? 403 : 400);
    return json({ requestId: result.requestId, linked: false }, 201);
}
