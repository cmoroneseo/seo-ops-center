import { localDate } from '../client-setup';
import { loadHistory } from '../gsc/insights';
import { listBatchesForClient, listDocsForBatch } from '../supabase/content-approvals';
import { getDeliverables } from '../supabase/deliverables';
import { getMarketingPlan } from '../supabase/marketing-plans';
import { getTasksByClient } from '../supabase/tasks';
import { getTimeLogs } from '../supabase/time-logs';
import { sumBudgetHoursByClient } from '../time-budget-logic';
import type { ClientProject, Task } from '../types';
import {
    buildDailySeries,
    finalizedThrough,
    monthBounds,
    performanceWindow,
    previousEqualWindow,
    type CanvasApprovalDoc,
    type CanvasPlanItem,
    type CanvasTask,
    type WorkspaceCanvasInput,
} from './project';

export interface WorkspaceCanvasLoad {
    input: WorkspaceCanvasInput;
    tasks: Task[];
}

function toCanvasTask(task: Task): CanvasTask {
    return {
        id: task.id,
        title: task.title,
        description: task.description,
        status: task.status,
        dueDate: task.dueDate,
        startDate: task.startDate,
        completedAt: task.completedAt,
        estimatedHours: task.estimatedHours,
        assignees: task.assignees ?? [],
        subtasks: (task.subtasks ?? []).map(subtask => ({ id: subtask.id, title: subtask.title, completed: subtask.completed })),
    };
}

async function loadSearch(clientId: string, month: string, through: string, signal: AbortSignal): Promise<WorkspaceCanvasInput['search']> {
    const window = performanceWindow(month, through);
    if (!window) return { ok: true, coverage: 'none' };
    const current = await loadHistory(clientId, window, 'property', signal);
    if (current.truncated) throw new Error('Search history was incomplete. Reload before treating the total as final.');
    const currentPoints = buildDailySeries(window.start, window.end, current.days, current.rows);
    const previousWindow = previousEqualWindow(window.start, window.end);
    let previous = null;
    try {
        const loaded = await loadHistory(clientId, previousWindow, 'property', signal);
        if (!loaded.truncated && loaded.property === current.property) {
            previous = buildDailySeries(previousWindow.start, previousWindow.end, loaded.days, loaded.rows);
        }
    } catch (error) {
        if (signal.aborted) throw error;
        previous = null;
    }
    const lastSync = current.days.map(day => day.importedAt).sort().at(-1) ?? null;
    return {
        ok: true,
        coverage: 'ready',
        property: current.property,
        lastSync,
        window,
        current: currentPoints,
        previous,
    };
}

/** One read of each verified source. A failed source is flagged and does not zero the others. */
export async function loadWorkspaceCanvas(args: {
    client: ClientProject;
    organizationId: string;
    month: string;
    signal: AbortSignal;
    now?: Date;
    today?: string;
}): Promise<WorkspaceCanvasLoad | null> {
    const { client, organizationId, month, signal } = args;
    const now = args.now ?? new Date();
    const today = args.today ?? localDate(now);
    const through = finalizedThrough(now);
    const custom = client.setupScope?.mode === 'custom';
    const campaign = !custom && client.engagementModel === 'Campaign';

    const tasksPromise = getTasksByClient(client.id, true);
    const planPromise = getMarketingPlan(client.id);
    const monthHoursPromise = getTimeLogs(organizationId, { clientId: client.id, month, budgetMonth: true, throwOnError: true });
    const campaignHoursPromise = campaign
        ? getTimeLogs(organizationId, { clientId: client.id, throwOnError: true })
        : Promise.resolve(null);
    const deliverablesPromise = getDeliverables(organizationId, { clientId: client.id, throwOnError: true });
    const approvalsPromise = (async (): Promise<CanvasApprovalDoc[]> => {
        const batches = await listBatchesForClient(client.id, { throwOnError: true });
        const docs = await Promise.all(batches.map(async batch => ({ batch, docs: await listDocsForBatch(batch.id, { throwOnError: true }) })));
        return docs.flatMap(({ batch, docs }) => docs.map(doc => ({
            id: doc.id,
            batchId: batch.id,
            batchName: batch.name,
            batchStatus: batch.status,
            sentAt: batch.sentAt,
            title: doc.title,
            status: doc.status,
            archivedAt: doc.archivedAt,
            deliverableId: doc.deliverableId,
        })));
    })();
    const searchPromise = loadSearch(client.id, month, through, signal);

    const [tasksResult, planResult, monthResult, campaignResult, deliverableResult, approvalResult, searchResult] = await Promise.all([
        tasksPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        planPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        monthHoursPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        campaignHoursPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        deliverablesPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        approvalsPromise.then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const })),
        searchPromise.then(value => ({ ok: true as const, value })).catch(error => ({ ok: false as const, message: error instanceof Error ? error.message : 'Search Console data could not be loaded.' })),
    ]);
    if (signal.aborted) return null;

    const tasks = tasksResult.ok ? tasksResult.value : [];
    let campaignHours: WorkspaceCanvasInput['campaignHours'];
    if (!campaign) campaignHours = { skipped: true };
    else if (!campaignResult.ok) campaignHours = { ok: false };
    else {
        const config = client.campaignConfig;
        const logs = (campaignResult.value ?? []).filter(log => {
            if (!config?.startDate || !config.endDate) return false;
            return log.date >= config.startDate.slice(0, 10) && log.date <= config.endDate.slice(0, 10);
        });
        campaignHours = { ok: true, value: sumBudgetHoursByClient(logs)[client.id] ?? 0 };
    }

    const planItems: CanvasPlanItem[] = planResult.ok && planResult.value
        ? (planResult.value.items ?? []).map(item => ({
            id: item.id,
            title: item.title,
            description: item.description,
            status: item.status,
            dueDate: item.dueDate,
            roadmapIncluded: item.roadmapIncluded,
            roadmapPhase: item.roadmapPhase,
            taskId: item.taskId,
            linkedTask: item.linkedTask ? toCanvasTask(item.linkedTask) : undefined,
        }))
        : [];

    const input: WorkspaceCanvasInput = {
        month,
        today,
        finalizedThrough: through,
        client: {
            engagementModel: client.engagementModel,
            status: client.status,
            launchDate: client.launchDate,
            seoHours: client.seoHours,
            retainerMonthlyHours: client.retainerConfig?.monthlyHours ?? null,
            setupScope: client.setupScope ?? null,
            campaignConfig: client.campaignConfig
                ? { startDate: client.campaignConfig.startDate, endDate: client.campaignConfig.endDate, totalHours: client.campaignConfig.totalHours }
                : null,
        },
        tasks: tasksResult.ok ? { ok: true, value: tasks.map(toCanvasTask) } : { ok: false },
        plan: planResult.ok ? { ok: true, value: planResult.value ? { goal: planResult.value.goal, items: planItems } : null } : { ok: false },
        monthHours: monthResult.ok ? { ok: true, value: sumBudgetHoursByClient(monthResult.value)[client.id] ?? 0 } : { ok: false },
        campaignHours,
        deliverables: deliverableResult.ok
            ? { ok: true, value: deliverableResult.value.map(item => ({ id: item.id, title: item.title, status: item.status, dueDate: item.dueDate })) }
            : { ok: false },
        approvals: approvalResult.ok ? { ok: true, value: approvalResult.value } : { ok: false },
        search: searchResult.ok ? searchResult.value : { ok: false, message: searchResult.message },
    };

    return { input, tasks };
}

export { monthBounds };
