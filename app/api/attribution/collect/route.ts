import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { classifySource } from '@/lib/attribution/source-classifier';
import { insertEvents, insertConversion } from '@/lib/supabase/attribution';
import type { AttributionEvent, AttributionEventType, ConversionType, SourceCategory } from '@/lib/types';
import { createHash } from 'crypto';

export const maxDuration = 30;

const RATE_LIMIT = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = RATE_LIMIT.get(ip);
    if (!entry || now > entry.resetAt) {
        RATE_LIMIT.set(ip, { count: 1, resetAt: now + 60_000 });
        return false;
    }
    entry.count++;
    return entry.count > 100;
}

function makeVisitorId(ip: string, ua: string): string {
    const salt = new Date().toISOString().slice(0, 10);
    return createHash('sha256').update(`${ip}:${ua}:${salt}`).digest('hex').slice(0, 16);
}

export async function POST(req: NextRequest) {
    try {
        const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
        if (isRateLimited(ip)) {
            return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
        }

        const body = await req.json();
        const { site_id, events } = body ?? {};
        if (!site_id || !Array.isArray(events) || events.length === 0 || events.length > 50) {
            return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
        }

        const admin = createAdminClient();
        const { data: site } = await admin
            .from('attribution_sites')
            .select('id, organization_id, client_id, domain, is_active')
            .eq('id', site_id)
            .single();

        if (!site || !site.is_active) {
            return NextResponse.json({ error: 'invalid_site' }, { status: 404 });
        }

        const origin = req.headers.get('origin') || req.headers.get('referer') || '';
        const originDomain = (() => {
            try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return ''; }
        })();
        const siteDomain = site.domain.replace(/^www\./, '');
        if (originDomain && originDomain !== siteDomain && !originDomain.endsWith('.' + siteDomain)) {
            return NextResponse.json({ error: 'domain_mismatch' }, { status: 403 });
        }

        const ua = req.headers.get('user-agent') ?? '';
        const visitorId = makeVisitorId(ip, ua);
        const countryCode = req.headers.get('x-vercel-ip-country') ?? undefined;

        const eventRows: Omit<AttributionEvent, 'id' | 'createdAt'>[] = [];
        const conversionEventTypes: AttributionEventType[] = [];

        for (const evt of events) {
            const sourceCategory: SourceCategory = classifySource(evt?.referrer ?? '', evt?.utm_medium ?? null, site.domain);
            const resolvedSourceCategory: SourceCategory =
                sourceCategory === 'same_site' ? (evt?.session_source ?? 'direct') : sourceCategory;

            const row: Omit<AttributionEvent, 'id' | 'createdAt'> = {
                organizationId: site.organization_id,
                siteId: site.id,
                eventType: evt?.event_type,
                sessionId: evt?.session_id ?? visitorId,
                visitorId,
                sourceCategory: resolvedSourceCategory,
                referrerDomain: (() => { try { return new URL(evt?.referrer).hostname; } catch { return undefined; } })(),
                landingPage: evt?.landing_page ?? evt?.page_url ?? '',
                pageUrl: evt?.page_url ?? '',
                hdyhauResponse: evt?.hdyhau_value ?? undefined,
                utmSource: evt?.utm_source ?? undefined,
                utmMedium: evt?.utm_medium ?? undefined,
                utmCampaign: evt?.utm_campaign ?? undefined,
                countryCode,
                deviceType: evt?.device_type ?? undefined,
            };

            eventRows.push(row);

            if (evt?.event_type === 'form_submit' || evt?.event_type === 'tel_click') {
                conversionEventTypes.push(evt.event_type);
            }
        }

        await insertEvents(eventRows);

        if (conversionEventTypes.length > 0) {
            const { data: insertedEvents } = await admin
                .from('attribution_events')
                .select('id, event_type, page_url, landing_page, source_category, hdyhau_response')
                .eq('site_id', site.id)
                .in('event_type', ['form_submit', 'tel_click'])
                .eq('visitor_id', visitorId)
                .order('created_at', { ascending: false })
                .limit(conversionEventTypes.length);

            const month = new Date().toISOString().slice(0, 7);
            for (const evt of insertedEvents ?? []) {
                const conversionType: ConversionType = evt.event_type === 'form_submit' ? 'form' : 'phone';
                await insertConversion({
                    organizationId: site.organization_id,
                    siteId: site.id,
                    clientId: site.client_id,
                    eventId: evt.id,
                    conversionType,
                    sourceCategory: evt.source_category,
                    landingPage: evt.landing_page ?? '',
                    pageUrl: evt.page_url ?? '',
                    hdyhauResponse: evt.hdyhau_response ?? undefined,
                    month,
                });
            }
        }

        return NextResponse.json({ ok: true }, {
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[attribution/collect]', message);
        return NextResponse.json({ error: 'server_error' }, { status: 500 });
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}
