import type { createAdminClient } from '../supabase/admin';
import { normalizeJsonObject, type BasecampProjectAccessSource } from './project-access.ts';

type AdminClient = ReturnType<typeof createAdminClient>;

/** Production query adapter used by the Basecamp projects GET route. */
export function createSupabaseBasecampProjectAccessSource(
    admin: AdminClient,
): BasecampProjectAccessSource {
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
                const customFields = normalizeJsonObject(client.custom_fields);
                const projectId = customFields.basecamp_project_id;
                return typeof projectId === 'string' || typeof projectId === 'number'
                    ? projectId
                    : null;
            });
        },
    };
}
