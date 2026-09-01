import { createClient } from './client';
import { PlannerPriority } from '../types';
import {
    comparePlannerPriorityOrder,
    plannerTaskDropRpcSucceeded,
    priorityUpdatesSucceeded,
} from '../planner/priority-updates';

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
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true })
            .order('id', { ascending: true });
        if (error) throw error;
        return (data ?? [])
            .map(rowToPlannerPriority)
            .sort(comparePlannerPriorityOrder);
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

/**
 * Remove a task's calendar block and optionally pin it to Priorities in one
 * database transaction. The RPC is idempotent for repeated priority drops.
 */
export async function unschedulePlannerTask(params: {
    taskId: string;
    addToPriorities: boolean;
}): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const result = await supabase.rpc('unschedule_planner_task', {
            p_task_id: params.taskId,
            p_add_to_priorities: params.addToPriorities,
        });
        if (!plannerTaskDropRpcSucceeded(result)) {
            console.error('[planner-priorities] unschedule task error:', result.error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[planner-priorities] unschedule task error:', err);
        return false;
    }
}

/** Persist a new order after a drag. Writes each changed row's sort_order. */
export async function reorderPlannerPriorities(
    ordered: { id: string; sortOrder: number }[],
): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const responses = await Promise.all(
            ordered.map(({ id, sortOrder }) =>
                supabase.from('planner_priorities').update({ sort_order: sortOrder }).eq('id', id),
            ),
        );
        if (!priorityUpdatesSucceeded(responses)) {
            console.error(
                '[planner-priorities] reorder error:',
                responses.flatMap(response => response.error ? [response.error] : []),
            );
            return false;
        }
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
