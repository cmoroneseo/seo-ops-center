import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { isUuid } from '@/lib/portal/access-policy';
import { ROADMAP_COPY, projectClientRoadmap, todayForRoadmap } from '@/lib/reports/roadmap';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { loadClientPlanBoard, loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * Live roadmap for the report editor.
 * The client id is the path key. The organization comes from the session.
 * Tasks are read with that user's client, so row-level security still applies.
 * This route does not use the service role.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ clientId: string }> }) {
    const { clientId } = await params;
    if (!isUuid(clientId)) {
        return NextResponse.json({ error: ROADMAP_COPY.chooseClient }, { status: 400, headers: NO_STORE });
    }
    const session = await resolveSessionOrganization();
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status, headers: NO_STORE });

    const cookieStore = await cookies();
    const db = createServerClient(
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

    try {
        const tasks = await loadClientStageTasks(db, session.organizationId, clientId);
        if (!tasks) return NextResponse.json({ error: ROADMAP_COPY.error }, { status: 404, headers: NO_STORE });
        const board = await loadClientPlanBoard(db, session.organizationId, clientId);
        const roadmap = projectClientRoadmap({ board, tasks, today: todayForRoadmap() });
        return NextResponse.json({ roadmap }, { headers: NO_STORE });
    } catch {
        return NextResponse.json({ error: ROADMAP_COPY.error }, { status: 500, headers: NO_STORE });
    }
}
