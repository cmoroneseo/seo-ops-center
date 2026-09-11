import { requireClientIntegrationManager, requireClientOrgMember } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncGscHistory } from '@/lib/supabase/gsc-history';
import { historyDates, historyWindow, rowToHistoryDay, rowToHistoryFact } from '@/lib/gsc/history';
export const maxDuration=90;

export async function POST(req:Request) {
    const body=await req.json().catch(()=>null);
    if(!body || typeof body.clientId!=='string') return Response.json({error:'clientId is required'},{status:400});
    const auth=await requireClientIntegrationManager(body.clientId);
    if(!auth.ok) return Response.json({error:auth.error},{status:auth.status});
    const range={start:body.start??historyWindow().start,end:body.end??historyWindow().end};
    try { historyDates(range.start,range.end); if(range.end>historyWindow().end) throw new Error(); }
    catch { return Response.json({error:'Use up to 31 finalized days ending at least three days ago'},{status:400}); }
    try { return Response.json(await syncGscHistory(auth.organizationId,auth.clientId,range)); }
    catch { return Response.json({error:'History import failed. Check the GSC connection and retry; previously saved days are retained.'},{status:502}); }
}

export async function GET(req:Request) {
    const params=new URL(req.url).searchParams;
    const auth=await requireClientOrgMember(params.get('clientId'));
    if(!auth.ok) return Response.json({error:auth.error},{status:auth.status});
    const range={start:params.get('start')??historyWindow().start,end:params.get('end')??historyWindow().end};
    let dates:string[];
    try { dates=historyDates(range.start,range.end); } catch { return Response.json({error:'Invalid date range (maximum 31 days)'},{status:400}); }
    const admin=createAdminClient();
    const {data:connection,error:connectionError}=await admin.from('client_integrations').select('site_url:credentials->>site_url').eq('organization_id',auth.organizationId).eq('client_id',auth.clientId).eq('service','gsc').maybeSingle();
    if(connectionError) return Response.json({error:'Unable to read selected property'},{status:500});
    const property=params.get('property')??connection?.site_url;
    if(!property) return Response.json({error:'Select a GSC property first'},{status:400});
    const {data:days,error}=await admin.from('gsc_history_days').select('id,data_date,imported_at,page_limited,query_limited').eq('organization_id',auth.organizationId).eq('client_id',auth.clientId).eq('property',property).gte('data_date',range.start).lte('data_date',range.end).order('data_date');
    if(error) return Response.json({error:'Unable to read history'},{status:500});
    const grain=params.get('grain')??'query_page';
    const offset=Number(params.get('offset')??0);
    if(!['property','page','query_page'].includes(grain)||!Number.isSafeInteger(offset)||offset<0) return Response.json({error:'Invalid grain or offset'},{status:400});
    const {data:rows,error:rowsError}=days?.length?await admin.from('gsc_history_facts').select('id,day_id,page,query,clicks,impressions,position').in('day_id',days.map(day=>day.id)).eq('grain',grain).order('id').range(offset,offset+500):{data:[],error:null};
    if(rowsError) return Response.json({error:'Unable to read history rows'},{status:500});
    return Response.json({property,...range,grain,days:(days??[]).map(rowToHistoryDay),missingDates:dates.filter(date=>!days?.some(day=>day.data_date===date)),rows:(rows??[]).slice(0,500).map(rowToHistoryFact),nextOffset:(rows?.length??0)>500?offset+500:null,coverageNote:'Google returns available top rows, not every query. Query/page and page totals must not be treated as property totals.'});
}
