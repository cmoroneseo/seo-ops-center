/**
 * Logged hours and fulfillment for the Campaign Overview scope strip.
 *
 * Retainer months use the same filter as getLoggedHoursByClient: the budget
 * month, countable imports, and entries that count toward the SEO budget.
 * A failed read stays null. It is not zero, and stored config hours are not read.
 *
 * A campaign-package contract sums those same budget logs inside the engagement
 * dates. Without both dates the used figure stays null.
 * This module does not read or write the strategy-builder plan.
 */

import type { FulfillmentCell } from '@/lib/types';
import { getFulfillmentMatrix } from '@/lib/supabase/fulfillment';
import { getTimeLogs } from '@/lib/supabase/time-logs';
import { sumBudgetHoursByClient } from '@/lib/time-budget-logic';
import { budgetHoursInRange, hoursWindow, type EngagementFacts } from './briefing';

export interface ScopeEvidence {
    month: string;
    loggedHours: number | null;
    cells: FulfillmentCell[] | null;
}

async function loggedHoursFor(
    organizationId: string,
    clientId: string,
    engagement: EngagementFacts,
    month: string,
): Promise<number | null> {
    const window = hoursWindow(engagement, month);
    if (window.kind === 'unavailable') return null;
    if (window.kind === 'range') {
        const logs = await getTimeLogs(organizationId, { clientId, throwOnError: true });
        return budgetHoursInRange(logs, clientId, window.start, window.end);
    }
    const logs = await getTimeLogs(organizationId, {
        clientId,
        month: window.month,
        budgetMonth: true,
        throwOnError: true,
    });
    return sumBudgetHoursByClient(logs)[clientId] ?? 0;
}

async function fulfillmentCells(
    organizationId: string,
    clientId: string,
    month: string,
): Promise<FulfillmentCell[]> {
    const matrix = await getFulfillmentMatrix(organizationId, month, { clientId });
    return matrix.cells.filter(cell => cell.clientId === clientId);
}

export async function loadScopeEvidence(input: {
    organizationId: string;
    clientId: string;
    engagement: EngagementFacts;
    month: string;
}): Promise<ScopeEvidence> {
    const [loggedHours, cells] = await Promise.all([
        loggedHoursFor(input.organizationId, input.clientId, input.engagement, input.month).catch(() => null),
        fulfillmentCells(input.organizationId, input.clientId, input.month).catch(() => null),
    ]);
    return { month: input.month, loggedHours, cells };
}
