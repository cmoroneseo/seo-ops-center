import { createClient } from './client';
import { Deliverable, DeliverableCommitment, FulfillmentCell } from '../types';
import { getCommitments } from './commitments';
import { getDeliverables } from './deliverables';
import { proratedQuantity } from '../seo-ops-logic';
import { buildFulfillmentCells } from '../deliverables/fulfillment-cells';

export interface FulfillmentMatrixData {
    month: string; // 'YYYY-MM'
    cells: FulfillmentCell[];
    commitments: DeliverableCommitment[];
    deliverables: Deliverable[];
}

/** Promised count for one commitment in a month, from its own dates and cadence. */
function commitmentExpected(commitment: DeliverableCommitment, month: string): number {
    if (!commitment.isActive && !commitment.endsOn) return 0;
    if (commitment.cadence === 'one_time') {
        const anchor = commitment.endsOn ?? commitment.startsOn;
        return anchor.slice(0, 7) === month ? commitment.totalQuantity ?? 0 : 0;
    }
    if (commitment.cadence !== 'monthly') return 0;
    return proratedQuantity({
        startsOn: commitment.startsOn,
        endsOn: commitment.endsOn,
        quantityPerMonth: commitment.quantityPerMonth,
    }, month);
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
    if (!createClient()) return { month, cells: [], commitments: [], deliverables: [] };

    const [commitments, deliverables] = await Promise.all([
        getCommitments(organizationId, { clientId: opts.clientId }),
        getDeliverables(organizationId, { clientId: opts.clientId, month }),
    ]);

    const today = new Date();
    const cells = buildFulfillmentCells(
        commitments.map(cm => ({
            id: cm.id,
            clientId: cm.clientId,
            type: cm.type,
            expected: commitmentExpected(cm, month),
        })),
        deliverables,
        today,
    );

    return { month, cells, commitments, deliverables };
}
