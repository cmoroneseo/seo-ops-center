import { ga4ConnectionHealth } from '@/lib/ga4/connection-health';
import { publicGoogleEmail } from '@/lib/google/account';
import { ClientIntegration, IntegrationService } from '@/lib/types';

const PROPERTY_FIELD: Partial<Record<IntegrationService, string>> = {
    ga4: 'property_id',
    gsc: 'site_url',
    gbp: 'location_name',
};

/** Browser-safe integration row. Credentials stay on the server except the Google account email. */
export function toPublicIntegration(row: {
    id: string;
    organization_id: string;
    client_id: string;
    service: string;
    credentials?: Record<string, unknown> | null;
    connected_by?: string | null;
    connected_at: string;
    last_synced_at?: string | null;
    sync_status: string;
    error_message?: string | null;
}): ClientIntegration {
    const credentials = (row.credentials ?? {}) as Record<string, unknown>;
    const service = row.service as IntegrationService;
    const propertyField = PROPERTY_FIELD[service];

    return {
        id: row.id,
        organizationId: row.organization_id,
        clientId: row.client_id,
        service,
        connectedBy: row.connected_by ?? undefined,
        connectedAt: row.connected_at,
        lastSyncedAt: row.last_synced_at ?? undefined,
        syncStatus: row.sync_status as ClientIntegration['syncStatus'],
        errorMessage: row.error_message ?? undefined,
        selectedProperty: service === 'gsc' && row.sync_status !== 'disconnected' && typeof credentials.site_url === 'string' ? credentials.site_url : undefined,
        needsPropertySetup: propertyField
            ? row.sync_status === 'active' && !credentials[propertyField]
            : false,
        hasRankTrackerProjectId: service === 'ahrefs' ? !!credentials.rank_tracker_project_id : undefined,
        googleEmail: row.sync_status === 'disconnected' ? undefined : publicGoogleEmail(credentials),
        connectionHealth: service === 'ga4'
            ? ga4ConnectionHealth({
                syncStatus: row.sync_status,
                errorMessage: row.error_message,
                grantedScopes: credentials.granted_scopes,
            }) ?? undefined
            : undefined,
    };
}
