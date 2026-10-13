import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientOrgMember, requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { authorizeVaultClient, type VaultAccess } from './access';
import { vaultRpcFailure } from './errors';

export async function authorizeVaultRequest(clientId: string): Promise<VaultAccess> {
    return authorizeVaultClient(clientId, {
        lookupClient: async (id) => {
            try {
                const { data, error } = await createAdminClient()
                    .from('clients')
                    .select('organization_id')
                    .eq('id', id)
                    .maybeSingle();
                if (error) return 'error';
                if (!data?.organization_id) return null;
                return { organizationId: String(data.organization_id) };
            } catch {
                return 'error';
            }
        },
        requireMember: (id) => requireClientOrgMember(id),
        isPortalContact: async (userId, id) => {
            try {
                const { data, error } = await createAdminClient()
                    .from('client_portal_contacts')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('client_id', id)
                    .is('revoked_at', null)
                    .maybeSingle();
                if (error) return 'error';
                return Boolean(data);
            } catch {
                return 'error';
            }
        },
    });
}

export async function assertVaultAdmin(organizationId: string): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
    const admin = await requireOrganizationAdmin(organizationId);
    if (admin.ok) return { ok: true };
    if (admin.status === 401) return { ok: false, status: 401, error: 'Unauthorized' };
    return { ok: false, status: 403, error: 'Forbidden' };
}

export async function createVaultUserClient() {
    const cookieStore = await cookies();
    return createServerClient(
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
}

export async function callVault<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; status: 400 | 403 | 404 | 409 | 500; error: string }> {
    try {
        const supabase = await createVaultUserClient();
        const { data, error } = await supabase.rpc(fn, args);
        if (error) return { ok: false, ...vaultRpcFailure(error) };
        return { ok: true, data: data as T };
    } catch {
        return { ok: false, status: 500, error: 'Vault request failed' };
    }
}
