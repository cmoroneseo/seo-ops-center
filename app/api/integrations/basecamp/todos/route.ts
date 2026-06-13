import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { listBasecampTodos, isBasecampConfigured } from '@/lib/basecamp/api';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/todos?projectId=&todolistId= — returns todos for a todolist */
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

    if (!isBasecampConfigured()) {
        return NextResponse.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
    }

    const projectId = req.nextUrl.searchParams.get('projectId');
    const todolistId = req.nextUrl.searchParams.get('todolistId');
    if (!projectId || !todolistId) {
        return NextResponse.json({ error: 'projectId and todolistId are required' }, { status: 400 });
    }

    const todos = await listBasecampTodos(projectId, todolistId, true);
    return NextResponse.json({ todos });
}
