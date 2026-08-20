import { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listBasecampTodolists, listBasecampTodos, isBasecampConfigured } from '@/lib/basecamp/api';
import { createBasecampTodosGet } from '@/lib/basecamp/resource-routes';
import { createSupabaseBasecampProjectAccessSource } from '@/lib/basecamp/supabase-project-access-source';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/todos?organizationId=&projectId=&todolistId= */
export async function GET(req: NextRequest) {
    const get = createBasecampTodosGet({
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
        isConfigured: isBasecampConfigured,
        listTodolists: projectId => listBasecampTodolists(projectId),
        listTodos: (projectId, todolistId, includeCompleted) => (
            listBasecampTodos(projectId, todolistId, includeCompleted)
        ),
    });

    return get(req);
}
