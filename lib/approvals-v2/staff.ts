import { agencyActor } from '@/lib/gbp-approvals/agency-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateToken, hashToken } from '@/lib/approvals/token';
import { approvalGroup, linkState, parseListQuery, type ApprovalRow } from './list';
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export function sqlStatus(code?: string) {
    return code === 'forbidden' ? 403 : code === 'not_found' ? 404 : ['already_sent','not_draft','archived','link_exists','refresh_required','idempotency_conflict','conflict'].includes(code ?? '') ? 409 : 400;
}
export async function staffContext(request: Request) {
    const actor = await agencyActor(request);
    if (!actor) return null;
    const admin = createAdminClient();
    const members = await admin.from('organization_members').select('organization_id, role').eq('user_id', actor);
    if (members.error) throw new Error('Memberships unavailable.');
    return { actor, admin, members: members.data ?? [] };
}
export async function listRequests(request: Request, taskId?: string) {
    const ctx = await staffContext(request);
    if (!ctx) return json({ error: 'Unauthorized', code: 'unauthorized' }, 401);
    let filters;
    try { filters = parseListQuery(new URL(request.url).searchParams); } catch { return json({ error: 'Invalid filters.', code: 'invalid_request' }, 400); }
    const { admin, actor, members } = ctx;
    const orgs = members.map(m => m.organization_id);
    if (!orgs.length) return json({ rows: [], counts: {}, badgeCount: 0, nextCursor: null });
    // Bounded chunks avoid PostgREST's default 1000-row truncation. Fail visibly at
    // the safety ceiling rather than returning misleading counts or missing rows.
    const records = [];
    for (let offset = 0; offset <= 10000; offset += 500) {
        let query = admin.from('approval_requests').select('id,title,stage,item_type,client_id,owner_id,created_via,created_at,updated_at,archived_at,clients!approval_requests_client_id_fkey(id,name),owner:users!approval_requests_owner_id_fkey(id,full_name),bot_api_keys!approval_requests_bot_key_id_fkey(name),approval_items(status,page_kind),approval_links(expires_at,revoked_at)').in('organization_id', orgs).order('id').range(offset, offset + 499);
        if (taskId) query = query.eq('task_id', taskId);
        const result = await query;
        if (result.error) return json({ error: 'Approvals could not be loaded.', code: 'unavailable' }, 503);
        records.push(...(result.data ?? []));
        if ((result.data?.length ?? 0) < 500) break;
        if (offset === 10000) return json({ error: 'Too many requests to summarize safely. Narrow this task.', code: 'result_limit' }, 503);
    }
    const rows: ApprovalRow[] = records.map(r => {
        const client = r.clients as unknown as { id: string; name: string } | null;
        const owner = r.owner as unknown as { id: string; full_name: string } | null;
        const bot = r.bot_api_keys as unknown as { name: string } | null;
        const link = r.approval_links[0] ?? null;
        return { id:r.id,title:r.title,client:client ?? {id:r.client_id,name:'Client'},itemType:r.item_type,pageKinds:[...new Set(r.approval_items.map(i=>i.page_kind).filter(Boolean))] as string[],itemCount:r.approval_items.length,group:approvalGroup(r.stage,r.approval_items),linkState:linkState(link),linkExpiresAt:link?.expires_at ?? null,createdAt:r.created_at,updatedAt:r.updated_at,owner:owner ? {id:owner.id,name:owner.full_name} : null,createdVia:r.created_via,botName:bot?.name ?? null,archivedAt:r.archived_at };
    });
    const badgeCount = rows.filter(r=>!r.archivedAt && ['ready_to_send','changes_requested'].includes(r.group)).length;
    const filtered = rows.filter(r=>(filters.archived === 'true' || !r.archivedAt) && (!filters.client || r.client.id===filters.client) && (!filters.type || r.itemType===filters.type || r.pageKinds.includes(filters.type)) && (!filters.owner || (filters.owner==='bot' ? r.createdVia==='bot' : r.owner?.id===(filters.owner==='me'?actor:filters.owner))) && (!filters.q || `${r.title} ${r.client.name}`.toLowerCase().includes(filters.q.toLowerCase())));
    const counts = Object.fromEntries(['ready_to_send','waiting','changes_requested','approved'].map(g=>[g,filtered.filter(r=>r.group===g).length]));
    const key = (r: ApprovalRow) => filters.sort==='title'?r.title:filters.sort==='updated'?r.updatedAt:r.createdAt;
    const direction = ['title','oldest'].includes(filters.sort)?1:-1;
    let sorted = filtered.filter(r=>!filters.status || r.group===filters.status).sort((a,b)=>direction*(key(a).localeCompare(key(b)) || a.id.localeCompare(b.id)));
    if (filters.cursor) {
        const cursor = JSON.parse(Buffer.from(filters.cursor,'base64url').toString()) as {key:string;id:string};
        sorted=sorted.filter(r=>direction*(key(r).localeCompare(cursor.key)||r.id.localeCompare(cursor.id))>0);
    }
    const page=sorted.slice(0,50), last=page.at(-1);
    return json({rows:page,counts,badgeCount,nextCursor:sorted.length>50 && last ? Buffer.from(JSON.stringify({key:key(last),id:last.id})).toString('base64url'):null,clients:[...new Map(rows.map(r=>[r.client.id,r.client])).values()],owners:[...new Map(rows.filter(r=>r.owner).map(r=>[r.owner!.id,r.owner!])).values()]});
}
export function mutation(action: string, dependencies = { agencyActor, createAdminClient }) {
    return async (request: Request, context: { params: Promise<{id:string}> }) => {
        const actor = await dependencies.agencyActor(request);
        if (!actor) return json({ error:'Unauthorized',code:'unauthorized' },401);
        const {id}=await context.params;
        const body=await request.json().catch(()=>null);
        if ((!body || typeof body !== 'object' || Array.isArray(body)) && ['draft','owner','versions','final'].includes(action)) return json({error:'Invalid JSON.',code:'invalid_request'},400);
        const now=new Date().toISOString();
        const token=action==='send'?generateToken():null;
        const expiresAt=new Date(Date.now()+14*86400000).toISOString();
        const names: Record<string,string>={draft:'update_approval_draft',send:'send_approval_request',archive:'archive_approval_request',unarchive:'unarchive_approval_request',owner:'set_approval_owner',versions:'post_approval_version',final:'mark_gbp_approval_final'};
        if (action==='draft' && Object.keys(body).some(k=>!['title','dueAt','questions','removeItemIds','itemOrder'].includes(k))) return json({error:'Invalid draft patch.',code:'invalid_request'},400);
        const args: Record<string,unknown>={p_actor:actor,p_request_id:id,...(action==='owner'?{p_owner:body.ownerId==='me'?actor:body.ownerId ?? null}:{p_now:now}),...(action==='draft'?{p_patch:body}:{}),...(action==='versions'?{p_items:body.items}:{}),...(action==='final'?{p_item_id:body.itemId}:{}),...(token?{p_token_hash:hashToken(token),p_expires_at:expiresAt}:{})};
        const result=await dependencies.createAdminClient().rpc(names[action],args);
        const value=result.data as {ok?:boolean;code?:string}|null;
        if (result.error || !value || value.ok===false) return json({error:'The change could not be saved.',code:value?.code ?? 'invalid_request'},sqlStatus(value?.code));
        return json({...value,...(token?{url:`${new URL(request.url).origin}/r/${token}`,expiresAt}:{})});
    };
}
