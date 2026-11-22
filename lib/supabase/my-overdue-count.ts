import { createClient } from './client';

export async function getMyOverdueTaskCount(organizationId: string, userId: string, today: string): Promise<number> {
    const supabase = createClient();
    if (!supabase) return 0;

    const { count, error } = await supabase.from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .is('parent_task_id', null)
        .contains('assignee_ids', [userId])
        // The task mapper treats a missing status as 'todo'.
        .or('status.neq.done,status.is.null')
        // Match the UTC date prefix of the timestamp returned by PostgREST.
        .lt('due_date', `${today}T00:00:00Z`);
    if (error) throw error;
    return count ?? 0;
}
