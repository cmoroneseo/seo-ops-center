import { readBasecampPlanLists } from '../basecamp/plan-lists';
import {
    addExistingTaskToPlan,
    getMarketingPlan,
    linkTaskOntoPlanItem,
    updateMarketingPlanItem,
} from '../supabase/marketing-plans';
import { getTasksByClient } from '../supabase/tasks';
import {
    ONBOARDING_LIST_MISSING,
    ONBOARDING_LIST_UNREADABLE,
    SEO_PLAN_MISSING,
    applyOnboardingPlacements,
    planOnboardingAdditions,
    summarizeOnboardingAdd,
    type OnboardingApplyCounts,
} from './onboarding-import';

export type OnboardingAddOutcome =
    | ({ ok: true; summary: string } & OnboardingApplyCounts)
    | { ok: false; message: string };

function sourceTodolistId(fields: Record<string, unknown> | undefined): string | null {
    const value = fields?.basecamp_source_todolist_id;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

/**
 * Add imported onboarding to-dos onto the SEO Plan.
 * Matching checklist rows get the task. Everything else is a new row in
 * Introduction & Setup (or the matched category) with source basecamp.
 */
export async function addImportedOnboardingToPlan(input: {
    clientId: string;
    organizationId: string;
    onlyBasecampTodoIds?: number[];
}): Promise<OnboardingAddOutcome> {
    const configResponse = await fetch(`/api/clients/${input.clientId}/basecamp-config`);
    if (!configResponse.ok) {
        return { ok: false, message: 'Basecamp settings could not be loaded.' };
    }
    const config = await configResponse.json() as Record<string, unknown>;
    const lists = readBasecampPlanLists(config);
    if (!lists.projectId || !lists.onboardingTodolistId) {
        return { ok: false, message: ONBOARDING_LIST_MISSING };
    }

    let liveIds: number[] = [];
    let liveOk = false;
    try {
        const params = new URLSearchParams({
            organizationId: input.organizationId,
            projectId: lists.projectId,
            todolistId: lists.onboardingTodolistId,
        });
        const todosResponse = await fetch(`/api/integrations/basecamp/todos?${params}`);
        if (todosResponse.ok) {
            const body = await todosResponse.json() as { todos?: Array<{ id?: number | string }> };
            liveIds = (body.todos ?? [])
                .map(todo => Number(todo.id))
                .filter(id => Number.isSafeInteger(id) && id > 0);
            liveOk = true;
        }
    } catch {
        liveOk = false;
    }

    const tasks = await getTasksByClient(input.clientId, true);
    const hasStamp = tasks.some(task => sourceTodolistId(task.customFields) === lists.onboardingTodolistId);
    if (!liveOk && !hasStamp) {
        return { ok: false, message: ONBOARDING_LIST_UNREADABLE };
    }

    const plan = await getMarketingPlan(input.clientId);
    if (!plan) return { ok: false, message: SEO_PLAN_MISSING };

    const placements = planOnboardingAdditions({
        tasks: tasks.map(task => ({
            id: task.id,
            title: task.title,
            basecampTodoId: task.basecampTodoId ?? null,
            sourceTodolistId: sourceTodolistId(task.customFields),
        })),
        items: (plan.items ?? []).map(item => ({
            id: item.id,
            title: item.title,
            stepKey: item.stepKey,
            templateKey: item.templateKey ?? null,
            taskId: item.taskId ?? null,
        })),
        onboardingTodolistId: lists.onboardingTodolistId,
        onboardingTodoIds: liveIds,
        stepKeys: plan.steps.map(step => step.key),
        ...(input.onlyBasecampTodoIds ? { onlyBasecampTodoIds: new Set(input.onlyBasecampTodoIds) } : {}),
    });

    const counts = await applyOnboardingPlacements(placements, {
        link: (itemId, taskId) => linkTaskOntoPlanItem(itemId, taskId),
        create: (taskId, stepKey) => addExistingTaskToPlan(plan.id, taskId, stepKey),
        setPhase: async itemId => {
            const phase = await updateMarketingPlanItem(itemId, { roadmapPhase: 'onboarding', roadmapIncluded: true });
            if (!phase.success) throw new Error(phase.error ?? 'Could not place the row in Onboarding');
        },
    });

    return { ok: true, summary: summarizeOnboardingAdd(placements.length, counts), ...counts };
}
