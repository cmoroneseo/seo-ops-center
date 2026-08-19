import { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { listBasecampProjects, isBasecampConfigured } from '@/lib/basecamp/api';
import {
    createBasecampProjectsGet,
    type BasecampProjectAccessSource,
} from '@/lib/basecamp/projects-route';

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
        createAccessSource(): BasecampProjectAccessSource {
            const admin = createAdminClient();
            return {
                async findMembership(userId, requestedOrganizationId) {
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
        },
        createCatalog: () => ({
            isConfigured: isBasecampConfigured,
            listProjects: listBasecampProjects,
        }),
    });

    return get(req);
}
