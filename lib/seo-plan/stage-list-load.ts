import type { SupabaseClient } from '@supabase/supabase-js';

import { normalizeJsonObject } from '../basecamp/project-access';
import { readBasecampPlanLists } from '../basecamp/plan-lists';
import { planBasecampBanner, type PlanBasecampBanner } from './basecamp-push';
import { planBoardFromSteps, type PlanBoard } from './plan-phases';
import { stageListTaskFromRow, type StageListTask } from './stage-list';

/**
 * Columns the stage list reads. Recurrence is reduced to a boolean before it leaves the server.
 * Priority is one more column on the same client-scoped read. The org and client filters stay.
 */
export const STAGE_LIST_TASK_COLUMNS =
    'id, title, status, priority, stage, position, parent_task_id, created_at, category, basecamp_todo_id, recurrence, published_url, due_date, completed_at, assignee_ids, blocked_reason, description, estimated_hours, basecamp_sync_state, basecamp_sync_error, basecamp_sync_attempted_at';

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
    const loaded = rows.flatMap(row => {
        const task = stageListTaskFromRow(row);
        return task ? [task] : [];
    });
    return attachInitiativeLinks(db, organizationId, clientId, loaded);
}

/**
 * A missing initiative_id column leaves the plan list alone.
 * The column is read on its own so the main task select still works before migration 126.
 */
async function attachInitiativeLinks(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
    tasks: StageListTask[],
): Promise<StageListTask[]> {
    try {
        const links = await db
            .from('tasks')
            .select('id, initiative_id')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId);
        if (links.error || !Array.isArray(links.data) || links.data.length === 0) return tasks;
        const byId = new Map<string, string | null>();
        for (const row of links.data) {
            if (!row || typeof row !== 'object') return tasks;
            const record = row as Record<string, unknown>;
            if (typeof record.id !== 'string' || !('initiative_id' in record)) return tasks;
            const value = record.initiative_id;
            byId.set(record.id, typeof value === 'string' && value ? value : null);
        }
        return tasks.map(task => ({ ...task, initiativeId: byId.get(task.id) ?? null }));
    } catch {
        return tasks;
    }
}

/**
 * Phase board when this client's plan was created with the phase marker.
 * No plan, or an older plan, stays on the month board. Does not rewrite tasks.
 */
export async function loadClientPlanBoard(
    db: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<PlanBoard> {
    const plan = await db
        .from('marketing_plans')
        .select('steps')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (plan.error) throw new Error('Unable to load plan');
    return planBoardFromSteps(plan.data?.steps);
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
