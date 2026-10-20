import { setupHoursStatus, type SetupHoursStatus } from '../client-setup';
import type { CampaignPlan, ClientProject, FulfillmentCell, Task } from '../types';
import { daysLeftInMonth, getFulfillmentMatrix } from './fulfillment';
import { getLoggedHoursByClient } from './time-logs';
import { getTasks } from './tasks';
import { getCampaignPlan } from './campaign-plans';
import { getMarketingPlan } from './marketing-plans';
import { getClientChangeLog, seoHoursFromChangeLog } from './change-log';
import { loadOverviewParts } from './client-overview-load';
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
        status: HoursStatusResult | SetupHoursStatus;
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
    return task.status !== 'done';
}

function campaignPlanSummary(plan: CampaignPlan | null): ClientOverview['campaignPlan'] {
    if (!plan) return { exists: false };
    return { exists: true, status: plan.status, title: plan.title };
}

const OVERVIEW_READ_MS = 15_000;
const overviewReads = new Map<string, { at: number; pending: ReturnType<typeof beginClientOverviewReads> }>();

type OverviewRead = [
    Record<string, number>,
    Awaited<ReturnType<typeof getFulfillmentMatrix>>,
    Awaited<ReturnType<typeof getTasks>>,
    Awaited<ReturnType<typeof getCampaignPlan>>,
    Awaited<ReturnType<typeof getMarketingPlan>>,
    Awaited<ReturnType<typeof getClientChangeLog>>,
];

/**
 * Start every overview read as soon as the client id is known. The page calls
 * this beside the single-client fetch so the widget does not wait on it.
 */
export function beginClientOverviewReads(
    orgId: string,
    clientId: string,
    month: string = currentMonthKey(),
): Promise<OverviewRead> {
    const key = `${orgId}:${clientId}:${month}`;
    const hit = overviewReads.get(key);
    if (hit && Date.now() - hit.at < OVERVIEW_READ_MS) return hit.pending;
    const pending = loadOverviewParts({
        hours: () => getLoggedHoursByClient(orgId, month, clientId),
        fulfillment: () => getFulfillmentMatrix(orgId, month, { clientId }),
        tasks: () => getTasks(orgId, { clientId }),
        plan: () => getCampaignPlan(clientId),
        marketingPlan: () => getMarketingPlan(clientId),
        changeLog: () => getClientChangeLog(orgId, clientId),
    });
    overviewReads.set(key, { at: Date.now(), pending });
    void pending.catch(() => {
        const current = overviewReads.get(key);
        if (current?.pending === pending) overviewReads.delete(key);
    });
    return pending;
}

export async function getClientOverview(
    client: ClientProject,
    orgId: string,
    month: string = currentMonthKey(),
): Promise<ClientOverview> {
    const [hoursByClient, fulfillment, tasks, plan, marketingPlan, changeLog] = await beginClientOverviewReads(orgId, client.id, month);

    const hoursLogged = hoursByClient[client.id] ?? 0;
    const quota = client.setupScope?.mode === 'custom' ? null : seoHoursFromChangeLog(changeLog, month, client.seoHours);
    const hoursBudget = quota ?? 0;
    const hoursStatus = client.setupScope ? setupHoursStatus(client.setupScope, client.status, client.launchDate, hoursLogged, hoursBudget, month) : hoursUsageStatus(hoursLogged, hoursBudget);
    const daysLeft = daysLeftInMonth(month);
    const cells = fulfillment.cells.map((cell) => ({
        ...cell,
        status: fulfillmentStatus({ ...cell, daysLeftInMonth: daysLeft }),
    }));
    const overdueDeliverables = cells.reduce((sum, cell) => sum + cell.overdue, 0);
    const atRiskDeliverables = cells.filter((cell) => cell.status.severity === 'warn' || cell.status.severity === 'critical').length;
    const openTasks = tasks.filter(isOpenTask);
    const blockedTasks = openTasks.filter((task) => Boolean(task.blockedReason?.trim())).length;
    const hasCampaignPlan = Boolean(marketingPlan || plan);

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
        campaignPlan: marketingPlan ? { exists: true, title: marketingPlan.title } : campaignPlanSummary(plan),
        nextBestActions: computeNextBestActions({
            ...scoreInput,
            hoursLogged,
            hoursBudget,
            openTasks: openTasks.length,
            atRiskDeliverables,
        }),
    };
}
