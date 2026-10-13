'use client';

import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {ArrowLeft,ArrowRight,Check,Loader2,Plus,Trash2} from 'lucide-react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {agreementCoverageEnd,agreementLabel,validateAgreement,validateAgreementChain,agreementToday,monthCoverageLines,outputDiff,reviewAgreements,reviewMonthQuota} from '@/lib/agreements/logic';
import type {AgreementInput,AgreementPreview,AgreementService,ClientAgreement} from '@/lib/agreements/types';

const fieldClass='w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

function Field({label,children,hint}:{label:string;children:(id:string)=>ReactNode;hint?:string}) {
    const id=useId();
    return <div className="space-y-1.5"><label htmlFor={id} className="block text-sm font-medium">{label}</label>{children(id)}{hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}</div>;
}
export function agreementDateLabel(value:string|null):string {
    return value ? new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`)) : 'Open-ended';
}
function issuedLabel(count:number):string {
    return count===0 ? 'None issued yet' : `${count} already issued`;
}
const actionTitle:Record<AgreementInput['kind'],string>={
    initial:'Record original agreement',
    renewal:'Renew',
    amendment:'Change scope',
    supersede:'Supersede on date',
    end:'End on date',
};

/** Presentational, review-first flow. All writes go through the authorized transaction. */
export function AgreementFlow({clientName,initial,previous,agreements,onClose,onReview,onConfirm}:{
    clientName:string;initial:AgreementInput;previous:ClientAgreement|null;agreements:ClientAgreement[];onClose:()=>void;
    onReview:(input:AgreementInput)=>Promise<AgreementPreview>;
    onConfirm:(input:AgreementInput,preview:AgreementPreview,requestId:string)=>Promise<void>;
}) {
    const [input,setInput]=useState(initial);
    const [preview,setPreview]=useState<AgreementPreview|null>(null);
    const [busy,setBusy]=useState(false);
    const [error,setError]=useState<string|null>(null);
    const request=useRef<string|null>(null);
    const dialog=useRef<HTMLDivElement>(null);
    const heading=useRef<HTMLHeadingElement>(null);
    const errorMessage=useRef<HTMLParagraphElement>(null);
    useEffect(()=>{dialog.current?.scrollTo({top:0,behavior:'instant'});heading.current?.focus({preventScroll:true});},[preview]);
    useEffect(()=>{if(error){dialog.current?.scrollTo({top:0,behavior:'instant'});errorMessage.current?.focus({preventScroll:true});}},[error]);
    const title=actionTitle[input.kind];
    const update=<K extends keyof AgreementInput>(key:K,value:AgreementInput[K])=>{setInput(old=>({...old,[key]:value}));setError(null);request.current=null;};
    const updateService=(index:number,patch:Partial<AgreementService>)=>update('services',input.services.map((s,i)=>i===index ? {...s,...patch} : s));
    const today=(()=>{try{return agreementToday(input.timezone);}catch{return agreementToday('UTC');}})();
    const review=async()=>{
        const invalid=validateAgreement(input) ?? validateAgreementChain(agreements,input,today);
        if(invalid){setError(invalid);return;}
        setBusy(true);setError(null);
        try {setPreview(await onReview(input));} catch(e) {setError(e instanceof Error ? e.message : 'Could not review this agreement. Try again.');} finally {setBusy(false);}
    };
    const save=async()=>{
        if(!preview)return;setBusy(true);setError(null);
        request.current ??=crypto.randomUUID();
        try {await onConfirm(input,preview,request.current);} catch(e) {setError(e instanceof Error ? e.message : 'Could not save. Your agreement has not been duplicated; try again.');} finally{setBusy(false);}
    };
    const backdated=input.kind!=='end' && input.startsOn<today;
    const history=preview?.agreements ?? agreements;
    const lines=preview ? monthCoverageLines(history,input) : [];
    const diff=outputDiff(previous?.services,input.services);
    const issued=(service:AgreementService)=>issuedLabel(Number(preview?.issuedByOutput?.[service.sourceId ?? ''] ?? 0));
    const reviewed=preview ? reviewAgreements(history,input) : [];
    const prior=previous ? reviewed.find(item=>item.id===previous.id) ?? previous : null;
    const priorCoverage=prior ? agreementCoverageEnd(prior,reviewed) : null;
    const monthLabel=lines[0] ? new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${lines[0].startsOn}T12:00:00Z`)) : '';
    return <Dialog open onOpenChange={open=>{if(!open && !busy)onClose();}}><DialogContent ref={dialog} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={e=>{if(busy)e.preventDefault();}} onPointerDownOutside={e=>e.preventDefault()}>
        <div className="space-y-2 pr-6"><DialogTitle ref={heading} tabIndex={-1} className="text-xl focus:outline-none">{preview ? 'Review agreement' : title}</DialogTitle><DialogDescription>{clientName} · {preview ? 'Confirm the terms and how unfinished work will continue.' : 'Keep the client workspace and its history together.'}</DialogDescription></div>
        {error && <p ref={errorMessage} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive focus:outline-none">{error}</p>}
        {!preview ? <form onSubmit={e=>{e.preventDefault();void review();}}><fieldset disabled={busy} className="space-y-6">
            {input.kind==='initial' && <p className="text-sm leading-relaxed text-muted-foreground">Enter the original agreement from your records. Existing work will stay in this workspace; recording terms does not restart onboarding.</p>}
            {input.kind==='supersede' && <p className="text-sm leading-relaxed text-muted-foreground">Coverage of the current agreement stops the day before the date you enter. Its signed end stays as recorded, including when that end is open.</p>}
            {input.kind==='renewal' && <p className="text-sm leading-relaxed text-muted-foreground">Renew starts after the signed end date. Days between the signed end and the new start have no monthly allowance.</p>}
            {input.kind==='end' && <p className="text-sm leading-relaxed text-muted-foreground">Record the signed end date on the current agreement. This does not add a successor. Coverage includes the date you enter.</p>}
            {input.kind==='amendment' && <p className="text-sm leading-relaxed text-muted-foreground">Change scope inside the current term. The signed end date stays the same.</p>}
            {input.kind!=='end' && <Field label="Agreement name">{id=><input id={id} className={fieldClass} value={input.title} maxLength={160} required onChange={e=>update('title',e.target.value)} />}</Field>}
            {input.kind==='end' ? <Field label="Signed end date" hint="The final date is included. A later different date is rejected once this is saved.">{id=><input id={id} type="date" className={fieldClass} value={input.endsOn ?? ''} min={previous?.startsOn} required onChange={e=>update('endsOn',e.target.value || null)} />}</Field> : <div className="grid gap-4 sm:grid-cols-2">
                <Field label={input.kind==='amendment' ? 'Change effective on' : 'Starts on'} hint={input.kind==='supersede' ? 'The previous agreement’s signed end is not rewritten.' : undefined}>{id=><input id={id} type="date" className={fieldClass} value={input.startsOn} required onChange={e=>update('startsOn',e.target.value)} />}</Field>
                <Field label="Ends on" hint={input.kind==='amendment' ? 'The existing agreement term stays the same.' : input.kind==='supersede' ? 'Leave blank for an open-ended successor. This does not close the previous agreement.' : 'Leave blank for an open-ended agreement. The final date is included.'}>{id=><input id={id} type="date" className={fieldClass} value={input.endsOn ?? ''} min={input.startsOn} disabled={input.kind==='amendment'} onChange={e=>update('endsOn',e.target.value || null)} />}</Field>
            </div>}
            {input.kind!=='end' && <>
            <fieldset className="space-y-2"><legend className="text-sm font-medium">Delivery scope</legend><div className="grid grid-cols-2 gap-2">{(['monthly','custom'] as const).map(mode=><Button key={mode} type="button" variant={input.mode===mode ? 'secondary' : 'outline'} size="lg" aria-pressed={input.mode===mode} onClick={()=>{
                setInput(old=>({...old,mode,hoursMode:mode==='monthly' ? 'committed' : 'estimate',hours:mode==='custom' ? null : old.hours ?? 0,services:old.services.map(s=>({...s,cadence:mode==='monthly' ? 'monthly' : 'one_time'}))}));setError(null);request.current=null;
            }}>{mode==='monthly' ? 'Monthly' : 'Custom scope'}{input.mode===mode && <Check className="h-4 w-4" />}</Button>)}</div></fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={input.mode==='monthly' ? 'SEO hours per month' : input.kind==='amendment' ? 'Hours from effective date (optional)' : 'Total hours (optional)'} hint={input.mode==='custom' ? input.kind==='amendment' ? 'An allowance for future effort under these terms. Earlier hours remain under the prior scope.' : 'A total for this scope, never a recurring monthly quota.' : 'Enter zero for a deliverables-only agreement.'}>{id=><input id={id} type="number" min={0} max={9999} step="0.25" className={fieldClass} value={input.hours ?? ''} required={input.mode==='monthly'} onChange={e=>update('hours',e.target.value==='' ? null : Number(e.target.value))} />}</Field>
                <Field label="Hours treatment">{id=><select id={id} className={fieldClass} value={input.hoursMode} onChange={e=>update('hoursMode',e.target.value as AgreementInput['hoursMode'])}>{input.mode==='monthly' ? <><option value="committed">Committed hours to deliver</option><option value="allowance">Available monthly allowance</option></> : <><option value="estimate">Planning estimate</option><option value="allowance">Total hours allowance</option></>}</select>}</Field>
            </div>
            {input.mode==='monthly' && <Field label="Partial-month hours" hint="Delivery is planned by calendar month. Choose the treatment agreed with the client.">{id=><select id={id} className={fieldClass} value={input.proration} onChange={e=>update('proration',e.target.value as AgreementInput['proration'])}><option value="daily">Prorate by covered days</option><option value="full_period">Full allowance for each covered month</option></select>}</Field>}
            <Field label="Agreed scope" hint="Include outcomes, services, exclusions, and what counts as complete.">{id=><textarea id={id} className={`${fieldClass} min-h-28`} maxLength={12000} required value={input.scope} onChange={e=>update('scope',e.target.value)} />}</Field>
            <fieldset className="space-y-3"><legend className="text-sm font-medium">Deliverable outputs</legend><p className="text-xs leading-relaxed text-muted-foreground">Add only outputs promised to the client. Hours, GBP management, and listings coverage belong in the agreed scope above.</p>
                {input.mode==='monthly' && <p className="text-xs leading-relaxed text-muted-foreground">Partial-month outputs are prorated by covered days and rounded up. Previously generated work remains owed.</p>}
                {input.kind==='initial' && input.services.some(s=>s.sourceId) && <p className="text-xs leading-relaxed text-muted-foreground">Existing outputs are preserved as recorded. After saving, use Change scope to revise them.</p>}
                {input.services.map((service,index)=><fieldset disabled={input.kind==='initial' && !!service.sourceId} key={index} className="space-y-2 border-b border-border pb-3">
                    <div className="flex items-center gap-2"><input aria-label={`Output ${index+1} name`} className={fieldClass} value={service.title} maxLength={200} placeholder="Content pieces" required onChange={e=>updateService(index,{title:e.target.value})} /><Button type="button" variant="outline" size="icon" aria-label={`Remove ${service.title || 'output'}`} onClick={()=>update('services',input.services.filter((_,i)=>i!==index))}><Trash2 className="h-4 w-4" /></Button></div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3"><select aria-label={`Output ${index+1} type`} className={fieldClass} value={service.type} onChange={e=>updateService(index,{type:e.target.value as AgreementService['type']})}><option value="Content">Content</option><option value="Backlink">Backlinks</option><option value="GBP">GBP output</option><option value="Other">Other output</option></select><input aria-label={`Output ${index+1} quantity`} type="number" min={1} max={999} step={1} className={fieldClass} value={service.quantity} required onChange={e=>updateService(index,{quantity:Number(e.target.value)})} /><select aria-label={`Output ${index+1} cadence`} className={fieldClass} value={service.cadence} onChange={e=>updateService(index,{cadence:e.target.value as AgreementService['cadence']})}>{input.mode==='monthly' && <option value="monthly">Per month</option>}<option value="one_time">One-time total</option></select></div>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={service.countsTowardHours} onChange={e=>updateService(index,{countsTowardHours:e.target.checked})} />Work consumes the SEO hours allowance</label>
                </fieldset>)}
                <Button type="button" variant="outline" size="lg" disabled={input.services.length>=50} onClick={()=>update('services',[...input.services,{title:'',type:'Content',quantity:1,cadence:input.mode==='monthly' ? 'monthly' : 'one_time',countsTowardHours:false}])}><Plus className="h-4 w-4" />Add output</Button>
            </fieldset>
            <details className="space-y-4"><summary className="cursor-pointer rounded text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Agreement reference and internal details</summary>
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Agreement reference (optional)">{id=><input id={id} className={fieldClass} maxLength={2000} value={input.evidence ?? ''} placeholder="Signed document or contract reference" onChange={e=>update('evidence',e.target.value || null)} />}</Field><Field label="Time zone" hint="Dates and renewal boundaries use this time zone.">{id=><input id={id} className={fieldClass} value={input.timezone} disabled={!!previous} onChange={e=>update('timezone',e.target.value)} />}</Field></div>
            <Field label="Internal note (optional)">{id=><textarea id={id} className={fieldClass} maxLength={2000} value={input.note ?? ''} onChange={e=>update('note',e.target.value || null)} />}</Field>
            </details>
            </>}
            {input.kind==='end' && <Field label="Internal note (optional)">{id=><textarea id={id} className={fieldClass} maxLength={2000} value={input.note ?? ''} onChange={e=>update('note',e.target.value || null)} />}</Field>}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4"><Button type="button" variant="outline" size="lg" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" size="lg" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{busy ? 'Preparing review…' : 'Review agreement'}</Button></div>
        </fieldset></form> : <div className="space-y-6">
            <dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">{previous ? 'Previous scope' : 'Client workspace'}</dt><dd className="mt-1 text-sm font-medium">{previous ? agreementLabel(previous) : clientName}</dd></div>{input.kind!=='end' && <div><dt className="text-xs text-muted-foreground">{input.kind==='amendment' ? 'Amended scope' : 'Agreement scope'}</dt><dd className="mt-1 text-sm font-medium">{input.mode==='monthly' ? `${input.hours}h / month` : `Custom scope${input.hours==null ? '' : ` · ${input.hours}h ${input.hoursMode==='estimate' ? 'estimate' : 'total allowance'}`}`}</dd></div>}<div><dt className="text-xs text-muted-foreground">{input.kind==='end' ? 'Signed end' : 'Effective coverage'}</dt><dd className="mt-1 text-sm">{input.kind==='end' ? agreementDateLabel(input.endsOn) : `${agreementDateLabel(input.startsOn)} — ${agreementDateLabel(input.endsOn)}`}</dd></div>{prior && input.kind==='supersede' && <div><dt className="text-xs text-muted-foreground">Previous signed end</dt><dd className="mt-1 text-sm">{agreementDateLabel(prior.endsOn)} · coverage through {agreementDateLabel(priorCoverage)}</dd></div>}<div><dt className="text-xs text-muted-foreground">Monthly allowance in {monthLabel}</dt><dd className="mt-1 text-sm">{(()=>{const quota=reviewMonthQuota(history,input);return quota==null ? '—' : `${quota}h`;})()}</dd></div></dl>
            <div className="space-y-2"><h3 className="text-sm font-semibold">{monthLabel} coverage</h3><ul className="space-y-1 text-sm">{lines.map(line=><li key={`${line.startsOn}:${line.endsOn}`}>{line.text}</li>)}</ul></div>
            {input.kind==='end' ? <p className="text-sm leading-relaxed text-muted-foreground">Outputs stay as they are. Days after the signed end have no monthly allowance.{previous?.note ? ' The internal note already on this agreement stays.' : input.note ? ' The note is saved on the agreement.' : ''}</p> : <div className="space-y-3"><h3 className="text-sm font-semibold">{input.title}</h3><p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{input.scope}</p>
                <OutputList title="Kept" empty="None" rows={diff.kept.map(service=>`${service.quantity} ${service.title} · ${issued(service)}`)} />
                <OutputList title="Renamed" empty="None" rows={diff.renamed.map(change=>`${change.before.title} → ${change.after.title} · ${issued(change.after)}`)} />
                <OutputList title="Added" empty="None" rows={diff.added.map(service=>`${service.quantity} ${service.title || 'Untitled output'} · ${issued(service)}`)} />
                <OutputList title="Stopped" empty="None" rows={diff.stopped.map(service=>`${service.title} · ${issued(service)}`)} />
            </div>}
            {input.kind!=='initial' && input.kind!=='end' && <fieldset className="space-y-3"><legend className="text-sm font-semibold">Unfinished work</legend><p className="text-sm leading-relaxed text-muted-foreground">Existing tasks keep their comments, approvals, and original promise. Select tasks whose effort from {agreementDateLabel(input.startsOn)} should use this {input.kind==='amendment' ? 'amended scope' : input.kind==='supersede' ? 'superseding agreement' : 'renewal'}. Unselected work remains funded by the previous scope.</p>{preview.openTasks.length===0 ? <p className="text-sm text-muted-foreground">No unfinished tasks to review.</p> : <div className="max-h-56 space-y-1 overflow-y-auto">{preview.openTasks.map(task=><label key={task.id} className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted"><input className="mt-1" type="checkbox" checked={input.fundedTaskIds.includes(task.id)} onChange={e=>update('fundedTaskIds',e.target.checked ? [...input.fundedTaskIds,task.id] : input.fundedTaskIds.filter(id=>id!==task.id))} /><span className="text-sm leading-relaxed">{task.title}</span></label>)}</div>}</fieldset>}
            {backdated && <div className="space-y-1 border-t border-border pt-4"><h3 className="text-sm font-semibold">Historical terms will be applied</h3><p className="text-sm leading-relaxed text-muted-foreground">{preview.affectedHours} confirmed budget hours were recorded on or after this date. Their work dates stay unchanged; scope attribution will follow the dates and task selections above.</p><p className="text-sm leading-relaxed text-muted-foreground">Published report snapshots stay as they were sent. Live fulfillment and workspace gauges follow these dates. Month close uses each agreement’s allowance for that month. The Results ledger stays unchanged until a deliverable is published with a URL and ship date.</p>{preview.affectedReports>0 && <p className="text-sm leading-relaxed text-muted-foreground">{preview.affectedReports} published {preview.affectedReports===1 ? 'report was' : 'reports were'} already sent for this period. Those sent copies stay frozen.</p>}</div>}
            <p className="text-xs leading-relaxed text-muted-foreground">{input.kind==='end' ? 'Logging, published reports, and issued deliverables stay on their dates.' : 'The original launch, integrations, and working SEO Plan stay in place. A snapshot of the plan is saved with these terms. Unused hours do not transfer automatically.'}</p>
            <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4"><Button variant="outline" size="lg" type="button" disabled={busy} onClick={()=>{setPreview(null);setError(null);request.current=null;}}><ArrowLeft className="h-4 w-4" />Edit terms</Button><Button type="button" size="lg" disabled={busy} onClick={()=>void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? 'Saving agreement…' : input.kind==='end' ? 'Record end date' : input.startsOn>today ? 'Schedule agreement' : 'Confirm agreement'}</Button></div>
        </div>}
    </DialogContent></Dialog>;
}

function OutputList({title,rows,empty}:{title:string;rows:string[];empty:string}) {
    return <div className="space-y-1"><h3 className="text-sm font-semibold">{title}</h3>{rows.length===0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="space-y-1 text-sm text-muted-foreground">{rows.map((row,index)=><li key={`${title}:${index}`}>{row}</li>)}</ul>}</div>;
}
