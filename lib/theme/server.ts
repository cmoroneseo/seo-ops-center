import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import { SELECTED_ORG_COOKIE } from './cookie';
import { DEFAULT_THEME, OrganizationTheme, parseTheme } from './palette';

/**
 * Resolve the active organization's brand theme during SSR.
 *
 * This is what removes the first-load brand flash: without it the theme is
 * only known after the client-side Supabase round trip, so a teammate who has
 * never loaded the app paints the default brand first. Falls back to the
 * shipped default on any failure — a theme is never worth failing a page over.
 */
export async function resolveServerTheme(): Promise<OrganizationTheme> {
    try {
        const cookieStore = await cookies();

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                    // A server component cannot write cookies; the middleware
                    // already refreshes the session on every request.
                    set(_name: string, _value: string, _options: CookieOptions) { },
                    remove(_name: string, _options: CookieOptions) { },
                },
            },
        );

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return DEFAULT_THEME;

        // Ordered so the server and the client agree on which organization is
        // "first" when no selection cookie exists yet — otherwise SSR could
        // pick a different org than the client and reintroduce the flash.
        const { data: members } = await supabase
            .from('organization_members')
            .select('organization_id, organization:organizations(theme)')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });

        if (!members?.length) return DEFAULT_THEME;

        const selectedId = cookieStore.get(SELECTED_ORG_COOKIE)?.value;
        const match = selectedId
            ? members.find((m) => m.organization_id === selectedId)
            : undefined;

        const row = (match ?? members[0]) as { organization?: { theme?: unknown } | null };
        return parseTheme(row.organization?.theme);
    } catch {
        return DEFAULT_THEME;
    }
}
