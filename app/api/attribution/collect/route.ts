import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveSessionAttribution } from '@/lib/attribution/source-classifier';
import { matchesSiteDomain } from '@/lib/attribution/domain';
import { makeVisitorId } from '@/lib/attribution/visitor-id';
import { insertEvents } from '@/lib/supabase/attribution-admin';
import type { AttributionEvent, AttributionEventType } from '@/lib/types';
import { createHmac } from 'crypto';

export const maxDuration = 30;

const MAX_BODY_BYTES = 128 * 1024;
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS_HEADERS });
const EVENT_TYPES: readonly AttributionEventType[] = ['pageview', 'form_submit', 'tel_click'];
const TEXT_FIELDS = ['client_event_id', 'page_url', 'landing_page', 'referrer', 'session_id', 'session_source', 'hdyhau_value',
    'utm_source', 'utm_medium', 'utm_campaign', 'initial_referrer', 'initial_utm_source',
    'initial_utm_medium', 'initial_utm_campaign', 'device_type'];

export async function POST(req: NextRequest) {
    try {
        const declaredLength = Number(req.headers.get('content-length') ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
        const rawBody = await req.text();
        if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return json({ error: 'payload_too_large' }, 413);
        let body;
        try { body = JSON.parse(rawBody); } catch { return json({ error: 'invalid_payload' }, 400); }
        const { site_id, events } = body ?? {};
        if (typeof site_id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(site_id) ||
            !Array.isArray(events) || events.length === 0 || events.length > 50 ||
            events.some(evt => !evt || typeof evt !== 'object' || !EVENT_TYPES.includes(evt.event_type) ||
                typeof evt.client_event_id !== 'string' || !/^[a-zA-Z0-9._:-]{8,128}$/.test(evt.client_event_id) ||
                TEXT_FIELDS.some(key => evt[key] != null && (typeof evt[key] !== 'string' || evt[key].length > 2048)))) {
            return json({ error: 'invalid_payload' }, 400);
        }

        const admin = createAdminClient();
        const { data: site, error: siteError } = await admin
            .from('attribution_sites')
            .select('id, organization_id, client_id, domain, is_active')
            .eq('id', site_id)
            .maybeSingle();

        if (siteError) throw siteError;
        if (!site || !site.is_active) {
            return json({ error: 'invalid_site' }, 404);
        }

        const { data: enabled, error: enabledError } = await admin
            .from('attribution_enabled_organizations')
            .select('organization_id')
            .eq('organization_id', site.organization_id)
            .maybeSingle();
        if (enabledError) throw enabledError;
        if (!enabled) return json({ error: 'invalid_site' }, 404);

        const origin = req.headers.get('origin') || req.headers.get('referer') || '';
        const originUrl = (() => {
            try { return new URL(origin); } catch { return null; }
        })();
        if (!originUrl || !['http:', 'https:'].includes(originUrl.protocol) || !matchesSiteDomain(originUrl.hostname, site.domain)) {
            return json({ error: 'domain_mismatch' }, 403);
        }

        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
        const hashSecret = process.env.ATTRIBUTION_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!hashSecret) throw new Error('Missing attribution hash secret');
        const bucketKey = createHmac('sha256', hashSecret).update(`${site.id}:${ip}`).digest('hex').slice(0, 32);
        const { data: allowed, error: rateError } = await admin.rpc('check_attribution_rate_limit', {
            p_site_id: site.id,
            p_bucket_key: bucketKey,
            p_event_count: events.length,
        });
        if (rateError) throw rateError;
        if (!allowed) return json({ error: 'rate_limited' }, 429);

        const pageUrl = (raw: unknown) => {
            const url = new URL(typeof raw === 'string' && raw ? raw : '/', originUrl.origin);
            if (!['http:', 'https:'].includes(url.protocol) || !matchesSiteDomain(url.hostname, site.domain) || url.username || url.password) {
                throw new Error('invalid_page');
            }
            return url.origin + url.pathname;
        };

        const ua = req.headers.get('user-agent') ?? '';
        const visitorId = makeVisitorId(ip, ua, site.id, hashSecret);
        const countryCode = req.headers.get('x-vercel-ip-country') ?? undefined;

        const eventRows: Omit<AttributionEvent, 'id' | 'createdAt'>[] = [];

        for (const evt of events) {
            const attribution = resolveSessionAttribution(evt, site.domain);
            let landingPage, currentPage;
            try {
                landingPage = pageUrl(evt.landing_page ?? evt.page_url);
                currentPage = pageUrl(evt.page_url);
            } catch { return json({ error: 'invalid_page' }, 400); }

            const row: Omit<AttributionEvent, 'id' | 'createdAt'> = {
                clientEventId: evt.client_event_id,
                organizationId: site.organization_id,
                siteId: site.id,
                siteDomain: site.domain,
                eventType: evt?.event_type,
                sessionId: evt?.session_id ?? visitorId,
                visitorId,
                sourceCategory: attribution.sourceCategory,
                referrerDomain: (() => { try { return new URL(attribution.referrer).hostname; } catch { return undefined; } })(),
                landingPage,
                pageUrl: currentPage,
                hdyhauResponse: evt?.hdyhau_value ?? undefined,
                utmSource: attribution.utmSource || undefined,
                utmMedium: attribution.utmMedium || undefined,
                utmCampaign: attribution.utmCampaign || undefined,
                countryCode,
                deviceType: evt?.device_type ?? undefined,
            };

            eventRows.push(row);

        }

        // The event trigger materializes conversions from these exact rows in
        // the same transaction. There is no visitor/time-based event lookup.
        await insertEvents(eventRows);

        return json({ ok: true });
    } catch {
        console.error('[attribution/collect] request failed');
        return json({ error: 'server_error' }, 500);
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            ...CORS_HEADERS,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
