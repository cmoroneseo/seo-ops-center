import type { SupabaseClient } from '@supabase/supabase-js';

import type { TaskStage } from '../types';
import { STAGE_LIST_TASK_COLUMNS } from './stage-list-load';
import { stageListTaskFromRow, type StageListTask } from './stage-list';

export interface StageAddParent {
    title: string;
    stage: string;
    parentTaskId: string | null;
}

const PARENT_COLUMNS = 'title, stage, parent_task_id';

/**
 * True when the client belongs to the session organization.
 * A missing row is not an error: the caller answers 404.
 */
export async function clientBelongsToOrganization(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<boolean> {
    const client = await db
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (client.error) throw new Error('Unable to load client');
    return client.data != null;
}

/** The pillar a subtask would be added under, scoped to the session client. */
export async function loadStageAddParent(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
    parentTaskId: string,
): Promise<StageAddParent | null> {
    const parent = await db
        .from('tasks')
        .select(PARENT_COLUMNS)
        .eq('id', parentTaskId)
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (parent.error) throw new Error('Unable to load task');
    if (!parent.data || typeof parent.data.title !== 'string') return null;
    return {
        title: parent.data.title,
        stage: typeof parent.data.stage === 'string' ? parent.data.stage : '',
        parentTaskId: typeof parent.data.parent_task_id === 'string' && parent.data.parent_task_id
            ? parent.data.parent_task_id
            : null,
    };
}

/**
 * Highest position in the group the new rows join.
 * Top-level rows share a stage. Subtasks share a parent, across stages.
 */
export async function maxStageAddPosition(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
    stage: TaskStage,
    parentTaskId: string | null,
): Promise<number | null> {
    let query = db
        .from('tasks')
        .select('position')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('position', { ascending: false })
        .limit(1);
    query = parentTaskId
        ? query.eq('parent_task_id', parentTaskId)
        : query.is('parent_task_id', null).eq('stage', stage);
    const result = await query.maybeSingle();
    if (result.error) throw new Error('Unable to place tasks');
    const position = result.data?.position;
    return typeof position === 'number' && Number.isFinite(position) ? position : null;
}

/** Remove rows created earlier in the same add, after a later insert failed. */
export async function deleteStageTasks(db: SupabaseClient, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const removed = await db.from('tasks').delete().in('id', [...ids]);
    if (removed.error) throw new Error('Unable to undo tasks');
}

/** Insert the rows and return them in the stage-list shape. One statement, so a failure writes nothing. */
export async function insertStageTasks(
    db: SupabaseClient,
    rows: readonly Record<string, unknown>[],
): Promise<StageListTask[]> {
    const inserted = await db.from('tasks').insert([...rows]).select(STAGE_LIST_TASK_COLUMNS);
    if (inserted.error) throw new Error('Unable to create tasks');
    const list = Array.isArray(inserted.data) ? inserted.data : [];
    return list.flatMap(row => {
        const task = stageListTaskFromRow(row);
        return task ? [task] : [];
    });
}
