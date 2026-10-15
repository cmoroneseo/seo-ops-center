import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import {
    ARCHIVED_CLIENT_DB_STATUS,
    DELETE_CLIENT_FORBIDDEN,
    deleteClient,
} from '@/lib/clients/delete-client';
import { requireClientOrgMember } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';

async function userClient() {
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

function archiveFailure(error: { code?: string; message?: string }) {
    console.error('archive client failed');
    if (error.code === '42501' || (error.message ?? '').includes(DELETE_CLIENT_FORBIDDEN)) {
        return { error: DELETE_CLIENT_FORBIDDEN, statusCode: 403 as const };
    }
    return { error: 'Could not delete this client', statusCode: 500 as const };
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const supabase = await userClient();
    return deleteClient(id, {
        authorize: (clientId) => requireClientOrgMember(clientId),
        async loadClient(clientId, organizationId) {
            const { data, error } = await supabase
                .from('clients')
                .select('name, status')
                .eq('id', clientId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (error || !data?.name || !data.status) return null;
            return { name: data.name, status: data.status };
        },
        async archiveClient(clientId, organizationId) {
            const { data, error } = await supabase
                .from('clients')
                .update({ status: ARCHIVED_CLIENT_DB_STATUS })
                .eq('id', clientId)
                .eq('organization_id', organizationId)
                .neq('status', ARCHIVED_CLIENT_DB_STATUS)
                .select('id')
                .maybeSingle();
            if (error) return archiveFailure(error);
            if (!data) return { error: 'Client not found', statusCode: 404 };
            return {};
        },
        async logStatusChange(event) {
            await logClientActivity({
                organizationId: event.organizationId,
                clientId: event.clientId,
                eventType: 'client.status_changed',
                actorId: event.actorId,
                actorName: event.actorName,
                metadata: {
                    clientName: event.clientName,
                    fromStatus: event.fromStatus,
                    toStatus: event.toStatus,
                    archived: true,
                },
            });
        },
    });
}
