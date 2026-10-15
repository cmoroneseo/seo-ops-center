import { aggregateGa4, aggregateGsc, chooseProperty, emptyGa4Totals, type Ga4DayMetric, type Ga4Totals, type GscDayMetric, type GscTotals } from './aggregate';
import { authorizeBotToken, clientAllowed, type BotScope, type BotTokenRecord } from './auth';
import { parseBotQuery } from './query';

export type BotRoute = 'ga4' | 'gsc';

export interface BotAuditEvent {
    organizationId: string | null;
    tokenId: string | null;
    tokenPrefix: string | null;
    route: BotRoute;
    clientId: string | null;
    status: number;
    errorCode: string | null;
}

export interface QuotaDecision {
    allowed: boolean;
    inactive?: boolean;
    limit: number;
    remaining: number;
    retryAfterSeconds: number;
}

export interface BotHandlerDeps {
    now: () => Date;
    findToken: (prefix: string) => Promise<BotTokenRecord | null>;
    consumeQuota: (tokenId: string, now: Date) => Promise<QuotaDecision | null>;
    audit: (event: BotAuditEvent) => Promise<void>;
    findClient: (organizationId: string, clientId: string) => Promise<{ id: string } | null>;
    loadGa4: (input: { organizationId: string; clientId: string; start: string; end: string }) => Promise<{ rows: Ga4DayMetric[]; configuredProperty: string | null }>;
    loadGsc: (input: { organizationId: string; clientId: string; start: string; end: string }) => Promise<{ rows: GscDayMetric[]; configuredProperty: string | null }>;
    readLiveGa4: (clientId: string, start: string, end: string) => Promise<LiveMetricResult>;
    readLiveGsc: (clientId: string, start: string, end: string) => Promise<LiveMetricResult>;
}

type LiveMetricResult =
    | { ok: true; property: string; totals: Record<string, number | null> }
    | { ok: false; status: number; error: string; code: string };

const SCOPE: Record<BotRoute, BotScope> = { ga4: 'ga4.read', gsc: 'gsc.read' };

const AUTH_ERROR: Record<string, string> = {
    invalid_token: 'Invalid token',
    expired: 'Token expired',
    revoked: 'Token revoked',
    insufficient_scope: 'Token cannot read this resource',
};

export async function handleBotMetric(route: BotRoute, request: Request, deps: BotHandlerDeps): Promise<Response> {
    const now = deps.now();
    const url = new URL(request.url);
    let decision;
    try {
        const presented = bearerPrefix(request.headers.get('authorization'));
        const record = presented ? await deps.findToken(presented) : null;
        decision = authorizeBotToken({
            authorizationHeader: request.headers.get('authorization'),
            record,
            now,
            scope: SCOPE[route],
        });
    } catch {
        return finish(deps, {
            organizationId: null,
            tokenId: null,
            tokenPrefix: bearerPrefix(request.headers.get('authorization')),
            route,
            clientId: null,
            status: 500,
            errorCode: 'internal',
        }, { error: 'Request failed' });
    }

    if (!decision.ok) {
        return finish(deps, {
            organizationId: decision.organizationId,
            tokenId: decision.tokenId,
            tokenPrefix: decision.prefix,
            route,
            clientId: null,
            status: decision.status,
            errorCode: decision.code,
        }, { error: AUTH_ERROR[decision.code] ?? 'Invalid token' });
    }

    let quota: QuotaDecision | null;
    try {
        quota = await deps.consumeQuota(decision.tokenId, now);
    } catch {
        return finish(deps, auditOf(decision, route, null, 500, 'internal'), { error: 'Request failed' });
    }
    if (!quota || quota.inactive) {
        return finish(deps, auditOf(decision, route, null, 401, 'invalid_token'), { error: 'Invalid token' });
    }
    const rateHeaders = {
        'X-RateLimit-Limit': String(quota.limit),
        'X-RateLimit-Remaining': String(quota.remaining),
    };
    if (!quota.allowed) {
        return finish(deps, auditOf(decision, route, null, 429, 'rate_limited'), {
            error: 'Rate limit exceeded',
            retryAfterSeconds: quota.retryAfterSeconds,
        }, { ...rateHeaders, 'Retry-After': String(quota.retryAfterSeconds) });
    }

    const parsed = parseBotQuery(url, now);
    if (!parsed.ok) {
        return finish(deps, auditOf(decision, route, null, 400, 'invalid_query'), {
            error: 'Invalid query',
            issues: parsed.issues,
        }, rateHeaders);
    }

    const query = parsed.query;
    let client: { id: string } | null;
    try {
        client = await deps.findClient(decision.organizationId, query.clientId);
    } catch {
        return finish(deps, auditOf(decision, route, query.clientId, 500, 'internal'), { error: 'Request failed' }, rateHeaders);
    }
    if (!client) {
        return finish(deps, auditOf(decision, route, null, 404, 'client_not_found'), { error: 'Client not found' }, rateHeaders);
    }
    if (!clientAllowed(decision.clientIds, query.clientId)) {
        return finish(deps, auditOf(decision, route, query.clientId, 403, 'client_not_allowed'), {
            error: 'Client is not allowed for this token',
        }, rateHeaders);
    }

    try {
        if (query.source === 'live') {
            const live = route === 'ga4'
                ? await deps.readLiveGa4(query.clientId, query.start, query.end)
                : await deps.readLiveGsc(query.clientId, query.start, query.end);
            if (!live.ok) {
                return finish(deps, auditOf(decision, route, query.clientId, live.status, live.code), { error: live.error }, rateHeaders);
            }
            return finish(deps, auditOf(decision, route, query.clientId, 200, null), {
                source: 'live',
                granularity: 'range',
                clientId: query.clientId,
                start: query.start,
                end: query.end,
                property: live.property,
                expectedDays: query.expectedDays,
                coverageDays: null,
                incomplete: false,
                totals: live.totals,
            }, rateHeaders);
        }

        if (route === 'ga4') {
            const loaded = await deps.loadGa4({
                organizationId: decision.organizationId,
                clientId: query.clientId,
                start: query.start,
                end: query.end,
            });
            const rolled = aggregateGa4(loaded.rows);
            const property = chooseProperty(rolled.propertyIds, loaded.configuredProperty);
            if (!property.ok) {
                return finish(deps, auditOf(decision, route, query.clientId, 409, 'property_required'), {
                    error: 'More than one GA4 property is stored for this range. Select a property on the client first.',
                }, rateHeaders);
            }
            const rows = property.property ? loaded.rows.filter(row => row.property === property.property) : [];
            const scoped = property.property ? aggregateGa4(rows) : rolled;
            const totals = scoped.coverageDays === 0 ? emptyGa4Totals() : scoped.totals;
            return finish(deps, auditOf(decision, route, query.clientId, 200, null), body('stored', 'day', query, property.property, scoped.coverageDays, totals), rateHeaders);
        }

        const loaded = await deps.loadGsc({
            organizationId: decision.organizationId,
            clientId: query.clientId,
            start: query.start,
            end: query.end,
        });
        const rolled = aggregateGsc(loaded.rows);
        const property = chooseProperty(rolled.propertyIds, loaded.configuredProperty);
        if (!property.ok) {
            return finish(deps, auditOf(decision, route, query.clientId, 409, 'property_required'), {
                error: 'More than one Search Console property is stored for this range. Select a property on the client first.',
            }, rateHeaders);
        }
        const rows = property.property ? loaded.rows.filter(row => row.property === property.property) : [];
        const scoped = aggregateGsc(rows);
        return finish(deps, auditOf(decision, route, query.clientId, 200, null), body('stored', 'day', query, property.property, scoped.coverageDays, scoped.totals), rateHeaders);
    } catch {
        return finish(deps, auditOf(decision, route, query.clientId, 500, 'internal'), { error: 'Request failed' }, rateHeaders);
    }
}

function body(
    source: 'stored',
    granularity: 'day',
    query: { clientId: string; start: string; end: string; expectedDays: number },
    property: string | null,
    coverageDays: number,
    totals: Ga4Totals | GscTotals,
) {
    return {
        source,
        granularity,
        clientId: query.clientId,
        start: query.start,
        end: query.end,
        property,
        expectedDays: query.expectedDays,
        coverageDays,
        incomplete: coverageDays < query.expectedDays,
        totals,
    };
}

function auditOf(
    decision: { tokenId: string; organizationId: string; prefix: string },
    route: BotRoute,
    clientId: string | null,
    status: number,
    errorCode: string | null,
): BotAuditEvent {
    return {
        organizationId: decision.organizationId,
        tokenId: decision.tokenId,
        tokenPrefix: decision.prefix,
        route,
        clientId,
        status,
        errorCode,
    };
}

async function finish(deps: BotHandlerDeps, event: BotAuditEvent, payload: unknown, headers?: Record<string, string>): Promise<Response> {
    try {
        await deps.audit(event);
    } catch {
        return json({ error: 'Request failed' }, 500);
    }
    return json(payload, event.status, headers);
}

function json(payload: unknown, status: number, headers?: Record<string, string>): Response {
    return Response.json(payload, {
        status,
        headers: { 'Cache-Control': 'no-store', ...headers },
    });
}

function bearerPrefix(header: string | null): string | null {
    if (!header) return null;
    const match = /^Bearer\s+(socbot_([A-Za-z0-9_-]{12})_[A-Za-z0-9_-]{43})$/.exec(header.trim());
    return match ? match[2] : null;
}
