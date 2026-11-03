import { createAdminClient } from '../supabase/admin.ts';
import {
    isBasecampConfigured,
    getBasecampProjectTimesheetEntry,
    findProjectTimesheetRecordingId,
    getBasecampTimesheetEntryState,
    listBasecampProjectTimesheetEntries,
    getBasecampTodo,
    createBasecampTimesheetEntry,
    updateBasecampTimesheetEntry,
    deleteBasecampTimesheetEntry,
    createBasecampComment,
} from './api.ts';
import {
    createBasecampTimesheetPost,
    persistTimesheetRecordingCache,
    resolveBasecampTimesheetRecording,
} from './timesheet-post-route.ts';
import { createTimesheetPerformer } from './timesheet-perform.ts';
import { createSupabaseBasecampProjectAccessSource } from './supabase-project-access-source.ts';
import { normalizeJsonObject } from './project-access.ts';

type AuthorizeTimeLog = Parameters<typeof createBasecampTimesheetPost>[0]['authorizeTimeLog'];

/**
 * The timesheet push the timer and the task drawer use. Callers supply who
 * is allowed to sync a log. The gate and the create-or-update stay shared
 * with bot time.
 */
export function createLiveBasecampTimesheetPost(authorizeTimeLog: AuthorizeTimeLog) {
    return createBasecampTimesheetPost({
        authorizeTimeLog,
        createStore() {
            const admin = createAdminClient();
            return {
                async getTimeLog(timeLogId, organizationId, clientId) {
                    let query = admin
                        .from('time_logs')
                        .select('id, organization_id, client_id, user_id, task_id, date, hours, description, status, basecamp_entry_id, basecamp_project_id, basecamp_recording_id, basecamp_sync_error, source, import_fingerprint')
                        .eq('id', timeLogId)
                        .eq('organization_id', organizationId);
                    query = clientId ? query.eq('client_id', clientId) : query.is('client_id', null);
                    const { data: log, error } = await query.maybeSingle();
                    if (error) throw error;
                    if (!log) return null;

                    let clientCustomFields: Record<string, unknown> = {};
                    if (clientId) {
                        const { data: client, error: clientError } = await admin
                            .from('clients')
                            .select('custom_fields')
                            .eq('id', clientId)
                            .eq('organization_id', organizationId)
                            .maybeSingle();
                        if (clientError) throw clientError;
                        if (!client) return null;
                        clientCustomFields = normalizeJsonObject(client.custom_fields);
                    }

                    let taskBasecampTodoId: string | number | null = null;
                    let taskBasecampProjectId: string | number | null = null;
                    let taskTitle: string | null = null;
                    let parentTaskId: string | null = null;
                    let parentBasecampTodoId: string | number | null = null;
                    let parentBasecampProjectId: string | number | null = null;
                    if (log.task_id) {
                        let taskQuery = admin
                            .from('tasks')
                            .select('basecamp_todo_id, basecamp_project_id, title, parent_task_id')
                            .eq('id', log.task_id)
                            .eq('organization_id', organizationId);
                        if (clientId) taskQuery = taskQuery.eq('client_id', clientId);
                        const { data: task, error: taskError } = await taskQuery.maybeSingle();
                        if (taskError) throw taskError;
                        taskBasecampTodoId = task?.basecamp_todo_id ?? null;
                        taskBasecampProjectId = task?.basecamp_project_id ?? null;
                        taskTitle = task?.title ?? null;
                        parentTaskId = task?.parent_task_id ?? null;
                        if (parentTaskId) {
                            let parentQuery = admin
                                .from('tasks')
                                .select('basecamp_todo_id, basecamp_project_id')
                                .eq('id', parentTaskId)
                                .eq('organization_id', organizationId);
                            if (clientId) parentQuery = parentQuery.eq('client_id', clientId);
                            const { data: parent, error: parentError } = await parentQuery.maybeSingle();
                            if (parentError) throw parentError;
                            parentBasecampTodoId = parent?.basecamp_todo_id ?? null;
                            parentBasecampProjectId = parent?.basecamp_project_id ?? null;
                        }
                    }

                    let personId: number | null = null;
                    if (log.user_id) {
                        const { data: member, error: memberError } = await admin
                            .from('organization_members')
                            .select('basecamp_person_id')
                            .eq('organization_id', organizationId)
                            .eq('user_id', log.user_id)
                            .maybeSingle();
                        if (memberError) throw memberError;
                        const candidate = Number(member?.basecamp_person_id);
                        if (Number.isSafeInteger(candidate) && candidate > 0) personId = candidate;
                    }

                    return {
                        id: log.id,
                        organizationId: log.organization_id,
                        clientId: log.client_id,
                        userId: log.user_id,
                        taskId: log.task_id,
                        date: String(log.date),
                        hours: Number(log.hours),
                        description: log.description,
                        status: log.status,
                        basecampEntryId: log.basecamp_entry_id,
                        basecampSyncError: log.basecamp_sync_error ?? null,
                        source: log.source ?? null,
                        importFingerprint: log.import_fingerprint ?? null,
                        basecampRecordingId: log.basecamp_recording_id,
                        selectedBasecampProjectId: log.basecamp_project_id,
                        configuredProjectId: (
                            clientCustomFields.basecamp_project_id as string | number | null | undefined
                        ) ?? null,
                        syncEnabled: clientCustomFields.basecamp_sync_enabled === true,
                        timesheetEnabled: clientCustomFields.basecamp_timesheet_enabled === true,
                        cachedRecordingId: (
                            clientCustomFields.basecamp_timesheet_recording_id as string | number | null | undefined
                        ) ?? null,
                        taskBasecampTodoId,
                        taskTitle,
                        taskBasecampProjectId,
                        parentTaskId,
                        parentBasecampTodoId,
                        parentBasecampProjectId,
                        personId,
                        clientCustomFields,
                    };
                },
            };
        },
        async recordSyncError({ timeLogId, organizationId, message }) {
            const admin = createAdminClient();
            const { error } = await admin.from('time_logs')
                .update({ basecamp_sync_error: message })
                .eq('id', timeLogId)
                .eq('organization_id', organizationId);
            if (error) throw error;
        },
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        async verifyEntry(projectId, entryId) {
            const entry = await getBasecampProjectTimesheetEntry(projectId, entryId);
            const recordingId = Number(entry?.parent?.id);
            return entry && Number.isSafeInteger(recordingId) && recordingId > 0
                ? { entryId: String(entry.id), recordingId: String(recordingId) }
                : null;
        },
        async resolveRecording(projectId, candidateRecordingId, candidateKind) {
            return resolveBasecampTimesheetRecording(
                projectId,
                candidateRecordingId,
                candidateKind,
                {
                    getTodo: (candidateProjectId, todoId) => (
                        getBasecampTodo(candidateProjectId, todoId)
                    ),
                    findProjectTimesheetRecordingId: candidateProjectId => (
                        findProjectTimesheetRecordingId(candidateProjectId)
                    ),
                },
            );
        },
        performAuthorized: createTimesheetPerformer({
            isConfigured: isBasecampConfigured,
            deleteEntry: entryId => deleteBasecampTimesheetEntry(entryId),
            updateEntry: (entryId, fields) => updateBasecampTimesheetEntry(entryId, fields),
            createEntry: (recordingId, fields) => createBasecampTimesheetEntry(recordingId, fields),
            listEntries: projectId => listBasecampProjectTimesheetEntries(projectId),
            readEntry: (projectId, entryId) => getBasecampTimesheetEntryState(projectId, entryId),
            createComment: (projectId, todoId, content) => createBasecampComment(projectId, todoId, content),
            async clearProviderLink(log) {
                const admin = createAdminClient();
                await admin.from('time_logs').update({
                    basecamp_entry_id: null,
                    basecamp_recording_id: null,
                    basecamp_synced_at: null,
                    basecamp_sync_error: null,
                    ...(log.source === 'basecamp' ? {} : { import_fingerprint: null }),
                }).eq('id', log.id).eq('organization_id', log.organizationId);
            },
            async recordError(log, message) {
                const admin = createAdminClient();
                await admin.from('time_logs').update({ basecamp_sync_error: message })
                    .eq('id', log.id)
                    .eq('organization_id', log.organizationId);
            },
            async markSynced(log, patch) {
                const admin = createAdminClient();
                await admin.from('time_logs').update({
                    ...(patch.entryId !== undefined ? {
                        basecamp_entry_id: patch.entryId,
                        basecamp_project_id: Number(patch.projectId),
                    } : {}),
                    basecamp_recording_id: Number(patch.recordingId),
                    basecamp_synced_at: new Date().toISOString(),
                    basecamp_sync_error: null,
                }).eq('id', log.id).eq('organization_id', log.organizationId);
            },
            async writeFingerprint(log, fingerprint) {
                const admin = createAdminClient();
                const { error } = await admin.from('time_logs')
                    .update({ import_fingerprint: fingerprint })
                    .eq('id', log.id)
                    .eq('organization_id', log.organizationId);
                return error ? (error.code ?? 'error') : null;
            },
            cacheRecording: (log, recordingId) => persistTimesheetRecordingCache(
                log,
                recordingId,
                args => createAdminClient().rpc('merge_client_custom_fields', args),
            ),
            async claimedEntryIds(organizationId, entryIds) {
                const admin = createAdminClient();
                const { data } = await admin
                    .from('time_logs')
                    .select('basecamp_entry_id')
                    .eq('organization_id', organizationId)
                    .not('basecamp_entry_id', 'is', null)
                    .in('basecamp_entry_id', entryIds);
                return (data ?? []).map(row => row.basecamp_entry_id);
            },
        }),
    });
}
