import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { SELECTED_ORG_COOKIE } from '@/lib/theme/cookie';

export interface SessionMembership {
    organizationId: string;
    role: string;
}

/**
 * Pick the membership the signed-in user is acting as.
 * A selected-organization cookie is only a hint. An id that is not one of
 * this user's memberships is ignored, and so is any organization id the
 * browser puts on the request.
 */
export function pickSessionOrganization<T extends SessionMembership>(
    members: readonly T[],
    selectedId: string | null,
): T | null {
    if (members.length === 0) return null;
    const match = selectedId ? members.find(member => member.organizationId === selectedId) : undefined;
    return match ?? members[0];
}

export type SessionOrganization =
    | {
        ok: true;
        userId: string;
        organizationId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }
    | { ok: false; status: 401 | 403 | 500; error: string };

const ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

/** Organization comes from the session's memberships, never from a query or body. */
export async function resolveSessionOrganization(): Promise<SessionOrganization> {
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

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) return { ok: false, status: 401, error: 'Unauthorized' };

    const { data, error } = await createAdminClient()
        .from('organization_members')
        .select('organization_id, role, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
    if (error) return { ok: false, status: 500, error: 'Unable to verify organization access' };

    const members = (data ?? []).flatMap(row => {
        const organizationId = typeof row.organization_id === 'string' ? row.organization_id : '';
        const role = typeof row.role === 'string' ? row.role : '';
        return organizationId && ROLES.has(role) ? [{ organizationId, role }] : [];
    });
    const picked = pickSessionOrganization(members, cookieStore.get(SELECTED_ORG_COOKIE)?.value ?? null);
    if (!picked) return { ok: false, status: 403, error: 'Forbidden' };
    return {
        ok: true,
        userId: user.id,
        organizationId: picked.organizationId,
        role: picked.role as 'owner' | 'admin' | 'member' | 'viewer',
    };
}
