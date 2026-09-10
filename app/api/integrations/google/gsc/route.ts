import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { logClientActivity } from '@/lib/supabase/client-activity';
import { createGscHandlers } from '@/lib/google/gsc-route';
import { GscError, readGscSites } from '@/lib/google/gsc-properties';
import { withPropertyLogos } from '@/lib/google/property-branding';

const handlers = createGscHandlers({
    authorize: requireClientIntegrationManager,
    async load(auth) {
        const admin = createAdminClient();
        const { data: row, error } = await admin.from('client_integrations').select('credentials, sync_status')
            .eq('organization_id', auth.organizationId).eq('client_id', auth.clientId).eq('service', 'gsc').maybeSingle();
        if (error) throw new Error('Unable to read integration');
        if (!row || row.sync_status === 'disconnected') throw new GscError('Connect Search Console to choose a property.', 401);
        const credentials = { ...row.credentials } as Record<string, unknown>;
        let token = credentials.access_token;
        if (typeof token !== 'string' || typeof credentials.expiry_date !== 'number' || Date.now() >= credentials.expiry_date - 60000) {
            if (typeof credentials.refresh_token !== 'string') throw new GscError('Google authorization expired. Reconnect Search Console.', 401);
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ refresh_token: credentials.refresh_token, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token' }),
                signal: AbortSignal.timeout(15000),
            });
            const fresh = await response.json();
            if (!response.ok || typeof fresh.access_token !== 'string') throw new GscError('Google authorization expired. Reconnect Search Console.', 401);
            token = fresh.access_token;
            credentials.access_token = token;
            credentials.expiry_date = Date.now() + (fresh.expires_in ?? 3600) * 1000;
            // Persist the refresh without overwriting a concurrently changed property.
            const { error: updateError } = await admin.from('client_integrations').update({ credentials })
                .eq('organization_id', auth.organizationId).eq('client_id', auth.clientId).eq('service', 'gsc')
                .filter('credentials', 'eq', JSON.stringify(row.credentials)).select('id').single();
            if (updateError) throw new GscError('Connection changed while loading. Refresh the property list.', 409);
        }
        return { token: token as string, credentials };
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
        const { error } = await createAdminClient().from('client_integrations').update({
            credentials: { ...credentials, site_url: site.siteUrl, permission_level: site.permissionLevel },
            sync_status: 'active', error_message: null,
            ...(changed ? { last_synced_at: null } : {}),
        }).eq('organization_id', auth.organizationId).eq('client_id', auth.clientId).eq('service', 'gsc')
            .neq('sync_status', 'disconnected').filter('credentials', 'eq', JSON.stringify(credentials)).select('id').single();
        if (error) throw new GscError('Property could not be saved. Refresh the list and try again.', 409);
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
