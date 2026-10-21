/**
 * Load one client's plan tasks and relink them with the service-role client.
 * Tests never import this file. They call relinkBasecampChildren with fakes.
 */

import { createPlanBasecampProvider } from '../basecamp/plan-push-provider';
import { readBasecampPlanLists } from '../basecamp/plan-lists';
import { normalizeJsonObject } from '../basecamp/project-access';
import { createAdminClient } from '../supabase/admin';
import {
    clearPendingTrashUpdate,
    readPendingTrashId,
    taskBasecampLinkUpdate,
    type BasecampNestDependencies,
} from './basecamp-nest';
import { buildRelinkParents, type RelinkSnapshot, type RelinkTaskRow } from './basecamp-relink-route';
import { asBasecampNestProvider } from './basecamp-push-run';

type TaskRow = {
    id: string;
    title: string;
    status: string | null;
    parent_task_id: string | null;
    basecamp_todo_id: number | string | null;
    basecamp_sync_error: string | null;
    position: number | null;
    created_at: string | null;
};

function todoId(value: number | string | null): string | null {
    if (value == null || value === '') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

export function relinkRows(rows: readonly TaskRow[]): RelinkTaskRow[] {
    return rows.map(row => ({
        id: row.id,
        title: row.title,
        status: row.status,
        parentTaskId: row.parent_task_id,
        basecampTodoId: todoId(row.basecamp_todo_id),
        pendingTrashId: readPendingTrashId(row.basecamp_sync_error),
        position: typeof row.position === 'number' && Number.isFinite(row.position) ? row.position : null,
        createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    }));
}

function nestDependencies(): BasecampNestDependencies {
    const provider = asBasecampNestProvider(createPlanBasecampProvider());
    if (!provider) throw new Error('Basecamp nesting is not available.');
    return {
        now: () => new Date().toISOString(),
        provider,
        store: {
            async linkTodo(taskId, linkedProjectId, recordingId, at, pendingTrashId) {
                const { error } = await createAdminClient()
                    .from('tasks')
                    .update(taskBasecampLinkUpdate({
                        projectId: linkedProjectId,
                        todoId: recordingId,
                        at,
                        pendingTrashId,
                    }))
                    .eq('id', taskId);
                if (error) throw error;
            },
            async clearPendingTrash(taskId, at) {
                const admin = createAdminClient();
                const { data, error } = await admin
                    .from('tasks')
                    .select('basecamp_sync_error')
                    .eq('id', taskId)
                    .maybeSingle();
                if (error) throw error;
                if (!readPendingTrashId(data?.basecamp_sync_error)) return;
                const { error: updateError } = await admin
                    .from('tasks')
                    .update(clearPendingTrashUpdate(at))
                    .eq('id', taskId);
                if (updateError) throw updateError;
            },
        },
    };
}

export async function loadBasecampRelink(
    organizationId: string,
    clientId: string,
    parentTaskId: string | null,
): Promise<{ ok: true; snapshot: RelinkSnapshot } | { ok: false; status: 400 | 404; error: string }> {
    const admin = createAdminClient();
    const { data: client, error: clientError } = await admin
        .from('clients')
        .select('id, custom_fields')
        .eq('id', clientId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return { ok: false, status: 404, error: 'Not found' };

    const { data, error } = await admin
        .from('tasks')
        .select('id, title, status, parent_task_id, basecamp_todo_id, basecamp_sync_error, position, created_at')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    if (error) throw error;
    const built = buildRelinkParents(relinkRows((data ?? []) as TaskRow[]), parentTaskId);
    if (!built.ok) return built;
    const lists = readBasecampPlanLists(normalizeJsonObject(client.custom_fields));
    return {
        ok: true,
        snapshot: {
            clientId,
            projectId: lists.projectId || null,
            parents: built.parents,
            claimedRecordingIds: built.claimedRecordingIds,
        },
    };
}

/** The provider for a real run. Dry run uses the same reads and writes nothing. */
export function basecampRelinkNesting(snapshot: RelinkSnapshot): BasecampNestDependencies {
    if (!snapshot.projectId) {
        throw new Error('This client has no Basecamp project.');
    }
    return nestDependencies();
}
