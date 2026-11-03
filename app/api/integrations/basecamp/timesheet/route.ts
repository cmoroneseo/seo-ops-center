import { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';
import {
    isBasecampConfigured,
    getBasecampProjectTimesheetEnabled,
    findProjectTimesheetRecordingId,
} from '@/lib/basecamp/api';
import { createBasecampTimesheetGet } from '@/lib/basecamp/resource-routes';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';
import { createLiveBasecampTimesheetPost } from '@/lib/basecamp/timesheet-live';
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
    return createLiveBasecampTimesheetPost(
        timeLogId => requireTimeLogIntegrationManager(timeLogId),
    )(req);
}
