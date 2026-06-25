import type { CampaignPlan, ClientProject, FulfillmentCell, Task } from '../types';
import { daysLeftInMonth, getFulfillmentMatrix } from './fulfillment';
import { getLoggedHoursByClient } from './time-logs';
import { getTasks } from './tasks';
import { getCampaignPlan } from './campaign-plans';
import { fulfillmentStatus, hoursUsageStatus } from '../seo-ops-logic';
import type { HoursStatusResult, StatusResult } from '../seo-ops-logic';
import { computeHealthScore, computeNextBestActions } from './client-overview-logic';
import type { HealthScoreInput, NextBestAction } from './client-overview-logic';

export { computeHealthScore, computeNextBestActions };
export type { HealthScoreInput, NextBestAction, NextBestActionInput } from './client-overview-logic';

export interface ClientOverview {
    month: string;
    healthScore: number;
    hours: {
        logged: number;
        budget: number;
        status: HoursStatusResult;
    };
    tasks: {
        open: number;
        blocked: number;
    };
    deliverables: {
        promised: number;
        delivered: number;
        inProgress: number;
        overdue: number;
        atRisk: number;
        cells: Array<FulfillmentCell & { status: StatusResult<string> }>;
    };
    campaignPlan: {
        exists: boolean;
        status?: string;
        title?: string;
    };
    nextBestActions: NextBestAction[];
}

function currentMonthKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function isOpenTask(task: Task): boolean {
    return task.status !== 'done' && task.status !== 'approved';
}

function campaignPlanSummary(plan: CampaignPlan | null): ClientOverview['campaignPlan'] {
    if (!plan) return { exists: false };
    return { exists: true, status: plan.status, title: plan.title };
}

export async function getClientOverview(
    client: ClientProject,
    orgId: string,
    month: string = currentMonthKey(),
): Promise<ClientOverview> {
    const [hoursByClient, fulfillment, tasks, plan] = await Promise.all([
        getLoggedHoursByClient(orgId, month),
        getFulfillmentMatrix(orgId, month, { clientId: client.id }),
        getTasks(orgId, { clientId: client.id }),
        getCampaignPlan(client.id),
    ]);

    const hoursLogged = hoursByClient[client.id] ?? 0;
    const hoursBudget = client.seoHours || client.retainerConfig?.monthlyHours || client.campaignConfig?.totalHours || 0;
    const hoursStatus = hoursUsageStatus(hoursLogged, hoursBudget);
    const daysLeft = daysLeftInMonth(month);
    const cells = fulfillment.cells.map((cell) => ({
        ...cell,
        status: fulfillmentStatus({ ...cell, daysLeftInMonth: daysLeft }),
    }));
    const overdueDeliverables = cells.reduce((sum, cell) => sum + cell.overdue, 0);
    const atRiskDeliverables = cells.filter((cell) => cell.status.severity === 'warn' || cell.status.severity === 'critical').length;
    const openTasks = tasks.filter(isOpenTask);
    const blockedTasks = openTasks.filter((task) => task.status === 'blocked').length;
    const hasCampaignPlan = Boolean(plan);

    const scoreInput: HealthScoreInput = {
        overdueDeliverables,
        hoursSeverity: hoursStatus.severity,
        blockedTasks,
        hasCampaignPlan,
    };

    return {
        month,
        healthScore: computeHealthScore(scoreInput),
        hours: {
            logged: hoursLogged,
            budget: hoursBudget,
            status: hoursStatus,
        },
        tasks: {
            open: openTasks.length,
            blocked: blockedTasks,
        },
        deliverables: {
            promised: cells.reduce((sum, cell) => sum + cell.promised, 0),
            delivered: cells.reduce((sum, cell) => sum + cell.delivered, 0),
            inProgress: cells.reduce((sum, cell) => sum + cell.inProgress, 0),
            overdue: overdueDeliverables,
            atRisk: atRiskDeliverables,
            cells,
        },
        campaignPlan: campaignPlanSummary(plan),
        nextBestActions: computeNextBestActions({
            ...scoreInput,
            hoursLogged,
            hoursBudget,
            openTasks: openTasks.length,
            atRiskDeliverables,
        }),
    };
}
