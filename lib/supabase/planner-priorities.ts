import { createClient } from './client';
import { PlannerPriority } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToPlannerPriority(row: any): PlannerPriority {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        taskId: row.task_id ?? undefined,
        label: row.label ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
    };
}

export async function listPlannerPriorities(params: {
    organizationId: string;
    userId: string;
}): Promise<PlannerPriority[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('planner_priorities')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(rowToPlannerPriority);
    } catch (err) {
        console.error('[planner-priorities] list error:', err);
        return [];
    }
}

export async function createPlannerPriority(params: {
    organizationId: string;
    userId: string;
    taskId?: string;
    label?: string;
    sortOrder: number;
}): Promise<PlannerPriority | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('planner_priorities')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                task_id: params.taskId ?? null,
                label: params.label ?? null,
                sort_order: params.sortOrder,
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerPriority(data);
    } catch (err) {
        console.error('[planner-priorities] create error:', err);
        return null;
    }
}

/** Persist a new order after a drag. Writes each changed row's sort_order. */
export async function reorderPlannerPriorities(
    ordered: { id: string; sortOrder: number }[],
): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        await Promise.all(
            ordered.map(({ id, sortOrder }) =>
                supabase.from('planner_priorities').update({ sort_order: sortOrder }).eq('id', id),
            ),
        );
        return true;
    } catch (err) {
        console.error('[planner-priorities] reorder error:', err);
        return false;
    }
}

export async function deletePlannerPriority(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('planner_priorities').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[planner-priorities] delete error:', err);
        return false;
    }
}
