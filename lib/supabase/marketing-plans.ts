import { createClient } from './client';
import {
    MarketingPlan, MarketingPlanItem, MarketingPlanItemComment,
    MarketingPlanItemPriority,
} from '../types';
import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS, SEO_PLAN_LABEL } from '../marketing-plan-template';
import { catalogAddBlocked, onboardingSeedItems, type PlanItemSource } from '../seo-plan/onboarding';
import { createTask, rowToTask } from './tasks';
import { itemsEligibleForTaskGeneration } from '../marketing-plan-logic';
import { planPillarFromItems } from '../tasks/pillars';
import { resolvePlanItem } from '../marketing-plan-execution';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToPlan(r: any): MarketingPlan {
    return {
        id: r.id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        title: r.title,
        steps: r.steps ?? [],
        goal: r.goal ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToItem(r: any): MarketingPlanItem {
    return {
        roadmapIncluded: r.roadmap_included ?? r.status !== 'ignored',
        roadmapPhase: r.roadmap_phase ?? 'backlog',
        id: r.id,
        marketingPlanId: r.marketing_plan_id,
        organizationId: r.organization_id,
        clientId: r.client_id,
        stepKey: r.step_key,
        title: r.title,
        description: r.description ?? undefined,
        status: r.status,
        priority: r.priority,
        assigneeId: r.assignee_id ?? undefined,
        dueDate: r.due_date ?? undefined,
        sortOrder: r.sort_order ?? 0,
        comments: r.comments ?? [],
        taskId: r.task_id ?? undefined,
        isCustom: r.is_custom ?? false,
        templateKey: r.template_key ?? undefined,
        source: r.source ?? undefined,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function getMarketingPlan(clientId: string): Promise<MarketingPlan | null> {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase is unavailable');
    const { data, error } = await supabase
        .from('marketing_plans')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const plan = rowToPlan(data);

    const { data: itemRows, error: itemsError } = await supabase
        .from('marketing_plan_items')
        .select('*, linked_task:tasks(*)')
        .eq('marketing_plan_id', plan.id)
        .order('sort_order', { ascending: true });
    if (itemsError) throw new Error(itemsError.message);
    return { ...plan, items: (itemRows ?? []).map((row: any) => resolvePlanItem({ ...rowToItem(row), linkedTask: row.linked_task ? rowToTask(row.linked_task) : undefined })) };
}

export async function createMarketingPlanFromTemplate(input: {
    organizationId: string;
    clientId: string;
    clientName: string;
    /** Flagged orgs seed the onboarding checklist. The library stays in code. */
    seed?: 'library' | 'onboarding';
    scope?: { gbp?: boolean; listings?: boolean };
}): Promise<{ success: boolean; data?: MarketingPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };

    const { data, error } = await supabase
        .from('marketing_plans')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: `${input.clientName} — ${SEO_PLAN_LABEL}`,
            steps: MARKETING_PLAN_STEPS,
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    const plan = rowToPlan(data);

    const rows = input.seed === 'onboarding'
        ? onboardingSeedItems({ gbp: input.scope?.gbp === true, listings: input.scope?.listings === true }).map((item, i) => ({
            marketing_plan_id: plan.id,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: item.stepKey,
            title: item.title,
            description: item.description,
            priority: item.priority,
            sort_order: i,
            is_custom: false,
            roadmap_included: true,
            roadmap_phase: 'onboarding',
            template_key: item.templateKey,
            source: 'onboarding',
        }))
        : MARKETING_PLAN_TEMPLATE_ITEMS.map((t, i) => ({
            marketing_plan_id: plan.id,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: t.stepKey,
            title: t.title,
            description: t.description,
            priority: t.priority,
            sort_order: i,
        }));
    const { error: itemsError } = await supabase.from('marketing_plan_items').insert(rows);
    if (itemsError) {
        await supabase.from('marketing_plans').delete().eq('id', plan.id);
        return { success: false, error: itemsError.message };
    }

    return { success: true, data: plan };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function updateMarketingPlanItem(
    itemId: string,
    patch: {
        roadmapIncluded?: boolean; roadmapPhase?: MarketingPlanItem['roadmapPhase'];
        status?: string; priority?: string; title?: string;
        description?: string; assigneeId?: string | null; dueDate?: string | null;
    },
): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.roadmapIncluded !== undefined) dbPatch.roadmap_included = patch.roadmapIncluded;
    if (patch.roadmapPhase !== undefined) dbPatch.roadmap_phase = patch.roadmapPhase;
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.priority !== undefined) dbPatch.priority = patch.priority;
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.assigneeId !== undefined) dbPatch.assignee_id = patch.assigneeId;
    if (patch.dueDate !== undefined) dbPatch.due_date = patch.dueDate;
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .update(dbPatch)
        .eq('id', itemId)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

export async function addItemComment(
    itemId: string,
    existing: MarketingPlanItemComment[],
    comment: MarketingPlanItemComment,
): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .update({
            comments: [...existing, comment],
            updated_at: new Date().toISOString(),
        })
        .eq('id', itemId)
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

export async function addCustomItem(input: {
    marketingPlanId: string;
    organizationId: string;
    clientId: string;
    stepKey: string;
    title: string;
    description?: string;
    priority?: MarketingPlanItemPriority;
    sortOrder: number;
    /** Set only for flagged orgs, after migration 087. Unflagged inserts omit it. */
    source?: Extract<PlanItemSource, 'custom'>;
}): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .insert({
            marketing_plan_id: input.marketingPlanId,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: input.stepKey,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'medium',
            sort_order: input.sortOrder,
            is_custom: true,
            roadmap_included: true,
            ...(input.source ? { source: input.source } : {}),
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    return { success: true, data: rowToItem(data) };
}

/** One library row. Refuses a second copy of the same template key or title. */
export async function addCatalogItem(input: {
    marketingPlanId: string;
    organizationId: string;
    clientId: string;
    title: string;
    sortOrder: number;
    existing: Array<{ templateKey?: string | null; title: string }>;
}): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const catalog = MARKETING_PLAN_TEMPLATE_ITEMS.find(item => item.title === input.title);
    if (!catalog) return { success: false, error: 'That library item is not available.' };
    if (catalogAddBlocked(input.existing, { templateKey: catalog.templateKey, title: catalog.title })) {
        return { success: false, error: 'Already on this plan.' };
    }
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { data, error } = await supabase
        .from('marketing_plan_items')
        .insert({
            marketing_plan_id: input.marketingPlanId,
            organization_id: input.organizationId,
            client_id: input.clientId,
            step_key: catalog.stepKey,
            title: catalog.title,
            description: catalog.description,
            priority: catalog.priority,
            sort_order: input.sortOrder,
            is_custom: false,
            roadmap_included: true,
            roadmap_phase: 'backlog',
            template_key: catalog.templateKey ?? null,
            source: 'template',
        })
        .select()
        .single();
    if (error) {
        if (error.code === '23505') return { success: false, error: 'Already on this plan.' };
        return { success: false, error: error.message };
    }
    return { success: true, data: rowToItem(data) };
}

export async function deleteCustomItem(itemId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase
        .from('marketing_plan_items')
        .delete()
        .eq('id', itemId)
        .eq('is_custom', true);
    if (error) return { success: false, error: error.message };
    return { success: true };
}

// ---------------------------------------------------------------------------
// Promote to Task
// ---------------------------------------------------------------------------

export async function promoteItemToTask(
    item: MarketingPlanItem,
    actorName?: string,
): Promise<{ success: boolean; taskId?: string; error?: string }> {
    if (item.taskId) return { success: true, taskId: item.taskId };
    const res = await createTask({
        sourceMarketingPlanItemId: item.id,
        organizationId: item.organizationId,
        clientId: item.clientId,
        title: item.title,
        description: item.description,
        priority: item.priority,
        assigneeIds: item.assigneeId ? [item.assigneeId] : undefined,
        dueDate: item.dueDate,
        actorName,
    });
    if (!res.success || !res.data) return { success: false, error: res.error ?? 'Task creation failed' };

    return { success: true, taskId: res.data.id };
}

export async function updateMarketingPlanGoal(planId: string, goal: string): Promise<void> {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase is unavailable');
    const { error } = await supabase.from('marketing_plans')
        .update({ goal: goal.trim() || null, updated_at: new Date().toISOString() }).eq('id', planId);
    if (error) throw new Error(error.message);
}

export interface PromoteItemsResult {
    created: { itemId: string; taskId: string }[];
    failed: { itemId: string; title: string; error: string }[];
}

/** Create tasks for every eligible item, in list order. Already-linked, done, and ignored items are skipped. */
export async function promoteItemsToTasks(
    items: MarketingPlanItem[],
    actorName?: string,
): Promise<PromoteItemsResult> {
    const created: PromoteItemsResult['created'] = [];
    const failed: PromoteItemsResult['failed'] = [];
    for (const item of itemsEligibleForTaskGeneration(items)) {
        const res = await promoteItemToTask(item, actorName);
        if (res.success && res.taskId) {
            created.push({ itemId: item.id, taskId: res.taskId });
        } else {
            failed.push({ itemId: item.id, title: item.title, error: res.error ?? 'Task creation failed' });
        }
    }
    return { created, failed };
}

export async function addExistingTaskToPlan(planId: string, taskId: string, stepKey: string): Promise<string> {
    const supabase = createClient();
    if (!supabase) throw new Error('Supabase is unavailable');
    const { data, error } = await supabase.rpc('add_existing_task_to_marketing_plan', { p_plan_id: planId, p_task_id: taskId, p_step_key: stepKey });
    if (error) throw new Error(error.message);
    return String(data);
}

export interface PromotePillarResult {
    success: boolean;
    pillarTaskId?: string;
    planItemId?: string;
    retiredItemIds: string[];
    error?: string;
    warning?: string;
}

/**
 * One checklist row links to the pillar. Source rows are removed after the
 * link exists so the chores are not also top-level plan items. Subtasks are
 * not given plan rows.
 */
export async function promoteItemsAsPillar(
    planId: string,
    items: MarketingPlanItem[],
    options: { title: string; actorName?: string },
): Promise<PromotePillarResult> {
    const plan = planPillarFromItems(items, options.title);
    if (!plan) {
        return { success: false, retiredItemIds: [], error: 'Choose at least two open checklist items to group.' };
    }
    const sample = items.find(item => plan.retireItemIds.includes(item.id)) ?? items[0];
    if (!sample) return { success: false, retiredItemIds: [], error: 'Choose at least two open checklist items to group.' };

    const created = await createTask({
        organizationId: sample.organizationId,
        clientId: sample.clientId,
        title: plan.title,
        description: plan.description,
        priority: plan.priority,
        assigneeIds: plan.assigneeIds,
        estimatedHours: plan.estimatedHours,
        subtasks: plan.subtasks,
        actorName: options.actorName,
    });
    if (!created.success || !created.data) {
        return { success: false, retiredItemIds: [], error: created.error ?? 'Could not create the pillar task.' };
    }

    let planItemId: string;
    try {
        planItemId = await addExistingTaskToPlan(planId, created.data.id, plan.stepKey);
    } catch (error) {
        return {
            success: false,
            pillarTaskId: created.data.id,
            retiredItemIds: [],
            error: error instanceof Error
                ? `The pillar task was created, but it could not be added to the plan. ${error.message}`
                : 'The pillar task was created, but it could not be added to the plan.',
        };
    }

    const phase = await updateMarketingPlanItem(planItemId, { roadmapPhase: plan.roadmapPhase });
    const phaseWarning = phase.success ? undefined : 'The pillar is on the plan, but its phase could not be set.';

    const supabase = createClient();
    if (!supabase) {
        return {
            success: true,
            pillarTaskId: created.data.id,
            planItemId,
            retiredItemIds: [],
            warning: 'The pillar is on the plan. The original checklist rows could not be removed.',
        };
    }
    const { error: deleteError } = await supabase
        .from('marketing_plan_items')
        .delete()
        .in('id', plan.retireItemIds)
        .eq('organization_id', sample.organizationId)
        .neq('id', planItemId);
    if (deleteError) {
        const retired: string[] = [];
        const failed: string[] = [];
        for (const itemId of plan.retireItemIds) {
            const hidden = await updateMarketingPlanItem(itemId, { status: 'ignored', roadmapIncluded: false });
            if (hidden.success) retired.push(itemId);
            else failed.push(items.find(item => item.id === itemId)?.title ?? itemId);
        }
        return {
            success: true,
            pillarTaskId: created.data.id,
            planItemId,
            retiredItemIds: retired,
            warning: [
                phaseWarning,
                failed.length
                    ? `Some checklist rows stayed on the plan: ${failed.join(', ')}.`
                    : 'The original checklist rows were excluded because they could not be removed.',
            ].filter(Boolean).join(' '),
        };
    }

    return {
        success: true,
        pillarTaskId: created.data.id,
        planItemId,
        retiredItemIds: plan.retireItemIds,
        ...(phaseWarning ? { warning: phaseWarning } : {}),
    };
}
