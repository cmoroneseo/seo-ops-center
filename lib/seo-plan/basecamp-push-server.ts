/**
 * Load a plan task and push it with the service-role client.
 * Browser sessions cannot write the sync columns (migration 111).
 * Tests never import this file; they call syncPlanTask with a fake provider.
 */

import { createPlanBasecampProvider } from '../basecamp/plan-push-provider';
import { readBasecampPlanLists, seoPlanPushTodolistId } from '../basecamp/plan-lists';
import { normalizeJsonObject } from '../basecamp/project-access';
import { createAdminClient } from '../supabase/admin';
import {
    nightlyBasecampRetryIds,
    planBasecampBanner,
    planBasecampReadout,
    type NightlyRetryRow,
    type PlanBasecampReadout,
    type PlanBasecampSyncState,
} from './basecamp-push';
import {
    syncPlanTask,
    type PlanPushClient,
    type PlanPushOutcome,
    type PlanPushSnapshot,
    type PlanPushTask,
} from './basecamp-push-run';

const TASK_COLUMNS =
    'id, organization_id, client_id, title, description, due_date, status, stage, parent_task_id, assignee_ids, watcher_ids, basecamp_todo_id, basecamp_sync_state, basecamp_sync_error, basecamp_sync_attempted_at';

type TaskRow = {
    id: string;
    organization_id: string;
    client_id: string | null;
    title: string;
    description: string | null;
    due_date: string | null;
    status: string;
    stage: string | null;
    parent_task_id: string | null;
    assignee_ids: unknown;
    watcher_ids: unknown;
    basecamp_todo_id: number | string | null;
    basecamp_sync_state: string | null;
    basecamp_sync_error: string | null;
    basecamp_sync_attempted_at: string | null;
};

type ClientRow = {
    id: string;
    custom_fields: unknown;
    basecamp_plan_sync_state: string | null;
    basecamp_plan_sync_error: string | null;
};

function dueDay(value: string | null): string | null {
    if (!value) return null;
    const day = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function todoId(value: number | string | null): string | null {
    if (value == null || value === '') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

function syncOf(row: TaskRow): PlanBasecampSyncState | null {
    if (row.basecamp_sync_state !== 'ok' && row.basecamp_sync_state !== 'failed') return null;
    return {
        state: row.basecamp_sync_state,
        error: row.basecamp_sync_error,
        attemptedAt: row.basecamp_sync_attempted_at,
    };
}

function clientOf(row: ClientRow): PlanPushClient {
    const fields = normalizeJsonObject(row.custom_fields);
    const lists = readBasecampPlanLists(fields);
    return {
        id: row.id,
        syncEnabled: fields.basecamp_sync_enabled === true,
        projectId: lists.projectId || null,
        todolistId: seoPlanPushTodolistId(fields) || null,
        projectName: typeof fields.basecamp_project_name === 'string' ? fields.basecamp_project_name : null,
        todolistName: typeof fields.basecamp_todolist_name === 'string' ? fields.basecamp_todolist_name : null,
        syncState: row.basecamp_plan_sync_state,
        syncError: row.basecamp_plan_sync_error,
    };
}

function userIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

async function basecampPeople(
    organizationId: string,
    assigneeIds: unknown,
    watcherIds: unknown,
): Promise<{ assigneePersonIds: number[]; completionSubscriberPersonIds: number[] }> {
    const assignees = userIds(assigneeIds);
    const subscribers = userIds(watcherIds);
    const ids = [...new Set([...assignees, ...subscribers])];
    if (ids.length === 0) return { assigneePersonIds: [], completionSubscriberPersonIds: [] };
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('organization_members')
        .select('user_id, basecamp_person_id')
        .eq('organization_id', organizationId)
        .in('user_id', ids);
    if (error) throw error;
    const byUser = new Map((data ?? []).map(member => [member.user_id, Number(member.basecamp_person_id)]));
    const personId = (id: string) => {
        const person = byUser.get(id);
        return typeof person === 'number' && Number.isSafeInteger(person) && person > 0 ? person : null;
    };
    return {
        assigneePersonIds: assignees.flatMap(id => {
            const person = personId(id);
            return person == null ? [] : [person];
        }),
        completionSubscriberPersonIds: subscribers.flatMap(id => {
            const person = personId(id);
            return person == null ? [] : [person];
        }),
    };
}

async function loadTaskRow(taskId: string): Promise<{ task: TaskRow; client: ClientRow } | null> {
    const admin = createAdminClient();
    // The select string is assembled. Supabase's select parser only accepts a
    // string literal, so the row is read through this shape.
    const { data, error } = await admin
        .from('tasks')
        .select(`${TASK_COLUMNS}, clients!inner(id, custom_fields, basecamp_plan_sync_state, basecamp_plan_sync_error)`)
        .eq('id', taskId)
        .maybeSingle();
    if (error) throw error;
    const row = data as (TaskRow & { clients: ClientRow | ClientRow[] | null }) | null;
    if (!row?.client_id) return null;
    const clientRelation = Array.isArray(row.clients) ? row.clients[0] : row.clients;
    if (!clientRelation) return null;
    const task: TaskRow = {
        id: row.id,
        organization_id: row.organization_id,
        client_id: row.client_id,
        title: row.title,
        description: row.description,
        due_date: row.due_date,
        status: row.status,
        stage: row.stage,
        parent_task_id: row.parent_task_id,
        assignee_ids: row.assignee_ids,
        watcher_ids: row.watcher_ids,
        basecamp_todo_id: row.basecamp_todo_id,
        basecamp_sync_state: row.basecamp_sync_state,
        basecamp_sync_error: row.basecamp_sync_error,
        basecamp_sync_attempted_at: row.basecamp_sync_attempted_at,
    };
    return { task, client: clientRelation };
}

async function loadChildren(taskId: string): Promise<PlanPushTask['children']> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('tasks')
        .select('id, title, basecamp_todo_id')
        .eq('parent_task_id', taskId)
        .order('position', { ascending: true })
        .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(child => ({
        id: child.id,
        title: child.title,
        basecampTodoId: todoId(child.basecamp_todo_id),
    }));
}

async function loadSnapshot(taskId: string): Promise<PlanPushSnapshot | null> {
    const loaded = await loadTaskRow(taskId);
    if (!loaded) return null;
    const task: PlanPushTask = {
        id: loaded.task.id,
        organizationId: loaded.task.organization_id,
        clientId: loaded.task.client_id ?? loaded.client.id,
        title: loaded.task.title,
        description: loaded.task.description,
        dueDate: dueDay(loaded.task.due_date),
        status: loaded.task.status,
        stage: loaded.task.stage,
        parentTaskId: loaded.task.parent_task_id,
        basecampTodoId: todoId(loaded.task.basecamp_todo_id),
        ...await basecampPeople(loaded.task.organization_id, loaded.task.assignee_ids, loaded.task.watcher_ids),
        children: await loadChildren(loaded.task.id),
    };
    let parent: PlanPushSnapshot['parent'] = null;
    if (loaded.task.parent_task_id) {
        const admin = createAdminClient();
        const { data, error } = await admin
            .from('tasks')
            .select('id, stage, due_date')
            .eq('id', loaded.task.parent_task_id)
            .maybeSingle();
        if (error) throw error;
        if (data) parent = { id: data.id, stage: data.stage, dueDate: dueDay(data.due_date) };
    }
    return { task, client: clientOf(loaded.client), parent };
}

function dependencies() {
    const hint: { listName: string | null; projectName: string | null } = {
        listName: null,
        projectName: null,
    };
    return {
        store: {
            async load(taskId: string) {
                const snapshot = await loadSnapshot(taskId);
                if (snapshot) {
                    hint.listName = snapshot.client.todolistName;
                    hint.projectName = snapshot.client.projectName;
                }
                return snapshot;
            },
            async linkTodo(taskId: string, projectId: string, linkedTodoId: string, at: string) {
                const { error } = await createAdminClient()
                    .from('tasks')
                    .update({
                        basecamp_todo_id: Number(linkedTodoId),
                        basecamp_project_id: Number(projectId),
                        last_synced_at: at,
                    })
                    .eq('id', taskId);
                if (error) throw error;
            },
            async recordTask(taskId: string, sync: PlanBasecampSyncState) {
                const { error } = await createAdminClient()
                    .from('tasks')
                    .update({
                        basecamp_sync_state: sync.state,
                        basecamp_sync_error: sync.error,
                        basecamp_sync_attempted_at: sync.attemptedAt,
                        ...(sync.state === 'ok' ? { last_synced_at: sync.attemptedAt } : {}),
                    })
                    .eq('id', taskId);
                if (error) throw error;
            },
            async recordClient(clientId: string, sync: { state: 'ok' | 'failed'; error: string | null }) {
                const { error } = await createAdminClient()
                    .from('clients')
                    .update({
                        basecamp_plan_sync_state: sync.state,
                        basecamp_plan_sync_error: sync.error,
                    })
                    .eq('id', clientId);
                if (error) throw error;
            },
        },
        provider: createPlanBasecampProvider(hint),
        now: () => new Date().toISOString(),
    };
}

/** One attempt. A missing project returns skipped and writes nothing. */
export async function syncStoredPlanTask(taskId: string): Promise<PlanPushOutcome> {
    return syncPlanTask(taskId, dependencies());
}

export async function readStoredPlanTask(taskId: string): Promise<PlanBasecampReadout | null> {
    const loaded = await loadTaskRow(taskId);
    if (!loaded) return null;
    const client = clientOf(loaded.client);
    return planBasecampReadout({
        taskId: loaded.task.id,
        stage: loaded.task.stage,
        dueDate: dueDay(loaded.task.due_date),
        sync: syncOf(loaded.task),
        basecampTodoId: todoId(loaded.task.basecamp_todo_id),
        banner: planBasecampBanner({
            syncEnabled: client.syncEnabled,
            projectId: client.projectId,
            syncState: client.syncState,
            syncError: client.syncError,
        }),
    });
}

const NIGHTLY_LIMIT = 50;

/**
 * Failed tasks that still qualify. Oldest attempt first, capped so the
 * daily cron that hosts this pass keeps time for its own work.
 */
export async function retryFailedPlanBasecampPushes(): Promise<{
    selected: number;
    ok: number;
    failed: number;
    skipped: number;
}> {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('tasks')
        .select('id, stage, due_date, basecamp_sync_state, client_id, clients!inner(custom_fields)')
        .eq('basecamp_sync_state', 'failed')
        .order('basecamp_sync_attempted_at', { ascending: true })
        .limit(NIGHTLY_LIMIT);
    if (error) throw error;

    const rows: NightlyRetryRow[] = (data ?? []).map(row => {
        const clientRelation = Array.isArray(row.clients) ? row.clients[0] : row.clients;
        const fields = normalizeJsonObject(clientRelation?.custom_fields);
        const lists = readBasecampPlanLists(fields);
        return {
            id: row.id,
            state: row.basecamp_sync_state,
            stage: row.stage,
            dueDate: dueDay(row.due_date),
            hasProject: fields.basecamp_sync_enabled === true && lists.projectId.length > 0,
        };
    });
    const ids = nightlyBasecampRetryIds(rows);
    let ok = 0;
    let failed = 0;
    let skipped = 0;
    for (const id of ids) {
        const outcome = await syncStoredPlanTask(id);
        if (outcome.status === 'ok') ok += 1;
        else if (outcome.status === 'failed') failed += 1;
        else skipped += 1;
    }
    return { selected: ids.length, ok, failed, skipped };
}
