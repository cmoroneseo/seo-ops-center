import type { DeliverableType, FulfillmentCell } from '../types';

const DELIVERED_STATUSES = ['Approved', 'Published'];
const IN_PRODUCTION_STATUSES = ['In Progress', 'Review'];

export interface FulfillmentCommitmentInput {
    id: string;
    clientId: string;
    type: DeliverableType;
    /** Quantity this commitment promises in the selected month. */
    expected: number;
}

export interface FulfillmentDeliverableInput {
    clientId: string;
    type: DeliverableType;
    commitmentId?: string;
    status: string;
    dueDate?: string | null;
}

function isOverdue(deliverable: FulfillmentDeliverableInput, today: Date): boolean {
    if (!deliverable.dueDate || DELIVERED_STATUSES.includes(deliverable.status)) return false;
    return new Date(deliverable.dueDate) < new Date(today.toISOString().slice(0, 10));
}

/**
 * Promised counts come only from commitments. A deliverable with no commitment
 * still shows as generated work, and its promise stays unconfigured.
 */
export function buildFulfillmentCells(
    commitments: FulfillmentCommitmentInput[],
    deliverables: FulfillmentDeliverableInput[],
    today: Date = new Date(),
): FulfillmentCell[] {
    const cellMap = new Map<string, FulfillmentCell>();
    const cell = (clientId: string, type: DeliverableType): FulfillmentCell => {
        const key = `${clientId}:${type}`;
        let current = cellMap.get(key);
        if (!current) {
            current = {
                clientId,
                type,
                promised: 0,
                promisedConfigured: false,
                generated: 0,
                delivered: 0,
                inProgress: 0,
                overdue: 0,
            };
            cellMap.set(key, current);
        }
        return current;
    };

    for (const commitment of commitments) {
        const existing = deliverables.filter(deliverable => deliverable.commitmentId === commitment.id).length;
        const target = cell(commitment.clientId, commitment.type);
        // A later scope change cannot silently remove already-issued obligations.
        target.promised += Math.max(commitment.expected, existing);
        target.promisedConfigured = true;
    }

    for (const deliverable of deliverables) {
        const target = cell(deliverable.clientId, deliverable.type);
        target.generated += 1;
        if (DELIVERED_STATUSES.includes(deliverable.status)) target.delivered += 1;
        else if (IN_PRODUCTION_STATUSES.includes(deliverable.status)) target.inProgress += 1;
        if (isOverdue(deliverable, today)) target.overdue += 1;
    }

    return Array.from(cellMap.values());
}

/**
 * Headline promised count. No configured commitment is unknown ('—'), including
 * while cells have not loaded. A configured total of zero stays '0'.
 */
export function formatPromisedTotal(cells: Array<Pick<FulfillmentCell, 'promised' | 'promisedConfigured'>> | null): string {
    if (!cells || !cells.some(cell => cell.promisedConfigured)) return '—';
    const total = cells.reduce((sum, cell) => sum + (cell.promisedConfigured ? cell.promised : 0), 0);
    if (!Number.isFinite(total) || total < 0) return '—';
    return String(total);
}

/** Cell ratio. Unconfigured promises stay an em dash instead of borrowing the generated count. */
export function fulfillmentCellLabel(cell: Pick<FulfillmentCell, 'delivered' | 'promised' | 'promisedConfigured'>): string {
    return `${cell.delivered}/${cell.promisedConfigured ? cell.promised : '—'}`;
}
