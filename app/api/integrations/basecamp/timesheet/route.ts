import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import {
    isBasecampConfigured,
    getBasecampProjectTimesheetEnabled,
    findProjectTimesheetRecordingId,
    createBasecampTimesheetEntry,
    updateBasecampTimesheetEntry,
    deleteBasecampTimesheetEntry,
} from '@/lib/basecamp/api';
import { createBasecampTimesheetGet } from '@/lib/basecamp/resource-routes';
import { createBasecampTimesheetPost } from '@/lib/basecamp/timesheet-post-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
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

const NO_TIMESHEET_HINT =
    'Couldn\'t find the project timesheet in Basecamp. Make sure the Timesheet tool is turned on for the project, '
    + 'then either log one entry directly in Basecamp\'s timesheet once, or link this time entry to a task that\'s synced to Basecamp.';

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
                        .select('id, organization_id, client_id, user_id, task_id, date, hours, description, status, basecamp_entry_id, basecamp_project_id')
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
                        clientCustomFields = (
                            client.custom_fields as Record<string, unknown> | null
                        ) ?? {};
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
        async performAuthorized(body, context) {
            if (!isBasecampConfigured()) {
                return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
            }

            const admin = createAdminClient();
            const { log } = context;
            if (body.action === 'remove') {
                const ok = await deleteBasecampTimesheetEntry(context.recordingId!);
                if (ok) {
                    await admin.from('time_logs').update({
                        basecamp_entry_id: null,
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

            let recordingId = context.recordingId ? Number(context.recordingId) : null;
            if (!recordingId && !log.clientId) {
                const enabled = await getBasecampProjectTimesheetEnabled(projectId);
                if (!enabled) return failSync('The Timesheet tool is not enabled for that Basecamp project.');
            }
            if (!recordingId) {
                recordingId = await findProjectTimesheetRecordingId(projectId);
                if (recordingId && log.clientId) {
                    await admin.from('clients').update({
                        custom_fields: {
                            ...(log.clientCustomFields ?? {}),
                            basecamp_timesheet_recording_id: recordingId,
                        },
                    }).eq('id', log.clientId).eq('organization_id', log.organizationId);
                }
            }
            if (!recordingId) return failSync(NO_TIMESHEET_HINT);

            const created = await createBasecampTimesheetEntry(recordingId, entryFields);
            if (!created) {
                return failSync('Basecamp rejected the entry — check that the Timesheet tool is enabled on the project.');
            }

            await admin.from('time_logs').update({
                basecamp_entry_id: created.id,
                basecamp_project_id: Number(projectId),
                basecamp_synced_at: new Date().toISOString(),
                basecamp_sync_error: null,
            }).eq('id', log.id).eq('organization_id', log.organizationId);
            return NextResponse.json({ success: true, entryId: created.id, appUrl: created.appUrl });
        },
    });
    return post(req);
}
