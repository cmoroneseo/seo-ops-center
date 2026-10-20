import type { SupabaseClient } from '@supabase/supabase-js';

import { stageListTaskFromRow, type StageListTask } from './stage-list';
import type { StageReorderWrite } from './stage-reorder';

/**
 * One RPC rewrites every patched row. A database error rejects the call,
 * so a nesting failure or a missing sibling leaves the previous order in place.
 */
export async function rewriteStageTasks(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
    writes: readonly StageReorderWrite[],
): Promise<StageListTask[]> {
    const result = await db.rpc('reorder_stage_tasks', {
        p_organization_id: organizationId,
        p_client_id: clientId,
        p_patches: writes.map(write => ({
            id: write.id,
            stage: write.stage,
            position: write.position,
            parent_task_id: write.parentTaskId,
        })),
    });
    if (result.error) throw new Error('Unable to move tasks');
    const rows = Array.isArray(result.data) ? result.data : [];
    const tasks = rows.flatMap(row => {
        const task = stageListTaskFromRow(row);
        return task ? [task] : [];
    });
    if (tasks.length !== writes.length) throw new Error('Unable to move tasks');
    return tasks;
}

/**
 * Write one task's due date. Null clears it.
 * The stage reorder does not push to Basecamp, and neither does this.
 * Due-date edits made in the task modal still use their existing push.
 */
export async function setStageTaskDueDate(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
    taskId: string,
    dueDate: string | null,
): Promise<void> {
    const result = await db
        .from('tasks')
        .update({ due_date: dueDate })
        .eq('id', taskId)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId);
    if (result.error) throw new Error('Unable to set due date');
}
