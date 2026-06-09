import { NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { listBasecampProjects, isBasecampConfigured } from '@/lib/basecamp/api';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/projects — returns active Basecamp projects */
export async function GET() {
    // Require authenticated session
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
        return NextResponse.json({
            error: 'Basecamp not configured. Add BASECAMP_ACCESS_TOKEN and BASECAMP_ACCOUNT_ID to your Vercel environment variables.',
            configured: false,
        }, { status: 503 });
    }

    const projects = await listBasecampProjects();
    return NextResponse.json({ projects, configured: true });
}
