import { createClient } from './client';
import { Deliverable, DeliverableCommitment, FulfillmentCell } from '../types';
import { getCommitments } from './commitments';
import { getDeliverables } from './deliverables';
import {getAgreementHistory} from './agreements';
import {commitmentExpectedQuantity} from '../agreements/commitments';
import { buildFulfillmentCells } from '../deliverables/fulfillment-cells';

export interface FulfillmentMatrixData {
    month: string; // 'YYYY-MM'
    cells: FulfillmentCell[];
    commitments: DeliverableCommitment[];
    deliverables: Deliverable[];
}

/** Days remaining in a 'YYYY-MM' month from today (0 if the month is past). */
export function daysLeftInMonth(month: string, today: Date = new Date()): number {
    const [y, m] = month.split('-').map(Number);
    const monthEnd = new Date(y, m, 0);
    if (today > monthEnd) return 0;
    const monthStart = new Date(y, m - 1, 1);
    const from = today < monthStart ? monthStart : today;
    return Math.max(0, Math.round((monthEnd.getTime() - from.getTime()) / 86400000) + 1);
}

/**
 * Promised vs delivered per client+type for a month, computed on read.
 * Two indexed fetches (active commitments + the month's deliverables),
 * joined in TS — the codebase's compute-on-read pattern.
 */
export async function getFulfillmentMatrix(
    organizationId: string,
    month: string,
    opts: { clientId?: string } = {},
): Promise<FulfillmentMatrixData> {
    const supabase = createClient();
    if (!supabase) return { month, cells: [], commitments: [], deliverables: [] };

    const [commitments, deliverables,history] = await Promise.all([
        getCommitments(organizationId, { clientId: opts.clientId }),
        getDeliverables(organizationId, { clientId: opts.clientId, month }),
        getAgreementHistory(organizationId,opts.clientId),
    ]);

    const issuedElsewhere=new Map<string,number>();
    await Promise.all(commitments.filter(cm=>cm.cadence==='one_time' && cm.customFields?.agreementOutputRoot).map(async cm=>{
        const root=cm.customFields?.agreementOutputRoot;
        const others=commitments.filter(other=>other.id!==cm.id && other.clientId===cm.clientId && (other.id===root || other.customFields?.agreementOutputRoot===root)).map(other=>other.id);
        if(!others.length)return;
        const {count,error}=await supabase.from('deliverables').select('id',{count:'exact',head:true}).eq('organization_id',organizationId).in('commitment_id',others);
        if(error)throw error;
        issuedElsewhere.set(cm.id,count ?? 0);
    }));
    const today = new Date();
    const cells = buildFulfillmentCells(
        commitments.map(cm => ({
            id: cm.id,
            clientId: cm.clientId,
            type: cm.type,
            expected: commitmentExpectedQuantity(cm, month, history.agreements, issuedElsewhere.get(cm.id)),
        })),
        deliverables,
        today,
    );

    return { month, cells, commitments, deliverables };
}
