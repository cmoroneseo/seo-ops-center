import type { SupabaseClient } from '@supabase/supabase-js';

import { stageListTaskFromRow, type StageListTask } from './stage-list';

/** Columns the stage list reads. Recurrence is reduced to a boolean before it leaves the server. */
export const STAGE_LIST_TASK_COLUMNS =
    'id, title, status, stage, position, parent_task_id, created_at, category, basecamp_todo_id, recurrence, published_url, due_date';

export const STAGE_LIST_CLIENT_COLUMNS = 'id';

/**
 * Tasks for one client in the session organization.
 * Returns null when that organization has no such client. The caller picks
 * the organization; this query never accepts a second org id.
 */
export async function loadClientStageTasks(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<StageListTask[] | null> {
    const client = await db
        .from('clients')
        .select(STAGE_LIST_CLIENT_COLUMNS)
        .eq('id', clientId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (client.error) throw new Error('Unable to load client');
    if (!client.data) return null;

    const tasks = await db
        .from('tasks')
        .select(STAGE_LIST_TASK_COLUMNS)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    if (tasks.error) throw new Error('Unable to load tasks');

    const rows = Array.isArray(tasks.data) ? tasks.data : [];
    return rows.flatMap(row => {
        const task = stageListTaskFromRow(row);
        return task ? [task] : [];
    });
}
