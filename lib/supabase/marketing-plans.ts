import { createClient } from './client';
import {
    MarketingPlan, MarketingPlanItem, MarketingPlanItemComment,
    MarketingPlanItemPriority,
} from '../types';
import { MARKETING_PLAN_STEPS, MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template';
import { createTask } from './tasks';

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
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function rowToItem(r: any): MarketingPlanItem {
    return {
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
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export async function getMarketingPlan(clientId: string): Promise<MarketingPlan | null> {
    const supabase = createClient();
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('marketing_plans')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();
    if (error) { console.error('getMarketingPlan:', error); return null; }
    if (!data) return null;
    const plan = rowToPlan(data);

    const { data: itemRows, error: itemsError } = await supabase
        .from('marketing_plan_items')
        .select('*')
        .eq('marketing_plan_id', plan.id)
        .order('sort_order', { ascending: true });
    if (itemsError) { console.error('getMarketingPlan items:', itemsError); return plan; }
    return { ...plan, items: (itemRows ?? []).map(rowToItem) };
}

export async function createMarketingPlanFromTemplate(input: {
    organizationId: string;
    clientId: string;
    clientName: string;
}): Promise<{ success: boolean; data?: MarketingPlan; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };

    const { data, error } = await supabase
        .from('marketing_plans')
        .insert({
            organization_id: input.organizationId,
            client_id: input.clientId,
            title: `${input.clientName} — SEO Marketing Plan`,
            steps: MARKETING_PLAN_STEPS,
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
    const plan = rowToPlan(data);

    const rows = MARKETING_PLAN_TEMPLATE_ITEMS.map((t, i) => ({
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
    if (itemsError) return { success: false, error: itemsError.message };

    return { success: true, data: plan };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export async function updateMarketingPlanItem(
    itemId: string,
    patch: {
        status?: string; priority?: string; title?: string;
        description?: string; assigneeId?: string | null; dueDate?: string | null;
    },
): Promise<{ success: boolean; data?: MarketingPlanItem; error?: string }> {
    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
        })
        .select()
        .single();
    if (error) return { success: false, error: error.message };
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
    const res = await createTask({
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

    const supabase = createClient();
    if (!supabase) return { success: false, error: 'No client' };
    const { error } = await supabase
        .from('marketing_plan_items')
        .update({ task_id: res.data.id, updated_at: new Date().toISOString() })
        .eq('id', item.id);
    if (error) return { success: false, error: error.message };
    return { success: true, taskId: res.data.id };
}
