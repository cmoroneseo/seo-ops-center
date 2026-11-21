import { localDateKey } from '../tasks/my-tasks';
import type { TaskStatus } from '../types';
import type { WorkspaceOverviewData } from '../workspace/client-overview-summary';
import { createClient } from './client';
import { daysLeftInMonth, getFulfillmentMatrix } from './fulfillment';
import { getLoggedHoursByClient } from './time-logs';

async function readPages<Row>(
    readPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
    const rows: Row[] = [];
    const pageSize = 500;
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await readPage(from, from + pageSize - 1);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < pageSize) return rows;
    }
}

interface TaskSummaryRow {
    client_id: string | null;
    status: TaskStatus;
    due_date: string | null;
    blocked_reason: string | null;
}

export async function loadWorkspaceClientOverview(orgId: string, now = new Date()): Promise<WorkspaceOverviewData | null> {
    const supabase = createClient();
    if (!supabase) return null;

    const today = localDateKey(now);
    const month = today.slice(0, 7);
    const planClients = (table: 'campaign_plans' | 'marketing_plans') =>
        readPages<{ client_id: string }>((from, to) => supabase.from(table)
            .select('client_id').eq('organization_id', orgId).order('id').range(from, to));

    const [tasks, fulfillment, hoursByClient, campaignPlans, marketingPlans] = await Promise.all([
        readPages<TaskSummaryRow>((from, to) => supabase.from('tasks')
            .select('client_id, status, due_date, blocked_reason')
            .eq('organization_id', orgId).is('parent_task_id', null)
            .not('client_id', 'is', null).neq('status', 'done').order('id').range(from, to)),
        getFulfillmentMatrix(orgId, month),
        getLoggedHoursByClient(orgId, month),
        planClients('campaign_plans'),
        planClients('marketing_plans'),
    ]);

    return {
        today,
        daysLeft: daysLeftInMonth(month, new Date(`${today}T00:00:00`)),
        tasks: tasks.map(row => ({
            clientId: row.client_id ?? undefined,
            status: row.status,
            dueDate: row.due_date?.slice(0, 10),
            blockedReason: row.blocked_reason ?? undefined,
        })),
        cells: fulfillment.cells,
        hoursByClient,
        campaignClientIds: campaignPlans.map(row => row.client_id),
        marketingClientIds: marketingPlans.map(row => row.client_id),
    };
}
