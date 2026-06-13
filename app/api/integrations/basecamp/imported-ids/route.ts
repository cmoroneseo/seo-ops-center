import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/basecamp/imported-ids?clientId=
 * Returns the list of basecamp_todo_id values already imported for a client.
 * Used by BasecampImportModal to grey-out already-imported todos.
 */
export async function GET(req: NextRequest) {
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
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });

    const admin = createAdminClient();
    const { data, error } = await admin
        .from('tasks')
        .select('basecamp_todo_id')
        .eq('client_id', clientId)
        .not('basecamp_todo_id', 'is', null);

    if (error) return NextResponse.json({ ids: [] });

    const ids = (data ?? []).map((r: { basecamp_todo_id: number }) => r.basecamp_todo_id).filter(Boolean);
    return NextResponse.json({ ids });
}
