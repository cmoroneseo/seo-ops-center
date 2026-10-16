import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { resolveSessionOrganization } from '@/lib/reports/session-org';
import { seoPlanStageListEnabled } from '@/lib/seo-plan/flags';
import { loadClientStageTasks } from '@/lib/seo-plan/stage-list-load';
import { readClientStageList } from '@/lib/seo-plan/stage-list-route';

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
