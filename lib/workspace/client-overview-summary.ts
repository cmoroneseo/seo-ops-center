import { setupHoursStatus } from '../client-setup';
import { fulfillmentStatus, hoursUsageStatus } from '../seo-ops-logic';
import { computeHealthScore, type HealthScoreInput } from '../supabase/client-overview-logic';
import { isOverdueTask } from '../tasks/my-tasks';
import type { ClientProject, FulfillmentCell, Task } from '../types';

export function clientHealthLabel(score: number): 'Healthy' | 'Watch' | 'Critical' {
    return score >= 85 ? 'Healthy' : score >= 70 ? 'Watch' : 'Critical';
}

export interface WorkspaceClientOverview extends HealthScoreInput {
    health: ReturnType<typeof clientHealthLabel>;
    openTasks: number;
    overdueTasks: number;
    nextDueDate: string | null;
    hoursLogged: number;
}

export interface WorkspaceOverviewData {
    today: string;
    daysLeft: number;
    tasks: Pick<Task, 'clientId' | 'status' | 'dueDate' | 'blockedReason'>[];
    cells: Pick<FulfillmentCell, 'clientId' | 'promised' | 'delivered' | 'inProgress' | 'overdue'>[];
    hoursByClient: Record<string, number>;
    campaignClientIds: string[];
    marketingClientIds: string[];
}

export function buildClientOverviewSummaries(
    clients: Pick<ClientProject, 'id' | 'seoHours' | 'setupScope' | 'status' | 'launchDate'>[],
    { today, daysLeft, tasks, cells, hoursByClient, campaignClientIds, marketingClientIds }: WorkspaceOverviewData,
): Record<string, WorkspaceClientOverview> {
    const plans = new Set([...campaignClientIds, ...marketingClientIds]);
    const month = today.slice(0, 7);
    const summaries = new Map<string, WorkspaceClientOverview>();
    for (const client of clients) {
        const hoursLogged = hoursByClient[client.id] ?? 0;
        const hoursBudget = client.setupScope?.mode === 'custom' ? 0 : client.seoHours ?? 0;
        const hoursStatus = client.setupScope
            ? setupHoursStatus(client.setupScope, client.status, client.launchDate, hoursLogged, hoursBudget, month, today)
            : hoursUsageStatus(hoursLogged, hoursBudget);
        summaries.set(client.id, {
            health: 'Healthy',
            hoursLogged,
            hoursSeverity: hoursStatus.severity,
            hasCampaignPlan: plans.has(client.id),
            openTasks: 0,
            overdueTasks: 0,
            blockedTasks: 0,
            overdueDeliverables: 0,
            nextDueDate: null,
        });
    }

    for (const task of tasks) {
        const summary = task.clientId ? summaries.get(task.clientId) : undefined;
        if (!summary || task.status === 'done') continue;
        const dueDate = task.dueDate?.slice(0, 10);
        summary.openTasks += 1;
        if (isOverdueTask({ status: task.status, dueDate }, today)) summary.overdueTasks += 1;
        if (task.blockedReason?.trim()) summary.blockedTasks += 1;
        if (dueDate && (!summary.nextDueDate || dueDate < summary.nextDueDate)) {
            summary.nextDueDate = dueDate;
        }
    }

    for (const cell of cells) {
        const summary = summaries.get(cell.clientId);
        const status = fulfillmentStatus({ ...cell, daysLeftInMonth: daysLeft });
        if (summary && status.status === 'Overdue') summary.overdueDeliverables += cell.overdue;
    }

    for (const summary of summaries.values()) {
        summary.health = clientHealthLabel(computeHealthScore(summary));
    }
    return Object.fromEntries(summaries);
}
