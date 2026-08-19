import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listBasecampProjects, isBasecampConfigured } from '@/lib/basecamp/api';
import {
    resolveBasecampProjectAccess,
    scopeBasecampProjects,
    type BasecampProjectAccessSource,
} from '@/lib/basecamp/project-access';

export const dynamic = 'force-dynamic';

/** GET /api/integrations/basecamp/projects?organizationId=... — returns authorized active projects. */
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

    const organizationId = req.nextUrl.searchParams.get('organizationId');

    try {
        const admin = user && organizationId?.trim() ? createAdminClient() : null;
        const accessSource: BasecampProjectAccessSource = {
            async findMembership(userId, requestedOrganizationId) {
                if (!admin) return null;
                const { data: membership, error: membershipError } = await admin
                    .from('organization_members')
                    .select('organization_id')
                    .eq('organization_id', requestedOrganizationId)
                    .eq('user_id', userId)
                    .maybeSingle();

                if (membershipError) throw membershipError;
                if (!membership) return null;

                const { data: organization, error: organizationError } = await admin
                    .from('organizations')
                    .select('is_internal')
                    .eq('id', requestedOrganizationId)
                    .maybeSingle();

                if (organizationError) throw organizationError;
                if (!organization) return null;
                return { organizationIsInternal: organization.is_internal === true };
            },
            async listConfiguredProjectIds(requestedOrganizationId) {
                if (!admin) return [];
                const { data: clients, error } = await admin
                    .from('clients')
                    .select('custom_fields')
                    .eq('organization_id', requestedOrganizationId);

                if (error) throw error;
                return (clients ?? []).map(client => {
                    const customFields = client.custom_fields as Record<string, unknown> | null;
                    const projectId = customFields?.basecamp_project_id;
                    return typeof projectId === 'string' || typeof projectId === 'number'
                        ? projectId
                        : null;
                });
            },
        };

        const access = await resolveBasecampProjectAccess({
            userId: user?.id,
            organizationId,
        }, accessSource);

        if (!access.ok) {
            return NextResponse.json({ error: access.error }, { status: access.status });
        }

        if (!isBasecampConfigured()) {
            return NextResponse.json({
                error: 'Basecamp not configured. Add BASECAMP_ACCESS_TOKEN and BASECAMP_ACCOUNT_ID to your Vercel environment variables.',
                configured: false,
            }, { status: 503 });
        }

        if (!access.canEnumerateCatalog && access.allowedProjectIds.length === 0) {
            return NextResponse.json({ projects: [], configured: true });
        }

        const projects = scopeBasecampProjects(await listBasecampProjects(), access);
        return NextResponse.json({ projects, configured: true });
    } catch {
        return NextResponse.json({ error: 'Unable to verify organization access' }, { status: 500 });
    }
}
