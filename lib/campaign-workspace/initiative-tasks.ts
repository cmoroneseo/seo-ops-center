/**
 * Work-plan tasks that can be part of a roadmap row.
 * A missing column or a failed read returns no tasks, so a roadmap with no links stays as it was.
 */

import { createClient } from '../supabase/client';
import type { PartOfTask } from '../tasks/part-of';

export async function loadClientInitiativeTasks(clientId: string): Promise<PartOfTask[]> {
    const supabase = createClient();
    if (!supabase || !clientId) return [];
    try {
        const result = await supabase
            .from('tasks')
            .select('id, title, status, parent_task_id, initiative_id')
            .eq('client_id', clientId)
            .order('position', { ascending: true })
            .order('created_at', { ascending: true });
        if (result.error || !Array.isArray(result.data)) return [];
        const tasks: PartOfTask[] = [];
        for (const row of result.data) {
            if (!row || typeof row !== 'object') continue;
            const record = row as Record<string, unknown>;
            if (typeof record.id !== 'string' || typeof record.title !== 'string' || !('initiative_id' in record)) continue;
            const initiativeId = record.initiative_id;
            tasks.push({
                id: record.id,
                title: record.title,
                status: typeof record.status === 'string' && record.status ? record.status : 'todo',
                parentTaskId: typeof record.parent_task_id === 'string' && record.parent_task_id ? record.parent_task_id : null,
                initiativeId: typeof initiativeId === 'string' && initiativeId ? initiativeId : null,
            });
        }
        return tasks;
    } catch {
        return [];
    }
}
