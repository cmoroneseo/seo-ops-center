'use client';

import {useState} from 'react';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from '@/components/ui/dialog';
import {agreementLabel} from '@/lib/agreements/logic';
import type {ClientAgreement} from '@/lib/agreements/types';
import {agreementDateLabel} from './AgreementFlow';

const actionClass='inline-flex min-h-10 items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
interface Props {
    open:boolean;
    onOpenChange:(open:boolean)=>void;
    clientName:string;
    history:ClientAgreement[];
    today:string;
    currentId?:string;
    canManage:boolean;
    busy:boolean;
    error:string|null;
    onChangeScope:()=>void;
    onCancel:(agreement:ClientAgreement)=>Promise<void>;
}
export function AgreementHistoryDialog({open,onOpenChange,clientName,history,today,currentId,canManage,busy,error,onChangeScope,onCancel}:Props) {
    const latest=history.filter(a=>!a.cancelledAt).at(-1);
    const future=history.some(a=>!a.cancelledAt && a.startsOn>today);
    return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <div className="space-y-2 pr-6">
                <DialogTitle className="text-xl">Agreement history</DialogTitle>
                <DialogDescription>{clientName} · Accepted terms and the SEO Plan at each confirmation.</DialogDescription>
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="divide-y divide-border">
                {[...history].reverse().map(agreement=><AgreementHistoryEntry key={agreement.id} agreement={agreement}
                    active={currentId===agreement.id} scheduled={!agreement.cancelledAt && agreement.startsOn>today}
                    canAmend={canManage && currentId===agreement.id && !future}
                    canCancel={canManage && latest?.id===agreement.id && agreement.startsOn>today && !agreement.cancelledAt}
                    busy={busy} onChangeScope={onChangeScope} onCancel={()=>onCancel(agreement)} />)}
            </div>
        </DialogContent>
    </Dialog>;
}

function AgreementHistoryEntry({agreement,active,scheduled,canAmend,canCancel,busy,onChangeScope,onCancel}:{
    agreement:ClientAgreement;active:boolean;scheduled:boolean;canAmend:boolean;canCancel:boolean;busy:boolean;
    onChangeScope:()=>void;onCancel:()=>Promise<void>;
}) {
    const [confirmCancel,setConfirmCancel]=useState(false);
    const items=agreement.planSnapshot?.items as Array<{id:string;title:string}>|undefined;
    return <article className="space-y-3 py-5 first:pt-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
            <div><h3 className="text-base font-semibold">{agreement.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{agreementLabel(agreement)} · {agreementDateLabel(agreement.startsOn)} — {agreementDateLabel(agreement.endsOn)}</p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{agreement.cancelledAt ? 'Cancelled before start' : scheduled ? 'Scheduled' : active ? 'Current' : 'Previous'}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{agreement.scope}</p>
        {agreement.hours!=null && <p className="text-xs text-muted-foreground">{agreement.mode==='monthly'
            ? `${agreement.hours} hours per month · ${agreement.hoursMode==='committed' ? 'commitment' : 'allowance'} · ${agreement.proration==='daily' ? 'day-prorated' : 'full-period allowance'}`
            : `${agreement.hours} hours · ${agreement.hoursMode==='estimate' ? 'planning estimate' : 'total allowance'}`}</p>}
        {agreement.services.length>0 && <ul className="space-y-1 text-sm text-muted-foreground">{agreement.services.map((s,i)=><li key={i}>{s.quantity} {s.title} · {s.cadence==='monthly' ? 'per month' : 'one-time'}</li>)}</ul>}
        {items && <details className="text-sm"><summary className="cursor-pointer rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">SEO Plan at confirmation · {items.length} items</summary>
            <ul className="mt-2 space-y-1 text-muted-foreground">{items.map((item,i)=><li key={item.id ?? i}>{item.title}</li>)}</ul>
        </details>}
        {agreement.evidence && <p className="break-words text-xs text-muted-foreground">Agreement reference: {agreement.evidence}</p>}
        {agreement.note && <p className="whitespace-pre-wrap text-xs text-muted-foreground">Internal note: {agreement.note}</p>}
        <p className="text-xs text-muted-foreground">Recorded {new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeZone:agreement.timezone}).format(new Date(agreement.recordedAt))}{agreement.kind==='amendment' ? ' · Scope change within the existing term' : ''}</p>
        {canAmend && <button type="button" className={actionClass} disabled={busy} onClick={onChangeScope}>Change scope</button>}
        {canCancel && <div className="space-y-2">
            {confirmCancel && <p className="text-sm">Cancel this scheduled agreement? Its terms stay in history and no new work will be generated for it.</p>}
            <div className="flex flex-wrap gap-2"><button type="button" className={actionClass} disabled={busy} onClick={()=>confirmCancel ? void onCancel().then(()=>setConfirmCancel(false)) : setConfirmCancel(true)}>{busy ? 'Cancelling…' : confirmCancel ? 'Confirm cancellation' : 'Cancel scheduled agreement'}</button>
                {confirmCancel && <button type="button" className={actionClass} disabled={busy} onClick={()=>setConfirmCancel(false)}>Keep scheduled</button>}
            </div>
        </div>}
    </article>;
}
