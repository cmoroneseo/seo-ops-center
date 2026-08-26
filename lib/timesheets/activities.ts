import { SEO_ACTIVITIES, type ScopeActivity } from '../scope-estimates.ts';

/**
 * The activity vocabulary a timesheet entry can be tagged with.
 *
 * Wraps the scope-estimates catalog rather than duplicating it, so capacity
 * planning and time tracking always name the same work the same way. The one
 * thing added here is budget semantics: choosing an activity answers both
 * "what was this?" and "does it consume the client's SEO hours?".
 */

export interface TimesheetActivity extends ScopeActivity {
    /** Default for time_logs.counts_toward_budget. Overridable per entry. */
    countsTowardBudget: boolean;
}

/**
 * Work that is tracked and often billable but must never eat deliverable
 * budget. The scope-estimates catalog has no equivalent because it models
 * contracted deliverables, not the whole working day.
 */
const NON_DELIVERY: TimesheetActivity[] = [
    {
        key: 'client_meeting', label: 'Client Meeting', category: 'Non-billable to budget',
        minHours: 0.5, maxHours: 1.5, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'account_management', label: 'Account Management & Comms', category: 'Non-billable to budget',
        minHours: 0.25, maxHours: 1, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'internal_admin', label: 'Internal Admin', category: 'Non-billable to budget',
        minHours: 0.25, maxHours: 2, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'training', label: 'Training & Learning', category: 'Non-billable to budget',
        minHours: 0.5, maxHours: 4, frequency: 'monthly', countsTowardBudget: false,
    },
];

export const TIMESHEET_ACTIVITIES: TimesheetActivity[] = [
    ...SEO_ACTIVITIES.map(activity => ({ ...activity, countsTowardBudget: true })),
    ...NON_DELIVERY,
];

const BY_KEY = new Map(TIMESHEET_ACTIVITIES.map(activity => [activity.key, activity]));

export function findActivity(key: string): TimesheetActivity | null {
    return BY_KEY.get(key) ?? null;
}

/**
 * Budget default for a set of activities.
 *
 * True when ANY selected activity bills: a block tagged both Technical SEO
 * Audit and Internal Admin still did billable delivery work. An unrecognized
 * key contributes nothing, so a bad key can never silently bill a client.
 *
 * This is only ever a DEFAULT, offered on first selection. Real reviewed data
 * shows eligibility is not derivable from the activity — the same activity
 * bills for one client and not another — so the user's explicit choice owns
 * `counts_toward_budget` and must never be silently recomputed from here.
 */
export function budgetDefaultFor(keys: string[]): boolean {
    return keys.some(key => findActivity(key)?.countsTowardBudget ?? false);
}

/**
 * The human description stored on the ledger row.
 *
 * Labels are joined in CATALOG order rather than selection order, so the same
 * set of activities always reads the same way no matter how it was picked.
 */
export function describeActivity(keys: string[], detail: string): string {
    const selected = new Set(keys);
    const label = TIMESHEET_ACTIVITIES
        .filter(activity => selected.has(activity.key))
        .map(activity => activity.label)
        .join(', ');
    const trimmed = detail.trim();
    if (!label) return trimmed;
    return trimmed ? `${label} — ${trimmed}` : label;
}
