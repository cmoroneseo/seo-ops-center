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

type ManageTaskAuthorization =
    | (Extract<ManageClientAuthorization, { ok: true }> & { taskId: string })
    | Extract<ManageClientAuthorization, { ok: false }>;

type ManageTimeLogAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string | null;
        timeLogId: string;
        organizationIsInternal: boolean;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        canManageIntegrations: boolean;
    }
    | Extract<ManageClientAuthorization, { ok: false }>;

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

type OrganizationAdminAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        organizationName: string;
        role: 'owner' | 'admin';
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

async function requireClientMemberForActor(
    actor: { id: string; name: string },
    clientIdInput: unknown,
    assertedOrganizationIdInput?: unknown,
): Promise<ClientMemberAuthorization> {
    const clientId = normalizeString(clientIdInput);
    const assertedOrganizationId = normalizeString(assertedOrganizationIdInput);

    if (!clientId) {
        return { ok: false, status: 400, error: 'Missing clientId' };
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

async function requireClientMember(
    clientIdInput: unknown,
    assertedOrganizationIdInput?: unknown,
): Promise<ClientMemberAuthorization> {
    const actor = await getAuthenticatedActor();
    if (!actor) return { ok: false, status: 401, error: 'Unauthorized' };
    return requireClientMemberForActor(actor, clientIdInput, assertedOrganizationIdInput);
}

async function requireIntegrationManager(
    member: Extract<ClientMemberAuthorization, { ok: true }>,
): Promise<ManageClientAuthorization> {
    const roleCanManageIntegrations = member.role === 'owner' || member.role === 'admin';

    if (roleCanManageIntegrations) {
        return { ...member, canManageIntegrations: true };
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

    return { ...member, canManageIntegrations: true };
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

/** Requires an authenticated owner/admin for the canonical organization row. */
export async function requireOrganizationAdmin(
    organizationIdInput: unknown,
): Promise<OrganizationAdminAuthorization> {
    const organizationId = normalizeString(organizationIdInput);
    if (!organizationId) return { ok: false, status: 400, error: 'Missing organizationId' };

    const actor = await getAuthenticatedActor();
    if (!actor) return { ok: false, status: 401, error: 'Unauthorized' };

    const admin = createAdminClient();
    const { data: membership, error: membershipError } = await admin
        .from('organization_members')
        .select('role')
        .eq('organization_id', organizationId)
        .eq('user_id', actor.id)
        .maybeSingle();
    if (membershipError) {
        return { ok: false, status: 500, error: 'Unable to verify organization access' };
    }
    if (!membership || !['owner', 'admin'].includes(membership.role)) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    const { data: organization, error: organizationError } = await admin
        .from('organizations')
        .select('id, name')
        .eq('id', organizationId)
        .maybeSingle();
    if (organizationError) {
        return { ok: false, status: 500, error: 'Unable to verify organization' };
    }
    if (!organization) return { ok: false, status: 404, error: 'Organization not found' };

    return {
        ok: true,
        userId: actor.id,
        actorName: actor.name,
        organizationId: organization.id,
        organizationName: organization.name,
        role: membership.role as 'owner' | 'admin',
    };
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

    return requireIntegrationManager(member);
}

/** Resolves a task to its canonical client and requires integration-manager authority. */
export async function requireTaskIntegrationManager(
    taskIdInput: unknown,
): Promise<ManageTaskAuthorization> {
    const taskId = normalizeString(taskIdInput);
    if (!taskId) return { ok: false, status: 400, error: 'Missing taskId' };

    const actor = await getAuthenticatedActor();
    if (!actor) return { ok: false, status: 401, error: 'Unauthorized' };

    const admin = createAdminClient();
    const { data: task, error } = await admin
        .from('tasks')
        .select('id, organization_id, client_id')
        .eq('id', taskId)
        .maybeSingle();
    if (error) return { ok: false, status: 500, error: 'Unable to verify task access' };
    if (!task) return { ok: false, status: 404, error: 'Task not found' };
    if (!task.client_id) return { ok: false, status: 400, error: 'Task has no client' };

    const member = await requireClientMemberForActor(actor, task.client_id, task.organization_id);
    if (!member.ok) return member;
    const manager = await requireIntegrationManager(member);
    return manager.ok ? { ...manager, taskId } : manager;
}

/** Resolves a time log and requires integration-manager authority in its canonical org. */
export async function requireTimeLogIntegrationManager(
    timeLogIdInput: unknown,
): Promise<ManageTimeLogAuthorization> {
    const timeLogId = normalizeString(timeLogIdInput);
    if (!timeLogId) return { ok: false, status: 400, error: 'Missing timeLogId' };

    const actor = await getAuthenticatedActor();
    if (!actor) return { ok: false, status: 401, error: 'Unauthorized' };

    const admin = createAdminClient();
    const { data: timeLog, error } = await admin
        .from('time_logs')
        .select('id, organization_id, client_id')
        .eq('id', timeLogId)
        .maybeSingle();
    if (error) return { ok: false, status: 500, error: 'Unable to verify time log access' };
    if (!timeLog) return { ok: false, status: 404, error: 'Time log not found' };

    if (timeLog.client_id) {
        const member = await requireClientMemberForActor(
            actor,
            timeLog.client_id,
            timeLog.organization_id,
        );
        if (!member.ok) return member;
        const manager = await requireIntegrationManager(member);
        if (!manager.ok) return manager;
        return {
            ...manager,
            timeLogId,
            organizationIsInternal: false,
        };
    }

    const { data: membership, error: membershipError } = await admin
        .from('organization_members')
        .select('role')
        .eq('organization_id', timeLog.organization_id)
        .eq('user_id', actor.id)
        .maybeSingle();
    if (membershipError) {
        return { ok: false, status: 500, error: 'Unable to verify organization access' };
    }
    if (!membership) return { ok: false, status: 403, error: 'Forbidden' };

    const { data: organization, error: organizationError } = await admin
        .from('organizations')
        .select('is_internal')
        .eq('id', timeLog.organization_id)
        .maybeSingle();
    if (organizationError || !organization) {
        return { ok: false, status: 500, error: 'Unable to verify internal organization' };
    }
    if (organization.is_internal !== true) {
        return {
            ok: false,
            status: 403,
            error: 'Internal Basecamp time requires a trusted internal organization manager',
        };
    }

    const role = membership.role as 'owner' | 'admin' | 'member' | 'viewer';
    const manager = await requireIntegrationManager({
        ok: true,
        userId: actor.id,
        actorName: actor.name,
        organizationId: timeLog.organization_id,
        clientId: '',
        role,
    });
    if (!manager.ok) return manager;
    return {
        ok: true,
        userId: manager.userId,
        actorName: manager.actorName,
        organizationId: manager.organizationId,
        clientId: null,
        timeLogId,
        organizationIsInternal: true,
        role: manager.role,
        canManageIntegrations: true,
    };
}
