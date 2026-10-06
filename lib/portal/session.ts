import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from './access-policy';

export const PORTAL_CLIENT_COOKIE = 'portal_client_id';

export interface PortalContact {
    id: string;
    organizationId: string;
    clientId: string;
    email: string;
    displayName: string;
    clientName: string;
    logoUrl?: string;
    launchDate?: string;
    organizationName: string;
}

export interface PortalIdentity {
    userId: string;
    email: string;
    contact: PortalContact;
    contacts: PortalContact[];
}

type AccessResult =
    | { ok: true; identity: PortalIdentity }
    | { ok: false; status: 401 | 403 | 500; error: string };

async function sessionUser(): Promise<{ id: string; email: string } | null> {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return null;
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
    if (error || !user?.id || !user.email) return null;
    return { id: user.id, email: user.email.toLowerCase() };
}

/**
 * The signed-in user's live portal contacts. Organization and client ids come
 * from these rows, never from the request body or query string.
 */
export const requirePortalAccess = cache(async (): Promise<AccessResult> => {
    const user = await sessionUser();
    if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

    const admin = createAdminClient();
    const { data: rows, error } = await admin
        .from('client_portal_contacts')
        .select('id, organization_id, client_id, email, display_name')
        .eq('user_id', user.id)
        .is('revoked_at', null);
    if (error) return { ok: false, status: 500, error: 'Unable to verify portal access' };
    if (!rows?.length) return { ok: false, status: 403, error: 'Forbidden' };

    const clientIds = [...new Set(rows.map(row => row.client_id as string))];
    const orgIds = [...new Set(rows.map(row => row.organization_id as string))];
    const [{ data: clients, error: clientError }, { data: orgs, error: orgError }] = await Promise.all([
        admin.from('clients').select('id, name, logo_url, launch_date').in('id', clientIds),
        admin.from('organizations').select('id, name').in('id', orgIds),
    ]);
    if (clientError || orgError) return { ok: false, status: 500, error: 'Unable to verify portal access' };

    const clientById = new Map((clients ?? []).map(client => [client.id as string, client]));
    const orgById = new Map((orgs ?? []).map(org => [org.id as string, org]));

    const contacts: PortalContact[] = rows.flatMap(row => {
        const client = clientById.get(row.client_id as string);
        const org = orgById.get(row.organization_id as string);
        if (!client || !org) return [];
        const contact: PortalContact = {
            id: row.id as string,
            organizationId: row.organization_id as string,
            clientId: row.client_id as string,
            email: row.email as string,
            displayName: row.display_name as string,
            clientName: client.name as string,
            organizationName: org.name as string,
        };
        if (client.logo_url) contact.logoUrl = client.logo_url as string;
        if (client.launch_date) contact.launchDate = String(client.launch_date).slice(0, 10);
        return [contact];
    }).sort((a, b) => a.clientName.localeCompare(b.clientName));

    if (contacts.length === 0) return { ok: false, status: 403, error: 'Forbidden' };

    const cookieStore = await cookies();
    const requested = cookieStore.get(PORTAL_CLIENT_COOKIE)?.value;
    const contact = (requested && contacts.find(item => item.clientId === requested)) || contacts[0];
    return { ok: true, identity: { userId: user.id, email: user.email, contact, contacts } };
});

export async function setPortalClientCookie(clientId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    if (!isUuid(clientId)) return { ok: false, status: 400, error: 'Unknown client' };
    const access = await requirePortalAccess();
    if (!access.ok) return access;
    if (!access.identity.contacts.some(contact => contact.clientId === clientId)) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }
    const cookieStore = await cookies();
    cookieStore.set(PORTAL_CLIENT_COOKIE, clientId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true };
}
