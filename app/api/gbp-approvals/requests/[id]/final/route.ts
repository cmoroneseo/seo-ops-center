import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
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
    const { data } = await supabase.auth.getUser();
    if (!data.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await request.json().catch(() => null) as { itemId?: string } | null;
    if (!body?.itemId) return Response.json({ error: 'Choose a post.' }, { status: 400 });
    const result = await createAdminClient().rpc('mark_gbp_approval_final', {
        p_actor: data.user.id,
        p_item_id: body.itemId,
        p_now: new Date().toISOString(),
    });
    if (result.error || !result.data) return Response.json({ error: 'The post could not be marked final.' }, { status: 400 });
    const value = result.data as { ok?: boolean; code?: string };
    if (value.ok === false) return Response.json({ error: 'The post could not be marked final.', code: value.code }, { status: value.code === 'forbidden' ? 403 : 400 });
    return Response.json(value);
}
