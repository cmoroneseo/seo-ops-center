'use client';

import {useCallback,useEffect,useState} from 'react';
import {CalendarClock,History,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {AgreementHistoryDialog} from './AgreementHistoryDialog';
import {useCurrentMember} from '@/lib/hooks/useCurrentMember';
import {getAgreementHistory,previewAgreement,confirmAgreement,cancelScheduledAgreement} from '@/lib/supabase/agreements';
import {getCommitments} from '@/lib/supabase/commitments';
import {agreementCoverageEnd,agreementForDate,agreementToday,agreementLabel} from '@/lib/agreements/logic';
import type {AgreementAction,AgreementInput,ClientAgreement} from '@/lib/agreements/types';
import type {ClientProject} from '@/lib/types';
import {AgreementFlow,agreementDateLabel} from './AgreementFlow';

export function ClientAgreementSummary({client,onChanged}:{client:ClientProject;onChanged:()=>Promise<void>}) {
    const {role,isLoading}=useCurrentMember();
    const canManage=!isLoading && (role==='owner' || role==='admin');
    const [history,setHistory]=useState<ClientAgreement[]>(client.agreements ?? []);
    const [available,setAvailable]=useState(false);
    const [loading,setLoading]=useState(true);
    const [error,setError]=useState<string|null>(null);
    const [success,setSuccess]=useState<string|null>(null);
    const [showHistory,setShowHistory]=useState(false);
    const [flow,setFlow]=useState<{input:AgreementInput;previous:ClientAgreement|null}|null>(null);
    const [preparing,setPreparing]=useState(false);
    const [cancelling,setCancelling]=useState<string|null>(null);
    const load=useCallback(async()=>{
        setLoading(true);setError(null);
        try {const result=await getAgreementHistory(client.organizationId,client.id,true,true);setHistory(result.agreements);setAvailable(result.available);} catch(e){setError(e instanceof Error ? e.message : 'Agreement history unavailable.');} finally {setLoading(false);}
    },[client.id,client.organizationId]);
    useEffect(()=>{void load();},[load]);
    const live=history.filter(a=>!a.cancelledAt);
    const latest=live.at(-1) ?? null;
    const timezone=latest?.timezone ?? 'America/Los_Angeles';
    const today=agreementToday(timezone);
    const current=agreementForDate(live,today);
    const future=live.find(a=>a.startsOn>today);
    const start=async(kind:AgreementAction)=>{
        setPreparing(true);setError(null);setSuccess(null);
        try {
            const previous=kind==='initial' ? null : latest;
            if(kind!=='initial' && !previous) throw new Error('Record the original agreement first.');
            const services=kind==='end' ? [] : previous?.services ?? (await getCommitments(client.organizationId,{clientId:client.id,throwOnError:true})).filter(c=>c.isActive && c.cadence!=='quarterly' && !/^SEO Hours$/i.test(c.title)).map(c=>({sourceId:c.id,title:c.title,type:c.type,subtype:c.subtype,quantity:c.cadence==='one_time' ? c.totalQuantity ?? 1 : c.quantityPerMonth,cadence:c.cadence as 'monthly'|'one_time',countsTowardHours:c.countsTowardHours}));
            const mode=previous?.mode ?? client.setupScope?.mode ?? (client.engagementModel==='Campaign' ? 'custom' : 'monthly');
            const dayAfter=previous?.endsOn ? new Date(Date.parse(`${previous.endsOn}T00:00:00Z`)+86400000).toISOString().slice(0,10) : '';
            const defaultStart=kind==='end' ? previous?.startsOn ?? '' : kind==='renewal' ? dayAfter : kind==='initial' ? client.launchDate ?? client.onboardingDate ?? '' : today;
            const title=kind==='initial' ? 'Original agreement' : kind==='renewal' ? 'Renewed agreement' : kind==='supersede' ? 'Superseding agreement' : kind==='end' ? previous?.title ?? 'Agreement' : 'Scope amendment';
            setFlow({previous,input:{kind,previousId:previous?.id ?? null,title,startsOn:defaultStart,endsOn:kind==='amendment' || kind==='end' ? previous?.endsOn ?? null : null,mode,hours:previous?.hours ?? (mode==='monthly' ? client.seoHours : client.campaignConfig?.totalHours ?? null),hoursMode:previous?.hoursMode ?? (mode==='custom' ? 'estimate' : client.setupScope?.hoursMode ?? 'committed'),proration:previous?.proration ?? 'daily',timezone,scope:previous?.scope ?? client.deliverables ?? '',services,evidence:null,note:null,fundedTaskIds:[]}});
            setShowHistory(false);
        } catch(e){setError(e instanceof Error ? e.message : 'Could not load agreement terms.');} finally{setPreparing(false);}
    };
    const cancelled=async(agreement:ClientAgreement)=>{
        setCancelling(agreement.id);setError(null);
        try {await cancelScheduledAgreement(client.id,agreement.id);await load();await onChanged();setSuccess('Scheduled agreement cancelled. Earlier terms are preserved.');}catch(e){setError(e instanceof Error ? e.message : 'Could not cancel the scheduled agreement.');}finally{setCancelling(null);}
    };
    if(loading && !history.length) return <p role="status" className="text-xs text-muted-foreground">Loading agreement…</p>;
    if(!available && !error) return null;
    return <>
        <section aria-label="Client agreement" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-y border-border py-3">
            <div className="flex min-w-0 items-start gap-2.5"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 space-y-1"><p className="text-sm font-medium">{current ? `${agreementLabel(current)} · ${current.title}` : latest ? 'Agreement ended' : 'Agreement history'}</p><p className="text-xs text-muted-foreground">{current ? `${agreementDateLabel(current.startsOn)} — ${agreementDateLabel(agreementCoverageEnd(current,live))}` : latest ? 'Review the next agreement; unfinished work remains available.' : 'Record the agreed terms before adding a renewal.'}{future && ` · Next agreement ${agreementDateLabel(future.startsOn)}`}</p></div></div>
            <div className="flex flex-wrap items-center gap-2">{history.length>0 && <Button type="button" variant="outline" size="lg" onClick={()=>setShowHistory(true)}><History className="h-4 w-4" />Agreement history</Button>}{canManage && !future && !latest && <Button type="button" size="lg" disabled={preparing || !!error} onClick={()=>void start('initial')}>{preparing && <Loader2 className="h-4 w-4 animate-spin" />}Record agreement</Button>}{canManage && !future && latest && <>
                <Button type="button" variant="outline" size="lg" disabled={preparing || !!error} onClick={()=>void start('supersede')}>Supersede on date</Button>
                <Button type="button" variant="outline" size="lg" disabled={preparing || !!error} onClick={()=>void start('end')}>End on date</Button>
                <Button type="button" variant="outline" size="lg" disabled={preparing || !!error} onClick={()=>void start('renewal')}>Renew</Button>
            </>}</div>
        </section>
        {success && <p role="status" className="text-sm text-muted-foreground">{success}</p>}
        {error && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">{error}<Button type="button" variant="outline" size="sm" onClick={()=>void load()}>Retry</Button></p>}
        <AgreementHistoryDialog open={showHistory} onOpenChange={setShowHistory} clientName={client.clientName} history={history} today={today} currentId={current?.id} canManage={canManage} busy={preparing || cancelling!==null} error={error} onChangeScope={()=>void start('amendment')} onCancel={cancelled} />
        {flow && <AgreementFlow clientName={client.clientName} initial={flow.input} previous={flow.previous} agreements={history} onClose={()=>setFlow(null)} onReview={input=>previewAgreement({...client,agreements:history},input)} onConfirm={async(input,preview,requestId)=>{
            await confirmAgreement(client.id,input,preview.token,requestId,history);
            setFlow(null);await load();await onChanged();setSuccess(input.kind==='end' ? 'Signed end date recorded. Coverage includes that date.' : input.startsOn>today ? 'Agreement scheduled. Current terms stay in effect until its start date.' : 'Agreement saved. The client workspace and prior history are preserved.');
        }} />}
    </>;
}
