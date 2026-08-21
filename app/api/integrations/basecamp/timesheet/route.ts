import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import {
    isBasecampConfigured,
    getBasecampProjectTimesheetEnabled,
    findProjectTimesheetRecordingId,
    getBasecampProjectTimesheetEntry,
    listBasecampProjectTimesheetEntries,
    getBasecampTodo,
    createBasecampTimesheetEntry,
    updateBasecampTimesheetEntry,
    deleteBasecampTimesheetEntry,
} from '@/lib/basecamp/api';
import { createBasecampTimesheetGet } from '@/lib/basecamp/resource-routes';
import {
    createBasecampTimesheetPost,
    selectAdoptableTimesheetEntry,
} from '@/lib/basecamp/timesheet-post-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { normalizeJsonObject } from '@/lib/basecamp/project-access';
import { requireTimeLogIntegrationManager } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

async function getUser() {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return user;
}

/** GET /api/integrations/basecamp/timesheet?organizationId=&projectId= */
export async function GET(req: NextRequest) {
    const get = createBasecampTimesheetGet({
        getUserId: async () => (await getUser())?.id ?? null,
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        isConfigured: isBasecampConfigured,
        listTodolists: async () => [],
        getTimesheetEnabled: projectId => getBasecampProjectTimesheetEnabled(projectId),
        findTimesheetRecordingId: projectId => findProjectTimesheetRecordingId(projectId),
    });
    return get(req);
}

/** POST /api/integrations/basecamp/timesheet */
export async function POST(req: NextRequest) {
    const post = createBasecampTimesheetPost({
        authorizeTimeLog: timeLogId => requireTimeLogIntegrationManager(timeLogId),
        createStore() {
            const admin = createAdminClient();
            return {
                async getTimeLog(timeLogId, organizationId, clientId) {
                    let query = admin
                        .from('time_logs')
                        .select('id, organization_id, client_id, user_id, task_id, date, hours, description, status, basecamp_entry_id, basecamp_project_id, basecamp_recording_id, basecamp_sync_error')
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
                    if (log.task_id) {
                        let taskQuery = admin
                            .from('tasks')
                            .select('basecamp_todo_id, basecamp_project_id')
                            .eq('id', log.task_id)
                            .eq('organization_id', organizationId);
                        if (clientId) taskQuery = taskQuery.eq('client_id', clientId);
                        const { data: task, error: taskError } = await taskQuery.maybeSingle();
                        if (taskError) throw taskError;
                        taskBasecampTodoId = task?.basecamp_todo_id ?? null;
                        taskBasecampProjectId = task?.basecamp_project_id ?? null;
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
                        taskBasecampProjectId,
                        personId,
                        clientCustomFields,
                    };
                },
            };
        },
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        async verifyEntry(projectId, entryId) {
            const entry = await getBasecampProjectTimesheetEntry(projectId, entryId);
            const recordingId = Number(entry?.parent?.id);
            return entry && Number.isSafeInteger(recordingId) && recordingId > 0
                ? { entryId: String(entry.id), recordingId: String(recordingId) }
                : null;
        },
        async resolveRecording(projectId, candidateRecordingId) {
            if (candidateRecordingId) {
                const todo = await getBasecampTodo(projectId, candidateRecordingId);
                if (todo && String(todo.id) === candidateRecordingId) return candidateRecordingId;
            }
            const projectRecordingId = await findProjectTimesheetRecordingId(projectId);
            if (!projectRecordingId) return null;
            const normalizedProjectRecordingId = String(projectRecordingId);
            return !candidateRecordingId || candidateRecordingId === normalizedProjectRecordingId
                ? normalizedProjectRecordingId
                : null;
        },
        async performAuthorized(body, context) {
            if (!isBasecampConfigured()) {
                return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
            }

            const admin = createAdminClient();
            const { log } = context;
            if (body.action === 'remove') {
                const ok = await deleteBasecampTimesheetEntry(context.entryId!);
                if (ok) {
                    await admin.from('time_logs').update({
                        basecamp_entry_id: null,
                        basecamp_recording_id: null,
                        basecamp_synced_at: null,
                        basecamp_sync_error: null,
                    }).eq('id', log.id).eq('organization_id', log.organizationId);
                }
                return NextResponse.json({ success: ok });
            }

            if (log.status !== 'logged' || !(log.hours > 0)) {
                return NextResponse.json({ skipped: true, reason: 'not a logged entry with hours' });
            }

            const failSync = async (message: string) => {
                await admin.from('time_logs').update({ basecamp_sync_error: message })
                    .eq('id', log.id)
                    .eq('organization_id', log.organizationId);
                return NextResponse.json({ success: false, error: message });
            };
            const projectId = context.projectId!;
            const entryFields = {
                date: log.date.slice(0, 10),
                hours: log.hours,
                description: log.description || undefined,
                personId: log.personId || undefined,
            };

            if (log.basecampEntryId) {
                const result = await updateBasecampTimesheetEntry(log.basecampEntryId, entryFields);
                if (result === 'ok') {
                    await admin.from('time_logs').update({
                        basecamp_recording_id: Number(context.recordingId),
                        basecamp_synced_at: new Date().toISOString(),
                        basecamp_sync_error: null,
                    }).eq('id', log.id).eq('organization_id', log.organizationId);
                    return NextResponse.json({ success: true, entryId: log.basecampEntryId });
                }
                if (result === 'error') {
                    return failSync('Basecamp rejected the update — check the entry in Basecamp.');
                }
            } else if (body.createIfMissing !== true) {
                return NextResponse.json({ skipped: true, reason: 'not synced yet' });
            }

            const recordingId = Number(context.recordingId);
            if (log.clientId) {
                await admin.from('clients').update({
                    custom_fields: {
                        ...(log.clientCustomFields ?? {}),
                        basecamp_timesheet_recording_id: recordingId,
                    },
                }).eq('id', log.clientId).eq('organization_id', log.organizationId);
            }

            // A previous sync failed, so its create may have succeeded with a lost
            // response. Adopt that entry from provider provenance before creating.
            let adoptedEntryId: string | null = null;
            const priorCandidates = log.basecampSyncError
                ? await listBasecampProjectTimesheetEntries(projectId)
                : [];
            if (priorCandidates.length > 0) {
                const candidates = priorCandidates;
                const { data: claimedRows } = await admin
                    .from('time_logs')
                    .select('basecamp_entry_id')
                    .eq('organization_id', log.organizationId)
                    .not('basecamp_entry_id', 'is', null)
                    .in('basecamp_entry_id', candidates.map(entry => entry.id));
                const claimedEntryIds = (claimedRows ?? []).map(row => row.basecamp_entry_id);
                adoptedEntryId = selectAdoptableTimesheetEntry(candidates, {
                    recordingId: String(recordingId),
                    date: entryFields.date,
                    hours: entryFields.hours,
                    description: log.description,
                }, claimedEntryIds);
            }

            const created = adoptedEntryId
                ? { id: Number(adoptedEntryId), appUrl: undefined as string | undefined }
                : await createBasecampTimesheetEntry(recordingId, entryFields);
            if (!created) {
                return failSync('Basecamp rejected the entry — check that the Timesheet tool is enabled on the project.');
            }

            await admin.from('time_logs').update({
                basecamp_entry_id: created.id,
                basecamp_project_id: Number(projectId),
                basecamp_recording_id: recordingId,
                basecamp_synced_at: new Date().toISOString(),
                basecamp_sync_error: null,
            }).eq('id', log.id).eq('organization_id', log.organizationId);
            return NextResponse.json({ success: true, entryId: created.id, appUrl: created.appUrl });
        },
    });
    return post(req);
}
