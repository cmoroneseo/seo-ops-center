import { createAdminClient } from '../supabase/admin.ts';
import { authenticateBotRequest, verifyBotKey } from './auth.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUERY_PARAMS = new Set(['id', 'name', 'match', 'status', 'limit']);
const CURRENT_STATUSES = ['active', 'onboarding', 'pending', 'paused'];

interface ClientQuery {
    id: string | null;
    name: string;
    match: 'exact' | 'contains';
    status: 'current' | 'all';
    limit: number;
}

interface ClientLookupRow {
    id: string;
    name: string;
    domain: string | null;
    status: string | null;
}

function invalid(error: string) {
    return { ok: false, code: 'invalid_request', error } as const;
}

export function parseBotClientQuery(params: URLSearchParams):
    { ok: true; query: ClientQuery } | ReturnType<typeof invalid> {
    for (const param of params.keys()) {
        if (!QUERY_PARAMS.has(param)) return invalid(`Unknown query parameter: ${param}.`);
        if (params.getAll(param).length > 1) return invalid(`Send ${param} only once.`);
    }

    const id = params.get('id');
    if (id !== null && !UUID.test(id)) return invalid('id must be a UUID.');

    const name = params.get('name')?.trim() ?? '';
    if ((!id || params.has('name')) && (name.length < 2 || name.length > 200 || name.includes('\0'))) {
        return invalid('Send a name of 2 to 200 characters or a client id.');
    }

    const match = params.get('match') ?? 'exact';
    if (match !== 'exact' && match !== 'contains') return invalid('match must be exact or contains.');

    const status = params.get('status') ?? 'current';
    if (status !== 'current' && status !== 'all') return invalid('status must be current or all.');

    const rawLimit = params.get('limit') ?? '10';
    const limit = Number(rawLimit);
    if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 25) return invalid('limit must be an integer from 1 to 25.');

    return { ok: true, query: { id, name, match, status, limit } };
}

export async function handleBotClientLookup(
    request: Request,
    admin = createAdminClient,
): Promise<Response> {
    const auth = await authenticateBotRequest(request, token => verifyBotKey(token, admin));
    if ('response' in auth) return auth.response;

    const parsed = parseBotClientQuery(new URL(request.url).searchParams);
    if (!parsed.ok) return Response.json({ error: parsed.error, code: parsed.code }, { status: 400 });
    const { id, name, match, status, limit } = parsed.query;

    let query = admin().from('clients')
        .select('id, name, domain, status')
        .eq('organization_id', auth.key.organizationId)
        .order('name')
        .limit(limit + 1);
    if (status === 'current') query = query.in('status', CURRENT_STATUSES);
    if (id) {
        query = query.eq('id', id);
    } else if (name.includes('*')) {
        // PostgREST rewrites asterisks in ILIKE patterns to percent wildcards.
        const literal = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        query = query.filter('name', 'imatch', match === 'exact' ? `^${literal}$` : literal);
    } else {
        const literal = name.replace(/[\\%_]/g, '\\$&');
        query = query.ilike('name', match === 'exact' ? literal : `%${literal}%`);
    }

    const { data, error } = await query;
    if (error) {
        return Response.json({ error: 'Clients could not be read.', code: 'client_lookup_failed' }, { status: 500 });
    }
    const rows: ClientLookupRow[] = data ?? [];
    const clients = rows.slice(0, limit).map(row => ({
        id: row.id,
        name: row.name,
        website: row.domain,
        status: row.status,
        active: row.status !== null && CURRENT_STATUSES.includes(row.status),
    }));
    return Response.json({ clients, truncated: rows.length > limit }, { headers: { 'Cache-Control': 'no-store' } });
}
