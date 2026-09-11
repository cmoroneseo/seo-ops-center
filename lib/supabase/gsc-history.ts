import { createAdminClient } from './admin';
import { getGoogleAccessToken } from '@/lib/sync/token';
import { fetchGscDay, historyDates, historyWindow, planHistoryDays } from '@/lib/gsc/history';

export async function syncGscHistory(organizationId: string,clientId: string,range=historyWindow()) {
    const dates=historyDates(range.start,range.end);
    if(range.end>historyWindow().end) throw new Error('Choose finalized dates at least three days old');
    const admin=createAdminClient();
    const {data:client,error:clientError}=await admin.from('clients').select('id').eq('id',clientId).eq('organization_id',organizationId).single();
    if(clientError||!client) throw new Error('Unable to verify history client');
    const auth=await getGoogleAccessToken(clientId,'gsc');
    if(!auth || typeof auth.creds.site_url!=='string') throw new Error('Connect and select a GSC property first');
    const property=auth.creds.site_url;
    const {data:days,error}=await admin.from('gsc_history_days').select('data_date,imported_at').eq('organization_id',organizationId).eq('client_id',clientId).eq('property',property).gte('data_date',range.start).lte('data_date',range.end);
    if(error) throw new Error('Unable to read GSC history coverage');
    const selected=planHistoryDays(dates,days??[]);
    const imported:string[]=[];
    const signal=AbortSignal.timeout(60000);
    for(const date of selected) {
        const day=await fetchGscDay(property,auth.token,date,{signal});
        const {data:saved,error:saveError}=await admin.rpc('replace_gsc_history_day',{p_organization_id:organizationId,p_client_id:clientId,p_property:property,p_date:date,p_fetched_at:day.fetchedAt,p_page_limited:day.pageLimited,p_query_limited:day.queryLimited,p_facts:day.facts});
        if(saveError) throw new Error('History was not saved; the connection may have changed. Retry the import.');
        if(saved) imported.push(date);
    }
    const known=new Set([...(days??[]).map(day=>day.data_date),...imported]);
    return {property,...range,imported,remainingDays:dates.filter(date=>!known.has(date)).length};
}
