import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeJsonObject } from '../basecamp/project-access';
import { readBasecampPlanLists } from '../basecamp/plan-lists';
import { planBasecampBanner, type PlanBasecampBanner } from './basecamp-push';
import { stageListTaskFromRow, type StageListTask } from './stage-list';

/** Columns the stage list reads. Recurrence is reduced to a boolean before it leaves the server. */
export const STAGE_LIST_TASK_COLUMNS =
    'id, title, status, stage, position, parent_task_id, created_at, category, basecamp_todo_id, recurrence, published_url, due_date, completed_at, assignee_ids, blocked_reason, basecamp_sync_state, basecamp_sync_error, basecamp_sync_attempted_at';

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

const BANNER_COLUMNS = 'custom_fields, basecamp_plan_sync_state, basecamp_plan_sync_error';

/**
 * Client-wide Basecamp health for the line above the list.
 * No project (or sync turned off) is `{ connected: false }`, which renders nothing.
 */
export async function loadPlanBasecampBanner(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<PlanBasecampBanner | null> {
    const client = await db
        .from('clients')
        .select(BANNER_COLUMNS)
        .eq('id', clientId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (client.error) throw new Error('Unable to load client');
    if (!client.data) return null;
    const fields = normalizeJsonObject(client.data.custom_fields);
    const lists = readBasecampPlanLists(fields);
    return planBasecampBanner({
        syncEnabled: fields.basecamp_sync_enabled === true,
        projectId: lists.projectId || null,
        syncState: typeof client.data.basecamp_plan_sync_state === 'string'
            ? client.data.basecamp_plan_sync_state
            : null,
        syncError: typeof client.data.basecamp_plan_sync_error === 'string'
            ? client.data.basecamp_plan_sync_error
            : null,
    });
}
