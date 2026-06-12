import { createClient } from './client';
import { Deliverable, DeliverableCommitment, DeliverableType, FulfillmentCell } from '../types';
import { proratedQuantity } from '../seo-ops-logic';
import { getCommitments } from './commitments';
import { getDeliverables } from './deliverables';

const DELIVERED_STATUSES = ['Approved', 'Published'];
const IN_PRODUCTION_STATUSES = ['In Progress', 'Review'];

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

function isOverdue(d: Deliverable, today: Date): boolean {
    if (!d.dueDate || DELIVERED_STATUSES.includes(d.status)) return false;
    return new Date(d.dueDate) < new Date(today.toISOString().slice(0, 10));
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

    const [commitments, deliverables] = await Promise.all([
        getCommitments(organizationId, { clientId: opts.clientId, activeOnly: true }),
        getDeliverables(organizationId, { clientId: opts.clientId, month }),
    ]);

    const today = new Date();
    const cellMap = new Map<string, FulfillmentCell>();
    const cell = (clientId: string, type: DeliverableType): FulfillmentCell => {
        const key = `${clientId}:${type}`;
        let c = cellMap.get(key);
        if (!c) {
            c = { clientId, type, promised: 0, generated: 0, delivered: 0, inProgress: 0, overdue: 0 };
            cellMap.set(key, c);
        }
        return c;
    };

    for (const cm of commitments) {
        cell(cm.clientId, cm.type).promised += proratedQuantity(
            { quantityPerMonth: cm.quantityPerMonth, startsOn: cm.startsOn, endsOn: cm.endsOn },
            month,
        );
    }

    for (const d of deliverables) {
        const c = cell(d.clientId, d.type);
        c.generated += 1;
        if (DELIVERED_STATUSES.includes(d.status)) c.delivered += 1;
        else if (IN_PRODUCTION_STATUSES.includes(d.status)) c.inProgress += 1;
        if (isOverdue(d, today)) c.overdue += 1;
    }

    return { month, cells: Array.from(cellMap.values()), commitments, deliverables };
}
