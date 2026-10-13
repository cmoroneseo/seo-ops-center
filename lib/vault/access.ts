import { vaultEnabled } from './flags.ts';
import type { VaultRole } from './permissions.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type VaultMemberResult =
    | { ok: true; userId: string; actorName: string; organizationId: string; clientId: string; role: VaultRole }
    | { ok: false; status: 400 | 401 | 403 | 404 | 500; error: string };

export interface VaultAccessDeps {
    lookupClient: (clientId: string) => Promise<{ organizationId: string } | null | 'error'>;
    requireMember: (clientId: string) => Promise<VaultMemberResult>;
    isPortalContact: (userId: string, clientId: string) => Promise<boolean | 'error'>;
    env?: NodeJS.ProcessEnv;
}

export type VaultAccess =
    | { ok: true; userId: string; actorName: string; organizationId: string; clientId: string; role: VaultRole }
    | { ok: false; status: 401 | 403 | 404 | 500; error: string };

/**
 * Flag off, an unknown client, another organization's client, and a portal
 * contact all look the same from the outside: 404. Role failures stay on the
 * write routes, which call requireOrganizationAdmin.
 */
export async function authorizeVaultClient(clientId: string, deps: VaultAccessDeps): Promise<VaultAccess> {
    if (!UUID.test(clientId)) return { ok: false, status: 404, error: 'Not found' };
    const client = await deps.lookupClient(clientId);
    if (client === 'error') return { ok: false, status: 500, error: 'Unable to verify client access' };
    if (!client) return { ok: false, status: 404, error: 'Not found' };
    if (!vaultEnabled(deps.env ?? process.env, client.organizationId)) {
        return { ok: false, status: 404, error: 'Not found' };
    }
    const member = await deps.requireMember(clientId);
    if (!member.ok) {
        if (member.status === 401) return { ok: false, status: 401, error: 'Unauthorized' };
        if (member.status === 500) return { ok: false, status: 500, error: member.error };
        return { ok: false, status: 404, error: 'Not found' };
    }
    const portal = await deps.isPortalContact(member.userId, clientId);
    if (portal === 'error') return { ok: false, status: 500, error: 'Unable to verify client access' };
    if (portal) return { ok: false, status: 404, error: 'Not found' };
    return {
        ok: true,
        userId: member.userId,
        actorName: member.actorName,
        organizationId: member.organizationId,
        clientId: member.clientId,
        role: member.role,
    };
}
