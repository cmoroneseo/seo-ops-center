import { createAdminClient } from './admin';
import { rankQueries, type GscFact } from '../attribution/query-matcher';
import { matchesSiteDomain, pageBelongsToProperty } from '../attribution/domain';
import { isSourceCategory } from '../attribution/source-classifier';
import type { AttributionConversion, AttributionEvent, LikelyQuery } from '../types';

const PAGE_SIZE = 1000;
type PageResult<T> = { data: T[] | null; error: unknown };

async function readAllById<T extends { id: string | number }>(
    fetchPage: (after?: string | number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
    const rows: T[] = [];
    let after: string | number | undefined;
    while (true) {
        const { data, error } = await fetchPage(after);
        if (error) throw error;
        if (!data?.length) return rows;
        const lastId = data[data.length - 1].id;
        if (lastId === after) throw new Error('Attribution pagination did not advance');
        rows.push(...data);
        after = lastId;
    }
}

function eventToRow(event: Omit<AttributionEvent, 'id' | 'createdAt'>) {
    if (!isSourceCategory(event.sourceCategory)) throw new Error('Invalid attribution source');
    return {
        client_event_id: event.clientEventId,
        organization_id: event.organizationId,
        site_id: event.siteId,
        site_domain: event.siteDomain,
        event_type: event.eventType,
        session_id: event.sessionId,
        visitor_id: event.visitorId,
        source_category: event.sourceCategory,
        referrer_domain: event.referrerDomain,
        landing_page: event.landingPage,
        page_url: event.pageUrl,
        hdyhau_response: event.hdyhauResponse,
        utm_source: event.utmSource,
        utm_medium: event.utmMedium,
        utm_campaign: event.utmCampaign,
        country_code: event.countryCode,
        device_type: event.deviceType,
    };
}

function conversionToRow(
    conversion: Omit<AttributionConversion, 'id' | 'createdAt' | 'likelyQueries'> & { likelyQueries?: LikelyQuery[] },
) {
    if (!isSourceCategory(conversion.sourceCategory)) throw new Error('Invalid attribution source');
    return {
        organization_id: conversion.organizationId,
        site_id: conversion.siteId,
        client_id: conversion.clientId,
        event_id: conversion.eventId,
        conversion_type: conversion.conversionType,
        source_category: conversion.sourceCategory,
        landing_page: conversion.landingPage,
        page_url: conversion.pageUrl,
        likely_queries: conversion.likelyQueries ?? null,
        hdyhau_response: conversion.hdyhauResponse,
        month: conversion.month.length === 7 ? conversion.month + '-01' : conversion.month,
    };
}

export async function insertEvents(rows: Omit<AttributionEvent, 'id' | 'createdAt'>[]): Promise<void> {
    if (rows.length === 0) return;
    const admin = createAdminClient();
    const { error } = await admin.from('attribution_events').upsert(rows.map(eventToRow), {
        onConflict: 'site_id,client_event_id',
        ignoreDuplicates: true,
    });
    if (error) throw error;
}

export async function insertConversion(
    row: Omit<AttributionConversion, 'id' | 'createdAt' | 'likelyQueries'> & { likelyQueries?: LikelyQuery[] },
): Promise<string> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('attribution_conversions').insert(conversionToRow(row)).select('id').single();
    if (error) throw error;
    return data.id;
}

export interface ConversionQueryScope { organizationId: string; siteId: string; clientId: string }

export async function getConversionsMissingQueries(
    lookbackDays = 7,
): Promise<(ConversionQueryScope & { id: string; landingPage: string; month: string })[]> {
    const admin = createAdminClient();
    const { data: enabledOrganizations, error: enabledError } = await admin
        .from('attribution_enabled_organizations')
        .select('organization_id');
    if (enabledError) throw enabledError;
    const enabledIds = (enabledOrganizations ?? []).map(row => row.organization_id);
    if (enabledIds.length === 0) return [];
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const data = await readAllById<any>(after => {
        let query = admin.from('attribution_conversions')
            .select('id, organization_id, site_id, client_id, landing_page, month')
            .eq('source_category', 'organic_google')
            .in('organization_id', enabledIds)
            .is('likely_queries', null).gte('created_at', since).order('id').limit(PAGE_SIZE);
        if (after !== undefined) query = query.gt('id', after);
        return query;
    });
    return data.map(row => ({
        id: row.id,
        organizationId: row.organization_id,
        siteId: row.site_id,
        clientId: row.client_id,
        landingPage: row.landing_page,
        month: row.month,
    }));
}

export async function updateConversionQueries(id: string, queries: LikelyQuery[], scope?: ConversionQueryScope): Promise<void> {
    const admin = createAdminClient();
    let update = admin.from('attribution_conversions').update({ likely_queries: queries })
        .eq('id', id).is('likely_queries', null);
    if (scope) update = update.eq('organization_id', scope.organizationId).eq('site_id', scope.siteId).eq('client_id', scope.clientId);
    const { error } = await update;
    if (error) throw error;
}

export async function deleteOldPageviews(retentionDays = 90): Promise<number> {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const { data, error } = await admin.from('attribution_events').delete()
        .eq('event_type', 'pageview').lt('created_at', cutoff).select('id');
    if (error) throw error;
    return data?.length ?? 0;
}

export async function deleteOldAttributionRateLimits(retentionHours = 24): Promise<number> {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - retentionHours * 3600000).toISOString();
    const { data, error } = await admin.from('attribution_rate_limits').delete()
        .lt('window_start', cutoff).select('site_id');
    if (error) throw error;
    return data?.length ?? 0;
}

export async function matchQueries(
    clientId: string,
    landingPage: string,
    month: string,
    scope?: Pick<ConversionQueryScope, 'organizationId' | 'siteId'>,
): Promise<LikelyQuery[]> {
    const admin = createAdminClient();
    let siteQuery = admin.from('attribution_sites').select('id, organization_id, client_id, domain').eq('client_id', clientId);
    if (scope) siteQuery = siteQuery.eq('id', scope.siteId).eq('organization_id', scope.organizationId);
    const { data: site, error: siteError } = await siteQuery.maybeSingle();
    if (siteError) throw siteError;
    if (!site) return [];

    const { data: client, error: clientError } = await admin.from('clients').select('id')
        .eq('id', clientId).eq('organization_id', site.organization_id).maybeSingle();
    if (clientError) throw clientError;
    if (!client) throw new Error('Attribution client organization mismatch');

    const { data: integration, error: integrationError } = await admin.from('client_integrations')
        .select('property:credentials->>site_url').eq('client_id', clientId).eq('organization_id', site.organization_id)
        .eq('service', 'gsc').in('sync_status', ['active', 'error']).maybeSingle();
    if (integrationError) throw integrationError;
    const property = integration?.property;
    if (typeof property !== 'string') return [];
    let target: URL;
    try { target = new URL(landingPage, `https://${site.domain}`); } catch { return []; }
    if (!matchesSiteDomain(target.hostname, site.domain) || !pageBelongsToProperty(target.href, property)) return [];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid attribution month');
    const monthStart = `${month}-01`;
    const [year, mon] = month.split('-').map(Number);
    const monthEnd = new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);

    const { data: days, error: daysError } = await admin.from('gsc_history_days').select('id')
        .eq('organization_id', site.organization_id).eq('client_id', clientId).eq('property', property)
        .eq('search_type', 'web').gte('data_date', monthStart).lt('data_date', monthEnd);
    if (daysError) throw daysError;
    if (!days || days.length === 0) return [];

    const dayIds = days.map((day: any) => day.id);
    const factRows = await readAllById<any>(after => {
        let query = admin.from('gsc_history_facts').select('id, page, query, clicks, impressions')
            .in('day_id', dayIds).eq('grain', 'query_page').order('id').limit(PAGE_SIZE);
        if (after !== undefined) query = query.gt('id', after);
        return query;
    });
    const facts: GscFact[] = factRows.filter(fact => pageBelongsToProperty(fact.page, property)).map(fact => ({
        page: fact.page,
        query: fact.query,
        clicks: Number(fact.clicks),
        impressions: Number(fact.impressions),
    }));
    return rankQueries(facts, target.href);
}
