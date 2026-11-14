import { staffContext, json } from './staff';
import { linkState } from './list';
import { signApprovalPhoto } from '@/lib/gbp-approvals/live';
export async function GET(request: Request, context: { params: Promise<{id:string}> }) {
    const ctx=await staffContext(request);
    if (!ctx) return json({error:'Unauthorized',code:'unauthorized'},401);
    const {id}=await context.params;
    const {admin,actor,members}=ctx;
    const result=await admin.from('approval_requests').select('*,clients!approval_requests_client_id_fkey(id,name,account_manager_id),owner:users!approval_requests_owner_id_fkey(id,full_name),bot_api_keys!approval_requests_bot_key_id_fkey(name)').eq('id',id).in('organization_id',members.map(m=>m.organization_id)).maybeSingle();
    if (result.error) return json({error:'Approvals could not be loaded.'},503);
    if (!result.data) return json({error:'Not found',code:'not_found'},404);
    const r=result.data;
    const [items,versions,responses,questions,events,link]=await Promise.all([
        admin.from('approval_items').select('*').eq('request_id',id).order('position'),
        admin.from('approval_item_versions').select('*').eq('request_id',id).order('version_no',{ascending:false}),
        admin.from('approval_responses').select('*').eq('request_id',id).order('created_at',{ascending:false}),
        admin.from('approval_questions').select('*').eq('request_id',id).order('position'),
        admin.from('approval_events').select('*').eq('request_id',id).order('created_at',{ascending:false}),
        admin.from('approval_links').select('created_at,expires_at,revoked_at,last_viewed_at,view_count').eq('request_id',id).maybeSingle(),
    ]);
    if ([items,versions,responses,questions,events,link].some(v=>v.error)) return json({error:'Approvals could not be loaded.'},503);
    const paths=r.item_type==='gbp_post'?[...new Set((versions.data??[]).map(v=>v.photo_path).filter((v):v is string=>Boolean(v)))]:[];
    const photos=Object.fromEntries(await Promise.all(paths.map(async path=>[path,await signApprovalPhoto(path)])));
    const role=members.find(m=>m.organization_id===r.organization_id)?.role;
    const client=r.clients as {account_manager_id?:string}|null;
    const botActor=await admin.from('approval_bot_actors').select('user_id').eq('user_id',actor).maybeSingle();
    const canSend=!botActor.error && !botActor.data && role!=='viewer' && (['owner','admin'].includes(role??'') || client?.account_manager_id===actor);
    return json({request:r,items:(items.data??[]).map(item=>({...item,version:versions.data?.find(v=>v.id===item.current_version_id)??null,releasedVersion:versions.data?.find(v=>v.id===item.released_version_id)??null,response:responses.data?.find(v=>v.item_id===item.id && v.version_id===item.current_version_id)??null})),versions:versions.data,responses:responses.data,questions:questions.data,events:events.data,photos,link:link.data?{state:linkState(link.data),expiresAt:link.data.expires_at,createdAt:link.data.created_at,revokedAt:link.data.revoked_at,openedAt:link.data.last_viewed_at,viewCount:link.data.view_count}:null,owner:r.owner,createdVia:r.created_via,botName:(r.bot_api_keys as {name:string}|null)?.name??null,canSend,canWrite:['owner','admin','member'].includes(role??''),sendReason:canSend?null:'Only an organization owner, admin, or this client’s account manager can send.',actorId:actor});
}
