import type { AgreementInput, AgreementPeriod, AgreementService, ClientAgreement, AgreementHoursSummary,AgreementWorkFunding } from './types';

export interface CoverageLine { startsOn: string; endsOn: string; text: string }
export interface OutputChange { before: AgreementService; after: AgreementService }
export interface OutputDiff { kept: AgreementService[]; renamed: OutputChange[]; stopped: AgreementService[]; added: AgreementService[] }

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
export function formatHourAmount(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return String(Math.round(value * 100) / 100);
}
/** Monthly quota. Null is a gap or a month with no monthly agreement, never a fake zero. */
export function formatHourQuota(budget: number | null | undefined): string {
    if (budget == null || !Number.isFinite(budget)) return '—';
    return `${formatHourAmount(budget)}h`;
}
/** Logged hours against one quota. A null quota reads "X / —". A missing logged total reads "—". */
export function formatHoursAgainstQuota(logged: number | null | undefined, budget: number | null | undefined): string {
    if (logged == null || !Number.isFinite(logged)) return '—';
    if (budget == null || !Number.isFinite(budget)) return `${formatHourAmount(logged)} / —`;
    return `${formatHourAmount(logged)} / ${formatHourAmount(budget)}h`;
}
export function agreementLabel(agreement: ClientAgreement): string {
    return agreement.mode === 'custom' ? 'Custom scope' : `${formatHourQuota(agreement.hours ?? 0)} / month`;
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
    const monthly=segments.flatMap(item=>item.budget==null ? [] : [item.budget]);
    return {month,segments,monthlyBudget:monthly.length ? Math.round(monthly.reduce((n,item)=>n+item,0)*100)/100 : null,
        mixed:segments.length>1,uncoveredDays:Math.max(0,days-segments.reduce((n,item)=>n+(day(item.endsOn)-day(item.startsOn))/DAY+1,0))};
}
function reviewMonth(input: AgreementInput): string {
    const date = input.kind === 'end' ? (input.endsOn ?? input.startsOn) : input.startsOn;
    return date.slice(0, 7);
}
/** Draft successor, or the current agreement with a newly recorded signed end. */
export function reviewAgreements(existing: ClientAgreement[], input: AgreementInput): ClientAgreement[] {
    if (input.kind === 'end') return existing.map(item => item.id === input.previousId ? { ...item, endsOn: input.endsOn } : item);
    const draft: ClientAgreement = {
        id: 'draft', organizationId: existing[0]?.organizationId ?? '', clientId: existing[0]?.clientId ?? '',
        previousId: input.previousId, kind: input.kind, title: input.title, startsOn: input.startsOn, endsOn: input.endsOn,
        mode: input.mode, hours: input.hours, hoursMode: input.hoursMode, proration: input.proration, timezone: input.timezone,
        scope: input.scope, services: input.services, evidence: input.evidence, note: input.note,
        recordedAt: input.startsOn, recordedBy: '', planSnapshot: null,
    };
    return [...existing.filter(item => item.id !== draft.id), draft];
}
/** The month that contains the new effective date, including the draft terms. Null means no monthly quota. */
export function reviewMonthQuota(existing: ClientAgreement[], input: AgreementInput): number | null {
    return agreementPeriod(reviewAgreements(existing, input), reviewMonth(input)).monthlyBudget;
}
function rangeLabel(startsOn: string, endsOn: string): string {
    const part = (value: string) => {
        const date = new Date(`${value}T12:00:00Z`);
        return { month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date), day: date.getUTCDate() };
    };
    const start = part(startsOn), end = part(endsOn);
    if (startsOn === endsOn) return `${start.month} ${start.day}`;
    if (start.month === end.month) return `${start.month} ${start.day}–${end.day}`;
    return `${start.month} ${start.day}–${end.month} ${end.day}`;
}
/** Boundary-month slices, including gaps. Custom and uncovered days never become 0h. */
export function monthCoverageLines(existing: ClientAgreement[], input: AgreementInput): CoverageLine[] {
    const month = reviewMonth(input);
    const period = agreementPeriod(reviewAgreements(existing, input), month);
    const [year, monthNumber] = month.split('-').map(Number);
    const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const monthStart = `${month}-01`;
    const monthEnd = `${month}-${String(days).padStart(2, '0')}`;
    const shift = (date: string, amount: number) => iso(day(date) + amount * DAY);
    const lines: CoverageLine[] = [];
    let cursor = monthStart;
    for (const segment of period.segments) {
        if (segment.startsOn > cursor) {
            const gapEnd = shift(segment.startsOn, -1);
            lines.push({ startsOn: cursor, endsOn: gapEnd, text: `${rangeLabel(cursor, gapEnd)} · —` });
        }
        const range = rangeLabel(segment.startsOn, segment.endsOn);
        const text = segment.agreement.mode === 'monthly' && segment.budget != null
            ? `${range} · ${formatHourAmount(segment.budget)}h ${segment.agreement.proration === 'full_period' ? 'full-period allowance' : 'prorated retainer'}`
            : segment.agreement.mode === 'monthly' ? `${range} · —` : `${range} · Custom allowance`;
        lines.push({ startsOn: segment.startsOn, endsOn: segment.endsOn, text });
        cursor = shift(segment.endsOn, 1);
    }
    if (cursor <= monthEnd) lines.push({ startsOn: cursor, endsOn: monthEnd, text: `${rangeLabel(cursor, monthEnd)} · —` });
    return lines;
}
function sameOutputIdentity(left: AgreementService, right: AgreementService): boolean {
    return left.cadence === right.cadence && left.type === right.type && (left.subtype ?? '') === (right.subtype ?? '') && left.quantity === right.quantity && !!left.countsTowardHours === !!right.countsTowardHours;
}
/** Kept and renamed outputs continue. A quantity, cadence, type, or subtype change stops the old output and adds the new one. */
export function outputDiff(previous: AgreementService[] | undefined, next: AgreementService[]): OutputDiff {
    const prior = previous ?? [];
    const kept: AgreementService[] = [];
    const renamed: OutputChange[] = [];
    const stopped: AgreementService[] = [];
    for (const old of prior) {
        const continued = next.find(service => !!service.sourceId && service.sourceId === old.sourceId);
        if (!continued || !sameOutputIdentity(old, continued)) { stopped.push(old); continue; }
        if (continued.title.trim() === old.title.trim()) kept.push(continued); else renamed.push({ before: old, after: continued });
    }
    const added = next.filter(service => {
        const old = service.sourceId ? prior.find(item => item.sourceId === service.sourceId) : undefined;
        return !old || !sameOutputIdentity(old, service);
    });
    return { kept, renamed, stopped, added };
}
/** An output stops when it is dropped or continued under a different cadence, type, or subtype. A rename does not stop it. */
export function stoppingOutputs(previous: AgreementService[] | undefined, next: AgreementService[]): AgreementService[] {
    return (previous ?? []).filter(old => {
        const continued = next.find(service => !!service.sourceId && service.sourceId === old.sourceId);
        if (!continued) return true;
        return continued.cadence !== old.cadence || continued.type !== old.type || (continued.subtype ?? '') !== (old.subtype ?? '');
    });
}
export function clientScopeLabel(client: { agreementHistoryUnavailable?: boolean; agreementCoverage?: 'monthly' | 'custom' | 'none'; setupScope?: { mode?: string } | null; seoHours: number }): string {
    if (client.agreementHistoryUnavailable) return 'Scope unavailable';
    if (client.agreementCoverage === 'none') return '—';
    if (client.agreementCoverage === 'custom' || client.setupScope?.mode === 'custom') return 'Custom scope';
    return `${formatHourAmount(client.seoHours)}h/mo`;
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
        budget:agreement.mode==='custom' ? (agreement.hoursMode==='estimate' ? null : agreement.hours) : (() => { const segment=period.segments.find(item=>item.agreement.id===agreement.id); return segment && segment.budget!=null ? round(segment.budget) : null; })(),
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
    if(!['initial','renewal','amendment','supersede','end'].includes(input.kind)) return 'Choose an agreement action.';
    if(input.kind==='end') {
        if(!input.previousId) return 'Record the original agreement first.';
        if(!validDate(input.endsOn)) return 'Choose a valid end date.';
        if((input.note?.length ?? 0)>2000 || (input.evidence?.length ?? 0)>2000) return 'Keep references and notes under 2,000 characters.';
        return null;
    }
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
/** Chain rules for the form, matched to confirm_client_agreement. A blank end date does not choose the action. */
export function validateAgreementChain(agreements: ClientAgreement[], input: AgreementInput, today: string): string | null {
    const live = agreements.filter(item => !item.cancelledAt).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));
    const latest = live.at(-1) ?? null;
    const previous = input.previousId ? live.find(item => item.id === input.previousId) ?? null : null;
    if (input.kind === 'initial') {
        if (latest || input.previousId) return 'Original agreement already recorded';
        if (validDate(input.startsOn) && input.startsOn > today) return 'Record the existing agreement before scheduling a renewal';
        return null;
    }
    if (!previous || !latest || previous.id !== latest.id) return 'Review the latest agreement before changing terms';
    if (input.timezone && input.timezone !== previous.timezone) return 'Keep the agreement time zone consistent';
    if (input.kind === 'end') {
        if (live.some(item => item.previousId === previous.id)) return 'Cancel the scheduled successor before recording an end date';
        if (!input.endsOn || !validDate(input.endsOn)) return 'Choose a valid end date.';
        if (input.endsOn < previous.startsOn) return 'The end date must follow the start date.';
        if (previous.endsOn && previous.endsOn !== input.endsOn) return 'This agreement already has a signed end date';
        return null;
    }
    if (!validDate(input.startsOn) || input.startsOn <= previous.startsOn) return 'The effective date must follow the previous agreement start';
    if (input.kind === 'renewal' && (!previous.endsOn || input.startsOn <= previous.endsOn)) return 'Renewal must follow the previous end date. Use Supersede on date when the signed end stays open';
    if (input.kind === 'supersede' && previous.endsOn && input.startsOn > previous.endsOn) return 'This date is after the signed end. Use Renew';
    if (input.kind === 'amendment' && ((previous.endsOn && input.startsOn > previous.endsOn) || input.endsOn !== previous.endsOn)) return 'A scope amendment keeps the current term end date';
    return null;
}
