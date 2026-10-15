import { NextRequest, NextResponse } from 'next/server';
import { Ga4KeyEventsError, isGa4EventName, readGa4KeyEvents, resolveGa4KeyEvents } from '@/lib/ga4/key-events';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';

export const dynamic = 'force-dynamic';

async function authorized(req: NextRequest, clientId: unknown, orgId: unknown) {
    const authorization = await requireClientIntegrationManager(
        typeof clientId === 'string' ? clientId : null,
        typeof orgId === 'string' ? orgId : null,
    );
    if (!authorization.ok) return { ok: false as const, response: NextResponse.json({ error: authorization.error }, { status: authorization.status }) };
    return { ok: true as const, authorization };
}

async function propertyToken(clientId: string) {
    try {
        const auth = await getGoogleAccessToken(clientId, 'ga4');
        if (!auth) return { error: NextResponse.json({ error: 'Reconnect to add Analytics' }, { status: 404 }) };
        const propertyId = auth.creds.property_id;
        if (typeof propertyId !== 'string' || !/^properties\/[0-9]+$/.test(propertyId)) {
            return { error: NextResponse.json({ error: 'Select a GA4 property' }, { status: 409 }) };
        }
        return { token: auth.token, propertyId };
    } catch (error) {
        if (error instanceof GoogleAuthError && error.kind === 'reauth_required') {
            return { error: NextResponse.json({ error: 'Reconnect to add Analytics' }, { status: 401 }) };
        }
        return { error: NextResponse.json({ error: 'Unable to list Analytics key events. Reconnect to add Analytics.' }, { status: 502 }) };
    }
}

export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const gate = await authorized(req, clientId, req.nextUrl.searchParams.get('orgId'));
    if (!gate.ok) return gate.response;
    const access = await propertyToken(gate.authorization.clientId);
    if ('error' in access) return access.error;
    try {
        const events = await readGa4KeyEvents(access.token, access.propertyId);
        const admin = createAdminClient();
        const settings = await admin.from('client_ga4_settings')
            .select('ga4_key_events')
            .eq('organization_id', gate.authorization.organizationId)
            .eq('client_id', gate.authorization.clientId)
            .maybeSingle();
        const stored = settings.error ? null : settings.data?.ga4_key_events;
        const override = Array.isArray(stored) && stored.every(name => typeof name === 'string') ? stored : null;
        return NextResponse.json({ events, override, usingAll: override == null });
    } catch (error) {
        if (error instanceof Ga4KeyEventsError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('GA4 keyEvents request failed', { status: 0 });
        return NextResponse.json({ error: 'Unable to list Analytics key events. Reconnect to add Analytics.' }, { status: 502 });
    }
}

export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const record = body as { clientId?: unknown; orgId?: unknown; keyEvents?: unknown };
    const gate = await authorized(req, record.clientId, record.orgId);
    if (!gate.ok) return gate.response;
    if (record.keyEvents != null && (!Array.isArray(record.keyEvents) || record.keyEvents.some(name => typeof name !== 'string' || !isGa4EventName(name)))) {
        return NextResponse.json({ error: 'Choose key events from this property' }, { status: 400 });
    }
    const access = await propertyToken(gate.authorization.clientId);
    if ('error' in access) return access.error;
    try {
        const events = await readGa4KeyEvents(access.token, access.propertyId);
        const requested = record.keyEvents == null ? null : record.keyEvents.filter((name): name is string => typeof name === 'string');
        const resolved = resolveGa4KeyEvents(events.map(event => event.eventName), requested);
        const stored = requested == null ? null : (resolved ?? []);
        const admin = createAdminClient();
        const { error } = await admin.from('client_ga4_settings').upsert({
            client_id: gate.authorization.clientId,
            organization_id: gate.authorization.organizationId,
            ga4_key_events: stored,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' });
        if (error) return NextResponse.json({ error: 'Unable to save key events' }, { status: 500 });
        return NextResponse.json({ override: stored, usingAll: stored == null });
    } catch (error) {
        if (error instanceof Ga4KeyEventsError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error('GA4 keyEvents request failed', { status: 0 });
        return NextResponse.json({ error: 'Unable to save key events' }, { status: 502 });
    }
}
