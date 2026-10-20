import { NextResponse } from 'next/server';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { handlePlanBasecampSync } from '@/lib/seo-plan/basecamp-sync-route';
import { readStoredPlanTask, syncStoredPlanTask } from '@/lib/seo-plan/basecamp-push-server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

async function loadTask(taskId: string) {
    const admin = createAdminClient();
    const { data, error } = await admin
        .from('tasks')
        .select('organization_id')
        .eq('id', taskId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { organizationId: data.organization_id as string };
}

async function respond(method: string, request: Request) {
    let body: unknown = null;
    if (method === 'POST') {
        try {
            body = await request.json();
        } catch {
            body = null;
        }
    }
    const result = await handlePlanBasecampSync(method, request.url, body, {
        session: resolveSessionOrganization,
        loadTask,
        read: readStoredPlanTask,
        sync: syncStoredPlanTask,
    });
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

/** Read-only sync line for the plan side panel. */
export async function GET(request: Request) {
    return respond('GET', request);
}

/** One push. Retry uses the same call. */
export async function POST(request: Request) {
    return respond('POST', request);
}
