import { readWorkMonth, workMonthLabel } from '../topical-map/production';

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

export function plannedPieces(
    records: ReadonlyArray<{ status: string; workMonth?: string | null }>,
    month: string,
): number {
    const target = readWorkMonth(month);
    if (!target) return 0;
    return records.filter(record => record.status === 'approved' && readWorkMonth(record.workMonth) === target).length;
}

/** How many approved pages the month will have once this page is placed there. */
export function plannedAfterApproval(
    records: ReadonlyArray<{ id: string; status: string; workMonth?: string | null }>,
    recordId: string,
    month: string,
): number {
    const target = readWorkMonth(month);
    if (!target) return 0;
    const others = records.filter(record =>
        record.id !== recordId
        && record.status === 'approved'
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
