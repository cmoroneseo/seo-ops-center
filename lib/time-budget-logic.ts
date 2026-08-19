/**
 * time-budget-logic.ts
 * -----------------------------------------------------------------------------
 * Pure rules for turning time logs into hours, kept out of the Supabase layer so
 * they can be tested.
 *
 * The distinction these encode:
 *
 *   - "tracked"  — we recorded that this time happened
 *   - "budget"   — this time consumes the client's SEO hours
 *
 * A client meeting is tracked and is often billable, but must not eat
 * deliverable budget. Internal work is tracked against no client at all.
 */

/** The only fields the hour rules care about. */
export interface BudgetableLog {
    clientId?: string;
    hours: number;
    countsTowardBudget: boolean;
}

/**
 * Hours consumed against each client's SEO budget.
 *
 * Excludes internal work (no client) and anything flagged as not counting.
 */
export function sumBudgetHoursByClient(logs: BudgetableLog[]): Record<string, number> {
    return logs.reduce<Record<string, number>>((acc, l) => {
        if (!l.clientId || !l.countsTowardBudget) return acc;
        acc[l.clientId] = round2((acc[l.clientId] ?? 0) + l.hours);
        return acc;
    }, {});
}

/** Every hour tracked against a client, budget-consuming or not. */
export function sumTrackedHoursByClient(logs: BudgetableLog[]): Record<string, number> {
    return logs.reduce<Record<string, number>>((acc, l) => {
        if (!l.clientId) return acc;
        acc[l.clientId] = round2((acc[l.clientId] ?? 0) + l.hours);
        return acc;
    }, {});
}

/** Hours with no client attached — internal meetings, admin, and the like. */
export function sumInternalHours(logs: BudgetableLog[]): number {
    return round2(logs.reduce((total, l) => (l.clientId ? total : total + l.hours), 0));
}

/** Float addition drifts; hours are displayed to two places. */
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
