import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';

type ManageClientAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        canManageIntegrations: boolean;
    }
    | {
        ok: false;
        status: 400 | 401 | 403 | 404 | 500;
        error: string;
    };

type ClientMemberAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }
    | {
        ok: false;
        status: 400 | 401 | 403 | 404 | 500;
        error: string;
    };

function normalizeString(value: unknown) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function getAuthenticatedActor() {
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

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
        return null;
    }

    return {
        id: user.id,
        name: user.user_metadata?.full_name || user.email || 'Unknown',
    };
}

async function requireClientMember(
    clientIdInput: unknown,
    assertedOrganizationIdInput?: unknown,
): Promise<ClientMemberAuthorization> {
    const clientId = normalizeString(clientIdInput);
    const assertedOrganizationId = normalizeString(assertedOrganizationIdInput);

    if (!clientId) {
        return { ok: false, status: 400, error: 'Missing clientId' };
    }

    const actor = await getAuthenticatedActor();
    if (!actor) {
        return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const admin = createAdminClient();
    const { data: client, error: clientError } = await admin
        .from('clients')
        .select('id, organization_id')
        .eq('id', clientId)
        .maybeSingle();

    if (clientError) {
        return { ok: false, status: 500, error: 'Unable to verify client access' };
    }

    if (!client) {
        return { ok: false, status: 404, error: 'Client not found' };
    }

    if (assertedOrganizationId && assertedOrganizationId !== client.organization_id) {
        return { ok: false, status: 403, error: 'Client does not belong to organization' };
    }

    const { data: membership, error: membershipError } = await admin
        .from('organization_members')
        .select('role')
        .eq('organization_id', client.organization_id)
        .eq('user_id', actor.id)
        .maybeSingle();

    if (membershipError) {
        return { ok: false, status: 500, error: 'Unable to verify organization access' };
    }

    if (!membership) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    const role = membership.role as 'owner' | 'admin' | 'member' | 'viewer';
    return {
        ok: true,
        userId: actor.id,
        actorName: actor.name,
        organizationId: client.organization_id,
        clientId,
        role,
    };
}

/**
 * Verifies that the current Supabase user belongs to the client's organization.
 * The caller may pass an asserted organization id, but authorization is based on
 * the client's organization_id stored in the database.
 */
export async function requireClientOrgMember(
    clientIdInput: unknown,
    assertedOrganizationIdInput?: unknown,
): Promise<ClientMemberAuthorization> {
    return requireClientMember(clientIdInput, assertedOrganizationIdInput);
}

/**
 * Verifies that the current Supabase user can manage integrations for a client.
 * The caller may pass an asserted organization id, but authorization is based on
 * the client's organization_id stored in the database.
 */
export async function requireClientIntegrationManager(
    clientIdInput: unknown,
    assertedOrganizationIdInput?: unknown,
): Promise<ManageClientAuthorization> {
    const member = await requireClientMember(clientIdInput, assertedOrganizationIdInput);
    if (!member.ok) {
        return member;
    }

    const roleCanManageIntegrations = member.role === 'owner' || member.role === 'admin';

    if (roleCanManageIntegrations) {
        return {
            ...member,
            canManageIntegrations: true,
        };
    }

    const admin = createAdminClient();
    const { data: permission, error: permissionError } = await admin
        .from('organization_member_permissions')
        .select('can_manage_integrations')
        .eq('organization_id', member.organizationId)
        .eq('user_id', member.userId)
        .maybeSingle();

    if (permissionError) {
        return { ok: false, status: 500, error: 'Unable to verify integration permission' };
    }

    if (permission?.can_manage_integrations !== true) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    return {
        ...member,
        canManageIntegrations: true,
    };
}
