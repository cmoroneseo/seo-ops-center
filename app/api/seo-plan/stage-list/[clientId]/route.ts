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
import { loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
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
    const result = await readClientStageList(clientId, {
        session: resolveSessionOrganization,
        enabled: organizationId => seoPlanStageListEnabled(process.env, organizationId),
        load: async (organizationId, id) => loadClientStageTasks(await stageListDb(), organizationId, id),
    });
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

function actorLabel(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string | undefined {
    const fullName = user?.user_metadata && typeof user.user_metadata.full_name === 'string'
        ? user.user_metadata.full_name.trim()
        : '';
    return fullName || user?.email || undefined;
}

/**
 * Create tasks in one stage. The client id is the path key. Organization and
 * the acting user come from the session. Basecamp push stays off, matching
 * the Create Task dialog before its sync toggle is turned on.
 */
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
        syncToBasecamp: false,
        now: () => new Date().toISOString(),
        loadClient: (organizationId, id) => clientBelongsToOrganization(db, organizationId, id),
        loadParent: (organizationId, id, parentTaskId) => loadStageAddParent(db, organizationId, id, parentTaskId),
        maxPosition: (organizationId, id, stage, parentTaskId) => (
            maxStageAddPosition(db, organizationId, id, stage, parentTaskId)
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
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}

/**
 * Move one task within or between stages. The client id is the path key.
 * Organization and role come from the session. One database call rewrites
 * stage, position, and parent for the affected rows.
 */
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
        rewrite: (organizationId, id, writes) => rewriteStageTasks(db, organizationId, id, writes),
    });
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
