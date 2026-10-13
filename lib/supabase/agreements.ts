import {createClient} from './client';
import {agreementForDate,agreementToday,validateAgreement,validateAgreementChain,agreementHoursSummary} from '../agreements/logic';
import type {AgreementInput,AgreementPreview,ClientAgreement,AgreementHoursSummary,AgreementWorkFunding} from '../agreements/types';
import type {ClientProject} from '../types';
import {setupBudgetMonth,type ClientSetupScope} from '../client-setup';

export function rowToAgreement(row:Record<string,unknown>):ClientAgreement {
    return {id:String(row.id),organizationId:String(row.organization_id),clientId:String(row.client_id),
        previousId:row.previous_id ? String(row.previous_id) : null,kind:row.kind as ClientAgreement['kind'],title:String(row.title),
        startsOn:String(row.starts_on),endsOn:row.ends_on ? String(row.ends_on) : null,mode:row.mode as ClientAgreement['mode'],
        hours:row.hours==null ? null : Number(row.hours),hoursMode:row.hours_mode as ClientAgreement['hoursMode'],
        proration:row.proration as ClientAgreement['proration'],timezone:String(row.timezone),scope:String(row.scope),
        services:(row.services ?? []) as ClientAgreement['services'],evidence:row.evidence ? String(row.evidence) : null,note:row.note ? String(row.note) : null,
        recordedAt:String(row.recorded_at),recordedBy:String(row.recorded_by),recordedByName:actorName(row.users),planSnapshot:(row.plan_snapshot ?? null) as ClientAgreement['planSnapshot'],
        cancelledAt:row.cancelled_at ? String(row.cancelled_at) : null};
}
function actorName(value: unknown): string | null {
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== 'object' || !('full_name' in row)) return null;
    const name = (row as { full_name?: unknown }).full_name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
}
export const AGREEMENT_TERM_COLUMNS='id,organization_id,client_id,previous_id,kind,title,starts_on,ends_on,mode,hours,hours_mode,proration,timezone,scope,services,evidence,note,recorded_at,recorded_by,cancelled_at';
export async function getAgreementHistory(organizationId:string,clientId?:string,includeSnapshots=true,includeActor=false):Promise<{available:boolean;agreements:ClientAgreement[]}> {
    const db=createClient();
    if(!db) return {available:false,agreements:[]};
    const agreements:ClientAgreement[]=[];
    const columns=AGREEMENT_TERM_COLUMNS+(includeSnapshots ? ',plan_snapshot' : '');
    const loadPage=async(select:string,page:number)=>{
        let query=db.from('client_agreements').select(select).eq('organization_id',organizationId).order('starts_on',{ascending:true}).order('id').range(page*500,page*500+499);
        if(clientId) query=query.eq('client_id',clientId);
        return query;
    };
    for(let page=0;;page++) {
        let select=columns+(includeActor ? ',users(full_name)' : '');
        let {data,error}=await loadPage(select,page);
        if(error && includeActor && !['42P01','PGRST205'].includes(error.code ?? '')) {
            select=columns;
            ({data,error}=await loadPage(select,page));
        }
        if(error) {
            if(['42P01','PGRST205'].includes(error.code ?? '')) return {available:false,agreements:[]};
            throw new Error('Agreement history could not be loaded. Try again.');
        }
        agreements.push(...((data ?? []) as Record<string,unknown>[]).map(row=>rowToAgreement(row)));
        if((data?.length ?? 0)<500) break;
    }
    return {available:true,agreements};
}
export function withClientAgreements(client:ClientProject,agreements:ClientAgreement[]):ClientProject {
    if(!agreements.length) return client;
    const timezone=agreements.find(item=>!item.cancelledAt)?.timezone ?? agreements[0].timezone;
    const current=agreementForDate(agreements,agreementToday(timezone));
    if(!current) return {...client,agreements,agreementCoverage:'none'};
    const setupScope:NonNullable<ClientProject['setupScope']>={version:1,mode:current.mode,hoursMode:current.hoursMode==='committed' ? 'committed' : 'allowance',contentPieces:current.services.filter(s=>s.type==='Content' && s.cadence==='monthly').reduce((n,s)=>n+s.quantity,0),gbp:client.setupScope?.gbp ?? false,gbpUsesSeoHours:client.setupScope?.gbpUsesSeoHours ?? false,listings:client.setupScope?.listings ?? false,onboardingBudget:client.setupScope?.onboardingBudget ?? 'separate',targetDate:current.endsOn ?? undefined};
    if(current.mode==='custom') return {...client,agreements,agreementCoverage:'custom',engagementModel:'Campaign',setupScope};
    const hours=current.hours ?? 0;
    return {...client,agreements,agreementCoverage:'monthly',seoHours:hours,engagementModel:'Retainer',setupScope,
        retainerConfig:{...client.retainerConfig,monthlyHours:hours,hoursUsed:client.retainerConfig?.hoursUsed ?? 0,recurringDeliverables:client.retainerConfig?.recurringDeliverables ?? []}};
}
function agreementError(input:AgreementInput,agreements:ClientAgreement[]):string|null {
    let today='1970-01-01';
    try { today=agreementToday(input.timezone || agreements.find(item=>item.id===input.previousId)?.timezone || 'UTC'); } catch { today=agreementToday('UTC'); }
    return validateAgreement(input) ?? validateAgreementChain(agreements,input,today);
}
export async function previewAgreement(client:ClientProject,input:AgreementInput):Promise<AgreementPreview> {
    const invalid=agreementError(input,client.agreements ?? []);if(invalid) throw new Error(invalid);
    const db=createClient();if(!db) throw new Error('Connect to the workspace to manage agreements.');
    const {data,error}=await db.rpc('preview_client_agreement',{p_client:client.id,p_start:input.startsOn});
    if(error) throw new Error(error.message);
    return {...data,agreements:client.agreements ?? []} as AgreementPreview;
}
export async function confirmAgreement(clientId:string,input:AgreementInput,token:string,requestId:string,agreements:ClientAgreement[]=[]):Promise<string> {
    const invalid=agreementError(input,agreements);if(invalid) throw new Error(invalid);
    const db=createClient();if(!db) throw new Error('Connect to the workspace to manage agreements.');
    const {data,error}=await db.rpc('confirm_client_agreement',{p_client:clientId,p_request:requestId,p_input:input,p_token:token});
    if(error) throw new Error(error.message);
    return String(data);
}
export async function cancelScheduledAgreement(clientId:string,agreementId:string):Promise<void> {
    const db=createClient();if(!db) throw new Error('Connect to the workspace to manage agreements.');
    const {error}=await db.rpc('cancel_scheduled_agreement',{p_client:clientId,p_id:agreementId});
    if(error) throw new Error(error.message);
}
export async function getAgreementHours(organizationId:string,clientId:string,month:string,agreements:ClientAgreement[]):Promise<AgreementHoursSummary> {
    const db=createClient();if(!db) throw new Error('Time data unavailable.');
    const rows:Array<{date:string;budgetMonth?:string|null;hours:number;agreementId:string|null;countsTowardBudget:boolean}>=[];
    for(let page=0;;page++) {
        const {data,error}=await db.from('time_logs').select('id,date,hours,agreement_id,counts_toward_budget,clients(launch_date,onboarding_date,setup_scope,status)').eq('organization_id',organizationId).eq('client_id',clientId).eq('status','logged').eq('import_status','mapped').lte('date',`${month}-${new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).getUTCDate()}`).order('date').order('id').range(page*500,page*500+499);
        if(error) throw new Error('Agreement hours could not be loaded.');
        rows.push(...(data ?? []).map((row:Record<string,unknown>)=>{
            const client=row.clients as {launch_date:string|null;onboarding_date:string|null;setup_scope:ClientSetupScope|null;status:string}|null;
            return {date:String(row.date),budgetMonth:client && String(row.date)<(client.launch_date ?? '') ? setupBudgetMonth(String(row.date),client.status==='onboarding' ? null : client.launch_date,client.onboarding_date,client.setup_scope) : undefined,hours:Number(row.hours),agreementId:row.agreement_id as string|null,countsTowardBudget:row.counts_toward_budget===true};
        }));
        if((data?.length ?? 0)<500) break;
    }
    return agreementHoursSummary(agreements,month,rows);
}
export async function getAgreementWorkFunding(organizationId:string,clientId:string):Promise<AgreementWorkFunding[]> {
    const db=createClient();if(!db)throw new Error('Work scope unavailable.');
    const funding:AgreementWorkFunding[]=[];
    for(let page=0;;page++) {
        const {data,error}=await db.from('client_agreement_work_funding').select('id,task_id,agreement_id,transition_id,effective_on,recorded_at').eq('organization_id',organizationId).eq('client_id',clientId).order('effective_on').order('id').range(page*500,page*500+499);
        if(error)throw new Error('Work scope could not be loaded.');
        funding.push(...(data ?? []).map((row:Record<string,unknown>)=>({taskId:String(row.task_id),agreementId:String(row.agreement_id),transitionId:String(row.transition_id),effectiveOn:String(row.effective_on),recordedAt:String(row.recorded_at)})));
        if((data?.length ?? 0)<500)break;
    }
    return funding;
}
