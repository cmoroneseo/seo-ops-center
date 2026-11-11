import type { MapRecordAction, ProductionStatus } from '../types';
import { displayedProductionStatus, readWorkMonth, workMonthLabel } from '../topical-map/production';

/**
 * Monthly content plan from client setup.
 * A missing plan is null and shows as —. Zero is a real plan of no pages.
 * Going over the plan warns. It never blocks.
 */
export interface ContentQuota {
    planned: number;
    limit: number | null;
    label: string;
    warning: string | null;
}

export function contentPlanLimit(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
    return value;
}

export interface PlanCountable {
    status: string;
    productionStatus?: ProductionStatus | null;
    action?: MapRecordAction;
    matchedUrl?: string | null;
    workMonth?: string | null;
}

/** Statuses that use up a piece of the monthly plan. */
const PLAN_STATUSES: ReadonlySet<ProductionStatus> = new Set([
    'approved',
    'writing',
    'client_review',
    'ready',
    'published',
]);

/**
 * Approved counts every page that's approved, being written, in client
 * review, ready or published. A page that is already on the site, or that
 * could not be published, does not use up a piece.
 */
export function countsTowardPlan(record: PlanCountable): boolean {
    if (record.status !== 'approved') return false;
    const shown = displayedProductionStatus({
        status: 'approved',
        productionStatus: record.productionStatus,
        action: record.action ?? 'create',
        matchedUrl: record.matchedUrl,
    });
    return PLAN_STATUSES.has(shown);
}

export function plannedPieces(records: ReadonlyArray<PlanCountable>, month: string): number {
    const target = readWorkMonth(month);
    if (!target) return 0;
    return records.filter(record => countsTowardPlan(record) && readWorkMonth(record.workMonth) === target).length;
}

/** How many approved pages the month will have once this page is placed there. */
export function plannedAfterApproval(
    records: ReadonlyArray<PlanCountable & { id: string }>,
    recordId: string,
    month: string,
): number {
    const target = readWorkMonth(month);
    if (!target) return 0;
    const others = records.filter(record =>
        record.id !== recordId
        && countsTowardPlan(record)
        && readWorkMonth(record.workMonth) === target,
    ).length;
    return others + 1;
}

export function contentQuota(planned: number, limit: number | null | undefined, month: string): ContentQuota {
    const count = Number.isFinite(planned) && planned > 0 ? Math.floor(planned) : 0;
    const plan = contentPlanLimit(limit);
    const monthName = workMonthLabel(month);
    if (plan == null || !monthName) {
        return { planned: count, limit: null, label: '—', warning: null };
    }
    return {
        planned: count,
        limit: plan,
        label: `${count} of ${plan} pieces planned for ${monthName}`,
        warning: count > plan ? `This goes over the ${plan} pieces in this month's plan.` : null,
    };
}
