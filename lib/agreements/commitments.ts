import {agreementCoverageEnd} from './logic';
import type {ClientAgreement} from './types';
import type {DeliverableCommitment} from '../types';
import {proratedQuantity} from '../seo-ops-logic';

export function commitmentWindow(commitment:DeliverableCommitment,agreements:ClientAgreement[]):{startsOn:string;endsOn?:string}|null {
    if(!commitment.agreementId) return commitment.isActive || commitment.endsOn ? {startsOn:commitment.startsOn,endsOn:commitment.endsOn} : null;
    const agreement=agreements.find(a=>a.id===commitment.agreementId);
    if(!agreement || agreement.cancelledAt) return null;
    let outputAgreement=agreement;
    for(;;) {
        const amendment=agreements.find(a=>a.previousId===outputAgreement.id && a.kind==='amendment' && !a.cancelledAt && a.services.some(s=>s.sourceId===commitment.id));
        if(!amendment)break;
        outputAgreement=amendment;
    }
    const end=agreementCoverageEnd(outputAgreement,agreements);
    const startsOn=commitment.startsOn>agreement.startsOn ? commitment.startsOn : agreement.startsOn;
    const endsOn=end && commitment.endsOn ? (end<commitment.endsOn ? end : commitment.endsOn) : end ?? commitment.endsOn;
    return endsOn && endsOn<startsOn ? null : {startsOn,endsOn:endsOn ?? undefined};
}
/** Re-evaluate a custom amendment after earlier outputs are issued, including between scheduling and activation. */
export function customOutputQuantity(commitment:DeliverableCommitment,issuedElsewhere=0):number {
    const agreed=Number(commitment.customFields?.agreedTotalQuantity);
    return Number.isFinite(agreed) && commitment.customFields?.agreementOutputRoot
        ? Math.max(0,agreed-issuedElsewhere) : commitment.totalQuantity ?? 0;
}
export function commitmentExpectedQuantity(commitment:DeliverableCommitment,month:string,agreements:ClientAgreement[],issuedElsewhere=0):number {
    const window=commitmentWindow(commitment,agreements);
    if(!window) return 0;
    if(commitment.cadence==='one_time') {
        const agreement=agreements.find(a=>a.id===commitment.agreementId);
        if(window.endsOn && agreement?.endsOn && window.endsOn<agreement.endsOn)return 0;
        return (agreement?.endsOn ?? window.startsOn).slice(0,7)===month ? customOutputQuantity(commitment,issuedElsewhere) : 0;
    }
    if(commitment.cadence!=='monthly') return 0;
    return proratedQuantity({...window,quantityPerMonth:commitment.quantityPerMonth},month);
}
