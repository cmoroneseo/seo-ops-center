import type { AgreementInput, AgreementPeriod, ClientAgreement, AgreementHoursSummary,AgreementWorkFunding } from './types';

const DAY = 86400000;
function day(date: string): number { return Date.parse(`${date}T00:00:00Z`); }
function iso(value: number): string { return new Date(value).toISOString().slice(0, 10); }
export function validDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const valueDay = day(value);
    return Number.isFinite(valueDay) && iso(valueDay) === value;
}
export function agreementToday(timezone: string, now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    return ['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
}
export function agreementLabel(agreement: ClientAgreement): string {
    return agreement.mode === 'custom' ? 'Custom scope' : `${agreement.hours ?? 0}h / month`;
}
export function agreementCoverageEnd(agreement: ClientAgreement, agreements: ClientAgreement[]): string | null {
    const successor = agreements.find(item=>item.previousId===agreement.id && !item.cancelledAt);
    const nextBoundary = successor ? iso(day(successor.startsOn)-DAY) : null;
    return agreement.endsOn && nextBoundary ? (agreement.endsOn < nextBoundary ? agreement.endsOn : nextBoundary) : agreement.endsOn ?? nextBoundary;
}
export function agreementForDate(agreements: ClientAgreement[], date: string): ClientAgreement | null {
    return [...agreements].filter(item=>!item.cancelledAt).sort((a,b)=>b.startsOn.localeCompare(a.startsOn)).find(item=>{
        const end=agreementCoverageEnd(item,agreements);
        return item.startsOn<=date && (!end || date<=end);
    }) ?? null;
}
export function agreementPeriod(agreements: ClientAgreement[], month: string): AgreementPeriod {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid month.');
    const [year,m]=month.split('-').map(Number);
    const days=new Date(Date.UTC(year,m,0)).getUTCDate();
    const monthStart=`${month}-01`, monthEnd=`${month}-${days}`;
    const segments=agreements.filter(agreement=>!agreement.cancelledAt).flatMap(agreement=>{
        const coverageEnd=agreementCoverageEnd(agreement,agreements);
        const startsOn=agreement.startsOn>monthStart ? agreement.startsOn : monthStart;
        const endsOn=coverageEnd && coverageEnd<monthEnd ? coverageEnd : monthEnd;
        if(startsOn>endsOn) return [];
        const count=(day(endsOn)-day(startsOn))/DAY+1;
        const budget=agreement.mode==='monthly' ? (agreement.hours ?? 0)*(agreement.proration==='daily' ? count/days : 1) : null;
        return [{agreement,startsOn,endsOn,budget}];
    }).sort((a,b)=>a.startsOn.localeCompare(b.startsOn));
    return {month,segments,monthlyBudget:Math.round(segments.reduce((n,item)=>n+(item.budget ?? 0),0)*100)/100,
        mixed:segments.length>1,uncoveredDays:Math.max(0,days-segments.reduce((n,item)=>n+(day(item.endsOn)-day(item.startsOn))/DAY+1,0))};
}
export function agreementHoursSummary(agreements:ClientAgreement[],month:string,logs:Array<{date:string;budgetMonth?:string|null;hours:number;agreementId?:string|null;countsTowardBudget:boolean}>):AgreementHoursSummary {
    const period=agreementPeriod(agreements,month);
    const eligible=logs.filter(log=>log.countsTowardBudget);
    const periodLogs=eligible.filter(log=>(log.budgetMonth ?? log.date.slice(0,7))===month);
    const ids=new Set([...period.segments.map(item=>item.agreement.id),...periodLogs.flatMap(log=>log.agreementId ? [log.agreementId] : [])]);
    const round=(n:number)=>Math.round(n*100)/100;
    return {period,rows:agreements.filter(item=>ids.has(item.id)).map(agreement=>({agreement,
        periodLogged:round(periodLogs.filter(log=>log.agreementId===agreement.id).reduce((n,log)=>n+log.hours,0)),
        logged:round(eligible.filter(log=>log.agreementId===agreement.id).reduce((n,log)=>n+log.hours,0)),
        budget:agreement.mode==='custom' ? (agreement.hoursMode==='estimate' ? null : agreement.hours) : period.segments.some(item=>item.agreement.id===agreement.id) ? round(period.segments.find(item=>item.agreement.id===agreement.id)!.budget ?? 0) : null,
    })),unassigned:round(periodLogs.filter(log=>!log.agreementId || !agreements.some(item=>item.id===log.agreementId)).reduce((n,log)=>n+log.hours,0))};
}
/** Monthly capacity excludes custom work and late effort owed under an ended term. */
export function monthlyAgreementLogs<T extends {agreementId?:string|null;countsTowardBudget:boolean}>(logs:T[],agreements:ClientAgreement[],month:string):T[] {
    const ids=new Set(agreementPeriod(agreements,month).segments.filter(s=>s.agreement.mode==='monthly').map(s=>s.agreement.id));
    return logs.filter(log=>log.countsTowardBudget && !!log.agreementId && ids.has(log.agreementId));
}
export function monthlyAgreementTaskIds(tasks:Array<{id:string;agreementId?:string}>,agreements:ClientAgreement[],funding:AgreementWorkFunding[],month:string):string[] {
    const period=agreementPeriod(agreements,month);
    const ids=new Set(period.segments.filter(s=>s.agreement.mode==='monthly').map(s=>s.agreement.id));
    const live=new Set(agreements.filter(a=>!a.cancelledAt).map(a=>a.id));
    return tasks.filter(task=>{
        const decision=funding.filter(f=>f.taskId===task.id && live.has(f.transitionId) && f.effectiveOn.slice(0,7)<=month)
            .sort((a,b)=>b.effectiveOn.localeCompare(a.effectiveOn)||b.recordedAt.localeCompare(a.recordedAt))[0];
        return ids.has(decision?.agreementId ?? task.agreementId ?? '');
    }).map(task=>task.id);
}
export function validateAgreement(input:AgreementInput):string|null {
    if(!['initial','renewal','amendment'].includes(input.kind)) return 'Choose an agreement action.';
    if(!input.title?.trim() || input.title.length>160) return 'Enter an agreement name (up to 160 characters).';
    if(!validDate(input.startsOn) || (input.endsOn!==null && !validDate(input.endsOn))) return 'Choose valid agreement dates.';
    if(input.endsOn && input.endsOn<input.startsOn) return 'The end date must follow the start date.';
    if(!['monthly','custom'].includes(input.mode)) return 'Choose Monthly or Custom scope.';
    if(input.hours!==null && (!Number.isFinite(input.hours) || input.hours<0 || input.hours>9999)) return 'Hours must be between 0 and 9,999.';
    if(input.mode==='monthly' && input.hours===null) return 'Enter monthly hours, including zero for a deliverables-only agreement.';
    if(input.mode==='monthly' && !['committed','allowance'].includes(input.hoursMode)) return 'Choose an hours commitment or allowance.';
    if(input.mode==='custom' && !['estimate','allowance'].includes(input.hoursMode)) return 'Custom hours are an estimate or a total allowance.';
    if(!['daily','full_period'].includes(input.proration)) return 'Choose a partial-month hours policy.';
    try { new Intl.DateTimeFormat('en-US',{timeZone:input.timezone}).format(); } catch { return 'Choose a valid time zone.'; }
    if(!input.scope?.trim() || input.scope.length>12000) return 'Describe the agreed scope (up to 12,000 characters).';
    if((input.note?.length ?? 0)>2000 || (input.evidence?.length ?? 0)>2000) return 'Keep references and notes under 2,000 characters.';
    if(!Array.isArray(input.services) || input.services.length>50) return 'Keep the scope to 50 services.';
    for(const service of input.services) {
        if(!service.title?.trim() || service.title.length>200 || !['Content','Backlink','GBP','Other'].includes(service.type)) return 'Enter a valid service name and type.';
        if(!Number.isInteger(service.quantity) || service.quantity<1 || service.quantity>999) return 'Deliverable quantities must be whole numbers between 1 and 999.';
        if(!['monthly','one_time'].includes(service.cadence)) return 'Choose a supported service cadence.';
        if(input.mode==='custom' && service.cadence==='monthly') return 'Custom scope uses one-time outputs; recurring services belong in a monthly agreement.';
    }
    if(!Array.isArray(input.fundedTaskIds) || input.fundedTaskIds.length>250 || new Set(input.fundedTaskIds).size!==input.fundedTaskIds.length) return 'Review the selected unfinished tasks.';
    return null;
}
