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
    // Migration 123 still writes stage. Preserve the stored value until 138
    // is applied, then remove this lookup and omit stage from the RPC patch.
    const stored = await db.from('tasks').select('id, stage')
        .eq('organization_id', organizationId).eq('client_id', clientId)
        .in('id', writes.map(write => write.id));
    if (stored.error || stored.data?.length !== writes.length) throw new Error('Unable to move tasks');
    const stages = new Map(stored.data.map(row => [row.id, row.stage]));

    const result = await db.rpc('reorder_stage_tasks', {
        p_organization_id: organizationId,
        p_client_id: clientId,
        p_patches: writes.map(write => ({
            id: write.id,
            stage: stages.get(write.id),
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
