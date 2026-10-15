import { scheduleGscSync } from '@/lib/gsc/schedule';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { createGscHandlers } from '@/lib/google/gsc-route';
import { GscError, readGscSites } from '@/lib/google/gsc-properties';
import { withPropertyLogos } from '@/lib/google/property-branding';
import { openCredentialSecrets, sealCredentialSecrets } from '@/lib/security/google-token-crypto';
import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';

export const maxDuration = 90;

const handlers = createGscHandlers({
    authorize: requireClientIntegrationManager,
    async load(auth) {
        let tokenResult: Awaited<ReturnType<typeof getGoogleAccessToken>>;
        try {
            tokenResult = await getGoogleAccessToken(auth.clientId, 'gsc', {
                statuses: ['active', 'error', 'pending_setup'],
            });
        } catch (error) {
            if (error instanceof GoogleAuthError) {
                throw new GscError(error.message, error.kind === 'reauth_required' ? 401 : 503);
            }
            throw error;
        }
        const admin = createAdminClient();
        const { data: row, error } = await admin.from('client_integrations').select('credentials, sync_status')
            .eq('organization_id', auth.organizationId).eq('client_id', auth.clientId).eq('service', 'gsc').maybeSingle();
        if (error) throw new Error('Unable to read integration');
        if (!row || row.sync_status === 'disconnected' || !tokenResult) throw new GscError('Connect Search Console to choose a property.', 401);
        return { token: tokenResult.token, credentials: row.credentials as Record<string, unknown> };
    },
    catalog: readGscSites,
    async branding(auth, sites) {
        const admin = createAdminClient();
        const { data: clients, error } = await admin.from('clients').select('id, domain, logo_url')
            .eq('organization_id', auth.organizationId).not('logo_url', 'is', null);
        if (error || !clients?.length) return sites;
        // Read only the saved identifier, never other clients' OAuth credentials.
        const { data: connections } = await admin.from('client_integrations').select('client_id, site_url:credentials->>site_url')
            .eq('organization_id', auth.organizationId).eq('service', 'gsc').neq('sync_status', 'disconnected')
            .in('client_id', clients.map(client => client.id));
        const properties = new Map((connections ?? []).map(row => [row.client_id, row.site_url]));
        return withPropertyLogos(sites, clients.map(client => ({
            domain: client.domain, logoUrl: client.logo_url, savedProperty: properties.get(client.id),
        })));
    },
    async save(auth, site, credentials) {
        const changed = credentials.site_url !== site.siteUrl;
        const next = sealCredentialSecrets({
            ...openCredentialSecrets(credentials),
            site_url: site.siteUrl,
            permission_level: site.permissionLevel,
        });
        const { error } = await createAdminClient().from('client_integrations').update({
            credentials: next,
            sync_status: 'active', error_message: null,
            ...(changed ? { last_synced_at: null } : {}),
        }).eq('organization_id', auth.organizationId).eq('client_id', auth.clientId).eq('service', 'gsc')
            .neq('sync_status', 'disconnected').filter('credentials', 'eq', JSON.stringify(credentials)).select('id').single();
        if (error) throw new GscError('Property could not be saved. Refresh the list and try again.', 409);
        scheduleGscSync(auth.organizationId, auth.clientId);
    },
    async activity(auth, site, previous) {
        await logClientActivity({ organizationId: auth.organizationId, clientId: auth.clientId,
            eventType: previous ? 'integration.reconfigured' : 'integration.connected', actorId: auth.userId, actorName: auth.actorName,
            metadata: { service: 'gsc', display_name: site.siteUrl, ...(previous ? { old_display_name: previous } : {}) },
        });
    },
});
export const GET = handlers.GET;
export const POST = handlers.POST;
