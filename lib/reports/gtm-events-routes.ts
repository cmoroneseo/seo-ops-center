import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireReportAccess } from './access';
import { getReport } from './reportStore';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';
import {
    DEFAULT_GTM_REPORT_SETTINGS,
    parseGtmReportSettings,
    type GtmReportSettings,
} from './gtm-events';
import { collectGtmEvents, GtmEventsFetchError, type GtmConnection } from './gtm-events-fetch';

type Denied = { ok: false; status: number; error: string };

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function missingTable(error: { code?: string } | null): boolean {
    return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function readGtmReportSettings(organizationId: string, clientId: string): Promise<GtmReportSettings> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('client_gtm_report_settings')
        .select('excluded_link_texts, fallback_event_names, outbound_event_name, booking_event_name, ticket_event_name')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error) {
        if (missingTable(error)) return DEFAULT_GTM_REPORT_SETTINGS;
        throw new Error('Could not load event report settings.');
    }
    if (!data) return DEFAULT_GTM_REPORT_SETTINGS;
    const parsed = parseGtmReportSettings(data);
    return parsed.ok ? parsed.settings : DEFAULT_GTM_REPORT_SETTINGS;
}

export async function saveGtmReportSettings(organizationId: string, clientId: string, settings: GtmReportSettings): Promise<Denied | { ok: true }> {
    const admin = createAdminClient();
    const { error } = await admin.from('client_gtm_report_settings').upsert({
        organization_id: organizationId,
        client_id: clientId,
        excluded_link_texts: settings.excludedLinkTexts,
        fallback_event_names: settings.fallbackEventNames,
        outbound_event_name: settings.outboundEventName,
        booking_event_name: settings.bookingEventName,
        ticket_event_name: settings.ticketEventName,
        updated_at: new Date().toISOString(),
    }, { onConflict: 'client_id' });
    if (error) {
        if (missingTable(error)) return { ok: false, status: 503, error: 'Apply migration 121 before saving event report settings.' };
        return { ok: false, status: 500, error: 'Could not save event report settings.' };
    }
    return { ok: true };
}

async function ga4Connection(clientId: string): Promise<{ token: string; propertyId: string } | null> {
    const auth = await getGoogleAccessToken(clientId, 'ga4');
    if (!auth) return null;
    const propertyId = auth.creds.property_id;
    if (typeof propertyId !== 'string' || !propertyId.trim()) return null;
    return { token: auth.token, propertyId };
}

async function gtmConnection(clientId: string): Promise<GtmConnection | null> {
    const auth = await getGoogleAccessToken(clientId, 'gtm');
    if (!auth) return null;
    const accountId = auth.creds.account_id;
    const containerId = auth.creds.container_id;
    if (typeof accountId !== 'string' || typeof containerId !== 'string') return null;
    return { token: auth.token, accountId, containerId };
}

export async function refreshGtmEventsReport(reportId: string): Promise<Response> {
    const access = await requireReportAccess(reportId, 'write', {
        getReport,
        requireOrganizationMember,
    });
    if (!access.ok) return json({ error: access.error }, access.status);
    if (!access.report.client_id) return json({ error: 'Assign a client before loading events.' }, 409);

    const admin = createAdminClient();
    const client = await admin.from('clients').select('name').eq('id', access.report.client_id).eq('organization_id', access.report.organization_id).maybeSingle();
    if (client.error || !client.data) return json({ error: 'Could not load this client.' }, 404);

    let ga4;
    try {
        ga4 = await ga4Connection(access.report.client_id);
    } catch (error) {
        if (error instanceof GoogleAuthError) return json({ error: 'Reconnect Google Analytics, then load events again.' }, 401);
        throw error;
    }
    if (!ga4) return json({ error: 'Connect Google Analytics and choose a property for this client.' }, 409);

    let gtm: GtmConnection | null = null;
    try {
        gtm = await gtmConnection(access.report.client_id);
    } catch (error) {
        if (!(error instanceof GoogleAuthError)) throw error;
        gtm = null;
    }

    const settings = await readGtmReportSettings(access.report.organization_id, access.report.client_id);
    try {
        const result = await collectGtmEvents({
            ga4Token: ga4.token,
            propertyId: ga4.propertyId,
            gtm,
            settings,
            clientName: String(client.data.name || 'Client'),
            reportMonth: access.report.report_month,
        });
        return json(result);
    } catch (error) {
        if (error instanceof GtmEventsFetchError) return json({ error: error.message }, error.status);
        return json({ error: 'Could not read Analytics for this property.' }, 502);
    }
}
