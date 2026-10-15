import { createAdminClient } from '@/lib/supabase/admin';
import { getGoogleAccessToken } from '@/lib/sync/token';
import type { Ga4DayMetric, GscDayMetric } from './aggregate';
import type { BotTokenRecord } from './auth';
import { handleBotMetric, type BotHandlerDeps, type BotRoute, type QuotaDecision } from './http';
import { readLiveGa4, readLiveGsc } from './live';

const GA4_PROPERTY = /^properties\/[0-9]+$/;

export function handleBotGa4(request: Request): Promise<Response> {
    return handleBotMetric('ga4', request, productionBotDeps());
}

export function handleBotGsc(request: Request): Promise<Response> {
    return handleBotMetric('gsc', request, productionBotDeps());
}

function productionBotDeps(): BotHandlerDeps {
    const admin = createAdminClient();
    return {
        now: () => new Date(),
        async findToken(prefix) {
            const { data, error } = await admin
                .from('bot_tokens')
                .select('id, organization_id, token_hash, scopes, client_ids, expires_at, revoked_at, rate_limit_per_minute')
                .eq('token_prefix', prefix)
                .maybeSingle();
            if (error) throw new Error('Unable to read bot token');
            if (!data) return null;
            return {
                id: String(data.id),
                organizationId: String(data.organization_id),
                tokenHash: String(data.token_hash),
                scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope: unknown): scope is string => typeof scope === 'string') : [],
                clientIds: Array.isArray(data.client_ids) ? data.client_ids.filter((id: unknown): id is string => typeof id === 'string') : [],
                expiresAt: typeof data.expires_at === 'string' ? data.expires_at : null,
                revokedAt: typeof data.revoked_at === 'string' ? data.revoked_at : null,
                rateLimitPerMinute: Number(data.rate_limit_per_minute),
            } satisfies BotTokenRecord;
        },
        async consumeQuota(tokenId, now) {
            const { data, error } = await admin.rpc('consume_bot_token_quota', {
                p_token_id: tokenId,
                p_now: now.toISOString(),
            });
            if (error) throw new Error('Unable to consume bot quota');
            return readQuota(data);
        },
        async audit(event) {
            const { error } = await admin.from('bot_api_audit').insert({
                organization_id: event.organizationId,
                token_id: event.tokenId,
                token_prefix: event.tokenPrefix,
                route: event.route,
                client_id: event.clientId,
                status: event.status,
                error_code: event.errorCode,
            });
            if (error) throw new Error('Unable to write bot audit');
        },
        async findClient(organizationId, clientId) {
            const { data, error } = await admin
                .from('clients')
                .select('id')
                .eq('id', clientId)
                .eq('organization_id', organizationId)
                .maybeSingle();
            if (error) throw new Error('Unable to read client');
            return data?.id ? { id: String(data.id) } : null;
        },
        loadGa4: (input) => loadGa4(admin, input),
        loadGsc: (input) => loadGsc(admin, input),
        async readLiveGa4(clientId, start, end) {
            return readLiveGa4(clientId, start, end, {
                fetch,
                getToken: (id, service) => getGoogleAccessToken(id, service),
            });
        },
        async readLiveGsc(clientId, start, end) {
            return readLiveGsc(clientId, start, end, {
                fetch,
                getToken: (id, service) => getGoogleAccessToken(id, service),
            });
        },
    };
}

async function loadGa4(
    admin: ReturnType<typeof createAdminClient>,
    input: { organizationId: string; clientId: string; start: string; end: string },
): Promise<{ rows: Ga4DayMetric[]; configuredProperty: string | null }> {
    const configuredProperty = await configuredText(admin, input, 'ga4', 'property_id');
    const { data: days, error } = await admin
        .from('ga4_history_days')
        .select('id, property, day')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .gte('day', input.start)
        .lte('day', input.end)
        .order('day')
        .limit(500);
    if (error) throw new Error('Unable to read GA4 history');
    const dayRows = days ?? [];
    const ids = dayRows.map(day => String(day.id));
    const metrics = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
        const { data, error: metricError } = await admin
            .from('ga4_daily')
            .select('day_id, organic_sessions, sessions, engaged_sessions, key_events')
            .in('day_id', ids);
        if (metricError) throw new Error('Unable to read GA4 history');
        for (const row of data ?? []) metrics.set(String(row.day_id), row as Record<string, unknown>);
    }
    return {
        configuredProperty: configuredProperty && GA4_PROPERTY.test(configuredProperty) ? configuredProperty : null,
        rows: dayRows.map(day => {
            const metric = metrics.get(String(day.id));
            return {
                day: String(day.day),
                property: String(day.property),
                organicSessions: num(metric?.organic_sessions),
                sessions: num(metric?.sessions),
                engagedSessions: num(metric?.engaged_sessions),
                keyEvents: num(metric?.key_events),
            };
        }),
    };
}

async function loadGsc(
    admin: ReturnType<typeof createAdminClient>,
    input: { organizationId: string; clientId: string; start: string; end: string },
): Promise<{ rows: GscDayMetric[]; configuredProperty: string | null }> {
    const configuredProperty = await configuredText(admin, input, 'gsc', 'site_url');
    const { data: days, error } = await admin
        .from('gsc_history_days')
        .select('id, property, data_date')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .gte('data_date', input.start)
        .lte('data_date', input.end)
        .order('data_date')
        .limit(500);
    if (error) throw new Error('Unable to read Search Console history');
    const dayRows = days ?? [];
    const ids = dayRows.map(day => String(day.id));
    const facts = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
        const { data, error: factError } = await admin
            .from('gsc_history_facts')
            .select('day_id, clicks, impressions, position')
            .eq('grain', 'property')
            .in('day_id', ids);
        if (factError) throw new Error('Unable to read Search Console history');
        for (const row of data ?? []) facts.set(String(row.day_id), row as Record<string, unknown>);
    }
    const rows: GscDayMetric[] = [];
    for (const day of dayRows) {
        const fact = facts.get(String(day.id));
        if (!fact) continue;
        const clicks = num(fact.clicks);
        const impressions = num(fact.impressions);
        const position = num(fact.position);
        if (clicks == null || impressions == null || position == null) continue;
        rows.push({
            day: String(day.data_date),
            property: String(day.property),
            clicks,
            impressions,
            position,
        });
    }
    return {
        configuredProperty: configuredProperty && configuredProperty.length > 0 && configuredProperty.length <= 500 ? configuredProperty : null,
        rows,
    };
}

async function configuredText(
    admin: ReturnType<typeof createAdminClient>,
    input: { organizationId: string; clientId: string },
    service: 'ga4' | 'gsc',
    field: 'property_id' | 'site_url',
): Promise<string | null> {
    const column = field === 'property_id' ? 'property_id:credentials->>property_id' : 'site_url:credentials->>site_url';
    const { data, error } = await admin
        .from('client_integrations')
        .select(column)
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('service', service)
        .in('sync_status', ['active', 'error', 'pending_setup'])
        .maybeSingle();
    if (error || !data) return null;
    const value = (data as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
}

function readQuota(value: unknown): QuotaDecision | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const limit = num(row.limit);
    const remaining = num(row.remaining);
    const retry = num(row.retry_after_seconds);
    if (typeof row.allowed !== 'boolean' || limit == null || remaining == null || retry == null) return null;
    return {
        allowed: row.allowed,
        inactive: row.inactive === true,
        limit,
        remaining,
        retryAfterSeconds: retry,
    };
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
}

export type { BotRoute };
