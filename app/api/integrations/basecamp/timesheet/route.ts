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

/**
 * GET /api/integrations/basecamp/timesheet?projectId=...
 * Availability check used when enabling time sync for a client:
 * is the Timesheet tool on, and can we resolve a place to log entries?
 */
export async function GET(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isBasecampConfigured()) {
        return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
    }

    const projectId = req.nextUrl.searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

    const timesheetEnabled = await getBasecampProjectTimesheetEnabled(projectId);
    const recordingId = timesheetEnabled ? await findProjectTimesheetRecordingId(projectId) : null;
    return NextResponse.json({
        timesheetEnabled: timesheetEnabled ?? false,
        recordingFound: recordingId !== null,
    });
}

/**
 * POST /api/integrations/basecamp/timesheet
 * Pushes a time_logs row into the client's Basecamp project timesheet.
 *
 * Body variants:
 *   { action: 'sync', timeLogId, createIfMissing? }  — create or update the Basecamp entry
 *   { action: 'remove', entryId, timeLogId? }        — delete the Basecamp entry
 *
 * 'sync' is idempotent and safe to fire after any time-log write: it no-ops
 * unless the client has both Basecamp sync and timesheet sync enabled, and
 * only creates a new Basecamp entry when createIfMissing is true.
 */
export async function POST(req: NextRequest) {
    const user = await getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!isBasecampConfigured()) {
        return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
    }

    const body = await req.json();
    const { action } = body;
    const admin = createAdminClient();

    try {
        if (action === 'remove') {
            const { entryId, timeLogId } = body;
            if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 });
            const ok = await deleteBasecampTimesheetEntry(entryId);
            if (ok && timeLogId) {
                await admin.from('time_logs').update({
                    basecamp_entry_id: null,
                    basecamp_synced_at: null,
                    basecamp_sync_error: null,
                }).eq('id', timeLogId);
            }
            return NextResponse.json({ success: ok });
        }

        if (action !== 'sync') {
            return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
        }

        const { timeLogId, createIfMissing = false } = body;
        if (!timeLogId) return NextResponse.json({ error: 'timeLogId required' }, { status: 400 });

        const { data: log } = await admin
            .from('time_logs')
            .select('id, organization_id, client_id, user_id, task_id, date, hours, description, status, basecamp_entry_id, basecamp_project_id')
            .eq('id', timeLogId)
            .maybeSingle();
        if (!log) return NextResponse.json({ error: 'Time log not found' }, { status: 404 });
        if (log.status !== 'logged' || !(Number(log.hours) > 0)) {
            return NextResponse.json({ skipped: true, reason: 'not a logged entry with hours' });
        }

        const failSync = async (message: string) => {
            await admin.from('time_logs').update({ basecamp_sync_error: message }).eq('id', timeLogId);
            return NextResponse.json({ success: false, error: message });
        };

        /*
         * Where does this entry go?
         *
         *   client work    → the client's configured Basecamp project
         *   internal work  → the project chosen on the log itself
         *
         * Internal time (a 1:1, admin) has no client, so there is no client
         * config to read. Those entries carry their own destination — one of
         * the personal/HQ projects — in time_logs.basecamp_project_id.
         */
        let projectId: string | undefined;
        // Only client projects cache their timesheet recording id (in
        // clients.custom_fields); internal picks have nowhere to cache it.
        let cf: Record<string, unknown> = {};

        if (log.client_id) {
            // Per-client config lives in clients.custom_fields (same as task sync)
            const { data: client } = await admin
                .from('clients')
                .select('custom_fields')
                .eq('id', log.client_id)
                .single();
            cf = (client?.custom_fields as Record<string, unknown>) ?? {};
            projectId = cf.basecamp_project_id as string | undefined;
            if (!cf.basecamp_sync_enabled || !projectId || !cf.basecamp_timesheet_enabled) {
                return NextResponse.json({ skipped: true, reason: 'timesheet sync not enabled for this client' });
            }
        } else {
            projectId = log.basecamp_project_id ? String(log.basecamp_project_id) : undefined;
            if (!projectId) {
                return NextResponse.json({ skipped: true, reason: 'no Basecamp project chosen for this internal entry' });
            }
            // The client path trusts its stored config; internal picks are made
            // ad hoc, so confirm the Timesheet tool is actually on first.
            const enabled = await getBasecampProjectTimesheetEnabled(projectId);
            if (!enabled) {
                return failSync('The Timesheet tool is not enabled for that Basecamp project.');
            }
        }

        // Attribute the entry to the right Basecamp person when mapped;
        // otherwise Basecamp falls back to the authenticated (token) user.
        let personId: number | undefined;
        if (log.user_id) {
            const { data: member } = await admin
                .from('organization_members')
                .select('basecamp_person_id')
                .eq('organization_id', log.organization_id)
                .eq('user_id', log.user_id)
                .maybeSingle();
            if (member?.basecamp_person_id) personId = Number(member.basecamp_person_id);
        }

        const entryFields = {
            date: String(log.date).slice(0, 10),
            hours: Number(log.hours),
            description: log.description || undefined,
            personId,
        };

        // Already synced → update in place (recreate if it was deleted in Basecamp)
        if (log.basecamp_entry_id) {
            const result = await updateBasecampTimesheetEntry(log.basecamp_entry_id, entryFields);
            if (result === 'ok') {
                await admin.from('time_logs').update({
                    basecamp_synced_at: new Date().toISOString(),
                    basecamp_sync_error: null,
                }).eq('id', timeLogId);
                return NextResponse.json({ success: true, entryId: log.basecamp_entry_id });
            }
            if (result === 'error') return await failSync('Basecamp rejected the update — check the entry in Basecamp.');
            // 'not_found': entry deleted in Basecamp — fall through and recreate
        } else if (!createIfMissing) {
            return NextResponse.json({ skipped: true, reason: 'not synced yet' });
        }

        // Resolve the recording to attach to: a synced todo beats the project timesheet
        let recordingId: number | null = null;
        if (log.task_id) {
            const { data: task } = await admin
                .from('tasks')
                .select('basecamp_todo_id, basecamp_project_id')
                .eq('id', log.task_id)
                .maybeSingle();
            if (task?.basecamp_todo_id && String(task.basecamp_project_id) === String(projectId)) {
                recordingId = task.basecamp_todo_id;
            }
        }
        if (!recordingId && cf.basecamp_timesheet_recording_id) {
            recordingId = Number(cf.basecamp_timesheet_recording_id);
        }
        if (!recordingId) {
            recordingId = await findProjectTimesheetRecordingId(projectId);
            // Cache so future syncs skip the discovery round trip. Client-only:
            // an internal entry has no client row to cache against.
            if (recordingId && log.client_id) {
                await admin.from('clients').update({
                    custom_fields: { ...cf, basecamp_timesheet_recording_id: recordingId },
                }).eq('id', log.client_id);
            }
        }
        if (!recordingId) return await failSync(NO_TIMESHEET_HINT);

        const created = await createBasecampTimesheetEntry(recordingId, entryFields);
        if (!created) return await failSync('Basecamp rejected the entry — check that the Timesheet tool is enabled on the project.');

        await admin.from('time_logs').update({
            basecamp_entry_id: created.id,
            basecamp_project_id: Number(projectId),
            basecamp_synced_at: new Date().toISOString(),
            basecamp_sync_error: null,
        }).eq('id', timeLogId);

        return NextResponse.json({ success: true, entryId: created.id, appUrl: created.appUrl });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('[Basecamp timesheet] error:', message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
