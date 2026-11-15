import { parsePagePayload } from './page-body';
import { uuid } from './list';
import { sqlStatus } from './staff';
import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { parseGbpPostPayload } from '@/lib/gbp-approvals/registry';
import { createAdminClient } from '@/lib/supabase/admin';
export function createStaffApproval(dependencies = {
  agencyActor,
  createAdminClient
}) {
  return async function POST(request: Request) {
    const actor = await dependencies.agencyActor(request);
    if (!actor) return Response.json({
      error: 'Unauthorized',
      code: 'unauthorized'
    }, {
      status: 401
    });
    const body = (await request.json().catch(() => null)) as {
      itemType?: 'gbp_post' | 'page';
      taskId?: string;
      title?: string;
      dueAt?: string | null;
      items?: unknown[];
      questions?: unknown[];
    } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return Response.json({
      error: 'Request body must be an object.',
      code: 'invalid_request'
    }, {
      status: 400
    });
    if (Buffer.byteLength(JSON.stringify(body)) > 4194304) return Response.json({ error: 'Request exceeds 4 MB.', code: 'invalid_request' }, { status: 400 });
    if ('itemType' in body && body.itemType !== 'page' && body.itemType !== 'gbp_post') return Response.json({
      error: 'Unknown item type.',
      code: 'invalid_request'
    }, {
      status: 400
    });
    if (body && ['send', 'stage', 'sentAt'].some(key => key in body)) return Response.json({
      error: 'Requests must be created as drafts.',
      code: 'invalid_request'
    }, {
      status: 400
    });
    if (!body?.taskId || typeof body.taskId !== 'string' || !uuid.test(body.taskId) || typeof body.title !== 'string' || !body.title.trim() || !Array.isArray(body.items) || !body.items.length || body.items.length > (body.itemType === 'page' ? 20 : 30)) {
      return Response.json({
        error: 'Add a title and at least one post.',
        code: 'invalid_request'
      }, {
        status: 400
      });
    }
    const admin = dependencies.createAdminClient();
    const task = await admin.from('tasks').select('id, organization_id, client_id').eq('id', body.taskId).maybeSingle();
    if (task.error || !task.data) return Response.json({
      error: 'Not found',
      code: 'not_found'
    }, {
      status: 404
    });
    const member = await admin.from('organization_members').select('role').eq('organization_id', task.data.organization_id).eq('user_id', actor).maybeSingle();
    if (!member.data || member.data.role === 'viewer') return Response.json({
      error: 'Forbidden',
      code: 'forbidden'
    }, {
      status: 403
    });
    const items = [];
    for (const entry of body.items) {
      if (!entry || typeof entry !== 'object') return Response.json({
        error: 'Each post needs a payload.',
        code: 'invalid_request'
      }, {
        status: 400
      });
      const item = entry as {
        position?: number;
        payload?: unknown;
        photoPath?: string | null;
      };
      const parsed = body.itemType === 'page' ? parsePagePayload(item.payload) : parseGbpPostPayload(item.payload);
      if (!parsed.ok) return Response.json({
        error: parsed.error,
        code: 'invalid_request'
      }, {
        status: 400
      });
      items.push({
        position: item.position,
        payload: parsed.payload,
        ...('outline' in parsed ? { outline: parsed.outline } : {}),
        photoPath: item.photoPath ?? null
      });
    }
    const created = await admin.rpc('create_approval_request', {
      p_item_type: body.itemType ?? 'gbp_post',
      p_actor: actor,
      p_organization_id: task.data.organization_id,
      p_client_id: task.data.client_id,
      p_task_id: task.data.id,
      p_title: body.title,
      p_due_at: body.dueAt ?? null,
      p_questions: body.questions ?? [],
      p_items: items
    });
    if (created.error || !created.data || (created.data as {
      ok?: boolean;
    }).ok === false) {
      const code = (created.data as {
        code?: string;
      } | null)?.code;
      return Response.json({
        error: 'The approval could not be saved.',
        code: code ?? 'invalid_request'
      }, {
        status: sqlStatus(code)
      });
    }
    const requestId = (created.data as {
      requestId: string;
    }).requestId;
    return Response.json({
      requestId,
      stage: 'draft',
      linked: false,
      reviewUrl: `/approvals/${requestId}`
    }, {
      status: 201
    });
  };
}
