import { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listBasecampProjects, isBasecampConfigured } from '@/lib/basecamp/api';
import { createBasecampProjectsGet } from '@/lib/basecamp/projects-route';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/projects?organizationId=... — returns authorized active projects. */
export async function GET(req: NextRequest) {
    const get = createBasecampProjectsGet({
        async getUserId() {
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
            return user?.id ?? null;
        },
        createAccessSource: () => createSupabaseBasecampProjectAccessSource(createAdminClient()),
        createCatalog: () => ({
            isConfigured: isBasecampConfigured,
            listProjects: listBasecampProjects,
        }),
    });

    return get(req);
}
