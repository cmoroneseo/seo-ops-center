import 'server-only';
import { createAdminClient } from './admin';
import { IntegrationService } from '../types';

/** Upsert an integration row (server-side only — uses service role to bypass RLS). */
export async function upsertIntegration(payload: {
    organizationId: string;
    clientId: string;
    service: IntegrationService;
    credentials: Record<string, unknown>;
    connectedBy: string;
    syncStatus?: string;
}): Promise<{ success: boolean; error?: string }> {
    const admin = createAdminClient();
    if (!admin) return { success: false, error: 'Admin client unavailable' };
    try {
        const { error } = await admin.from('client_integrations').upsert({
            organization_id: payload.organizationId,
            client_id: payload.clientId,
            service: payload.service,
            credentials: payload.credentials,
            connected_by: payload.connectedBy,
            connected_at: new Date().toISOString(),
            sync_status: payload.syncStatus ?? 'active',
            error_message: null,
        }, { onConflict: 'client_id,service' });
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error upserting integration:', err);
        return { success: false, error: err.message };
    }
}

/** Disconnect an integration (admin only). */
export async function disconnectIntegration(
    clientId: string,
    service: IntegrationService,
): Promise<{ success: boolean; error?: string }> {
    const admin = createAdminClient();
    if (!admin) return { success: false, error: 'Admin client unavailable' };
    try {
        const { error } = await admin
            .from('client_integrations')
            .update({ sync_status: 'disconnected', credentials: {} })
            .eq('client_id', clientId)
            .eq('service', service);
        if (error) throw error;
        return { success: true };
    } catch (err: any) {
        console.error('Error disconnecting integration:', err);
        return { success: false, error: err.message };
    }
}

/** Fetch credentials for a client+service (server-side only). */
export async function getIntegrationCredentials(
    clientId: string,
    service: IntegrationService,
): Promise<Record<string, unknown> | null> {
    const admin = createAdminClient();
    if (!admin) return null;
    try {
        const { data, error } = await admin
            .from('client_integrations')
            .select('credentials')
            .eq('client_id', clientId)
            .eq('service', service)
            .eq('sync_status', 'active')
            .maybeSingle();
        if (error) throw error;
        return data?.credentials ?? null;
    } catch (err) {
        console.error('Error fetching credentials:', err);
        return null;
    }
}
