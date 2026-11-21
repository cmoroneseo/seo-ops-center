import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanStageListEnabled } from '@/lib/seo-plan/flags';
import {
    clientBelongsToOrganization,
    deleteStageTasks,
    insertStageTasks,
    loadStageAddParent,
    maxStageAddPosition,
} from '@/lib/seo-plan/stage-add-db';
import { createStageTasks } from '@/lib/seo-plan/stage-add-route';
import { rewriteStageTasks } from '@/lib/seo-plan/stage-reorder-db';
import { reorderStageTasks } from '@/lib/seo-plan/stage-reorder-route';
import { syncStoredParentStepOrder, syncStoredPlanTask } from '@/lib/seo-plan/basecamp-push-server';
import { loadClientStageTasks, loadPlanBasecampBanner } from '@/lib/seo-plan/stage-list-load';
import { readClientStageList } from '@/lib/seo-plan/stage-list-route';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

async function stageListDb() {
    const cookieStore = await cookies();
    return createServerClient(
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
}

/** Read-only. Client id is the path key. Organization comes from the session. */
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
    const { clientId } = await params;
    const db = await stageListDb();
    const result = await readClientStageList(clientId, {
        session: resolveSessionOrganization,
        enabled: organizationId => seoPlanStageListEnabled(process.env, organizationId),
        load: (organizationId, id) => loadClientStageTasks(db, organizationId, id),
        basecampAccountId: process.env.BASECAMP_ACCOUNT_ID ?? null,
    });
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
    const session = await resolveSessionOrganization();
    const basecamp = session.ok
        ? await loadPlanBasecampBanner(db, session.organizationId, clientId)
        : null;
    return NextResponse.json({ ...result.body, basecamp }, { status: 200, headers: NO_STORE });
}

function actorLabel(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string | undefined {
    const fullName = user?.user_metadata && typeof user.user_metadata.full_name === 'string'
        ? user.user_metadata.full_name.trim()
        : '';
    return fullName || user?.email || undefined;
}

/** Create tasks using the path client and the session organization. */
export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
    const { clientId } = await params;
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        body = null;
    }
    const db = await stageListDb();
    const result = await createStageTasks(clientId, body, {
        session: resolveSessionOrganization,
        enabled: organizationId => seoPlanStageListEnabled(process.env, organizationId),
        now: () => new Date().toISOString(),
        pushToBasecamp: async taskId => {
            const outcome = await syncStoredPlanTask(taskId);
            return outcome.status === 'skipped' ? null : outcome.sync;
        },
        loadClient: (organizationId, id) => clientBelongsToOrganization(db, organizationId, id),
        loadProject: async (organizationId, id, initiativeId) => {
            const project = await db.from('campaign_initiatives').select('id')
                .eq('organization_id', organizationId).eq('client_id', id).eq('id', initiativeId).maybeSingle();
            if (project.error) throw project.error;
            return Boolean(project.data);
        },
        loadParent: (organizationId, id, parentTaskId) => loadStageAddParent(db, organizationId, id, parentTaskId),
        maxPosition: (organizationId, id, parentTaskId, initiativeId) => (
            maxStageAddPosition(db, organizationId, id, parentTaskId, initiativeId)
        ),
        insertTasks: rows => insertStageTasks(db, rows),
        deleteTasks: ids => deleteStageTasks(db, ids),
        logCreated: async event => {
            const { data: { user } } = await db.auth.getUser();
            await logClientActivity({
                organizationId: event.organizationId,
                clientId: event.clientId,
                eventType: 'task.created',
                actorId: event.userId,
                actorName: actorLabel(user),
                metadata: {
                    taskId: event.task.id,
                    title: event.task.title,
                    priority: 'medium',
                    ...(event.parentTitle
                        ? { parentTaskId: event.task.parentTaskId, parentTitle: event.parentTitle }
                        : {}),
                },
            });
        },
    });
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
    const session = await resolveSessionOrganization();
    const basecamp = session.ok ? await loadPlanBasecampBanner(db, session.organizationId, clientId) : null;
    return NextResponse.json({ ...result.body, basecamp }, { status: 200, headers: NO_STORE });
}

/** Persist task positions and parent changes for the session organization. */
export async function PATCH(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
    const { clientId } = await params;
    let body: unknown = null;
    try {
        body = await request.json();
    } catch {
        body = null;
    }
    const db = await stageListDb();
    const result = await reorderStageTasks(clientId, body, {
        session: resolveSessionOrganization,
        enabled: organizationId => seoPlanStageListEnabled(process.env, organizationId),
        load: (organizationId, id) => loadClientStageTasks(db, organizationId, id),
        loadProjects: async (organizationId, id) => {
            const projects = await db.from('campaign_initiatives').select('id')
                .eq('organization_id', organizationId).eq('client_id', id);
            if (projects.error) throw projects.error;
            return projects.data ?? [];
        },
        rewrite: (organizationId, id, writes) => rewriteStageTasks(db, organizationId, id, writes),
        pushPlanTask: async taskId => {
            const outcome = await syncStoredPlanTask(taskId);
            return outcome.status === 'skipped' ? null : outcome.sync;
        },
        syncStepOrder: parentTaskId => syncStoredParentStepOrder(parentTaskId),
    });
    if (result.status !== 200) return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
    const session = await resolveSessionOrganization();
    const basecamp = session.ok ? await loadPlanBasecampBanner(db, session.organizationId, clientId) : null;
    return NextResponse.json({ ...result.body, basecamp }, { status: 200, headers: NO_STORE });
}
