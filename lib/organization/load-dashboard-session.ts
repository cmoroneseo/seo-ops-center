import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

import type { Organization, OrganizationMember } from '@/lib/types';
import { DEFAULT_THEME, parseTheme } from '@/lib/theme/palette';
import { SELECTED_ORG_COOKIE } from '@/lib/theme/cookie';
import { dashboardSessionFromMemberships, type DashboardSession } from './dashboard-session';

const EMPTY: DashboardSession = { organization: null, memberships: [], theme: DEFAULT_THEME };
const ROLES = new Set(['owner', 'admin', 'member', 'viewer']);

export type DashboardBootstrapResult =
    | { status: 'ready' | 'anonymous'; session: DashboardSession }
    | { status: 'unknown' };

/**
 * One membership read for the dashboard shell. The client provider used to
 * repeat this after hydration and hold every page on Loading until it returned.
 * A failed read stays unknown so the client can still load, instead of sending
 * a signed-in user to organization setup.
 */
export async function loadDashboardBootstrap(): Promise<DashboardBootstrapResult> {
    try {
        const cookieStore = await cookies();
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) { return cookieStore.get(name)?.value; },
                    set(_name: string, _value: string, _options: CookieOptions) { },
                    remove(_name: string, _options: CookieOptions) { },
                },
            },
        );
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { status: 'anonymous', session: EMPTY };

        const { data, error } = await supabase
            .from('organization_members')
            .select(`
                id, organization_id, user_id, role, created_at,
                organization:organizations(*)
            `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: true });
        if (error || !data) return { status: 'unknown' };

        const memberships = data.flatMap((row) => {
            const organization = organizationFromRow(row.organization);
            const role = typeof row.role === 'string' ? row.role : '';
            const id = typeof row.id === 'string' ? row.id : '';
            const organizationId = typeof row.organization_id === 'string' ? row.organization_id : '';
            const userId = typeof row.user_id === 'string' ? row.user_id : '';
            const createdAt = typeof row.created_at === 'string' ? row.created_at : '';
            if (!id || !organizationId || !userId || !organization || !ROLES.has(role)) return [];
            const member: OrganizationMember = {
                id,
                organizationId,
                userId,
                role: role as OrganizationMember['role'],
                createdAt,
                organization,
            };
            return [member];
        });
        return {
            status: 'ready',
            session: dashboardSessionFromMemberships(memberships, cookieStore.get(SELECTED_ORG_COOKIE)?.value ?? null),
        };
    } catch {
        return { status: 'unknown' };
    }
}

function organizationFromRow(value: unknown): Organization | null {
    const row = Array.isArray(value) ? value[0] : value;
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name : '';
    const slug = typeof record.slug === 'string' ? record.slug : '';
    const createdAt = typeof record.created_at === 'string' ? record.created_at : '';
    if (!id || !name || !slug) return null;
    const status = record.subscription_status;
    const subscriptionStatus = status === 'active' || status === 'trialing' || status === 'past_due' || status === 'canceled' || status === 'incomplete'
        ? status
        : 'active';
    return {
        id,
        name,
        slug,
        stripeCustomerId: typeof record.stripe_customer_id === 'string' ? record.stripe_customer_id : undefined,
        subscriptionStatus,
        planType: record.plan_type === 'pro' || record.plan_type === 'agency' || record.plan_type === 'enterprise' || record.plan_type === 'starter' ? record.plan_type : 'starter',
        isInternal: record.is_internal === true,
        theme: parseTheme(record.theme),
        createdAt,
    };
}
