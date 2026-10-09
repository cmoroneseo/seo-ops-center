import { createAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/reports/access';

const HOST = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i;

type ClientAuth =
    | { ok: true; userId: string; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
    | { ok: false; status: number; error: string };

type Query = {
    select: (columns: string) => Query;
    eq: (column: string, value: string) => Query;
    maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
};

export interface KeywordResearchDeps {
    requireClientOrgMember: (clientId: unknown) => Promise<ClientAuth>;
    loadKey: (clientId: string, organizationId: string) => Promise<string | null>;
    loadTarget: (clientId: string, organizationId: string) => Promise<{ domain: string | null; siteUrl: string | null }>;
    fetch: typeof fetch;
}

export function normalizeCompetitorHost(value: string): string | null {
    const stripped = value.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/?#]/)[0].replace(/\.$/, '');
    if (!HOST.test(stripped)) return null;
    return stripped.toLowerCase();
}

export function keywordTarget(domain: string | null, siteUrl: string | null): string | null {
    const raw = (domain && domain.trim()) || (siteUrl && siteUrl.trim()) || '';
    if (!raw) return null;
    const cleaned = raw.replace(/^sc-domain:/i, '').replace(/^https?:\/\//i, '').split('/')[0].trim();
    return cleaned || null;
}

export async function loadKeywordResearchKey(
    clientId: string,
    organizationId: string,
    admin: { from: (table: string) => Query } = createAdminClient() as unknown as { from: (table: string) => Query },
): Promise<string | null> {
    const { data } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .eq('service', 'ahrefs')
        .maybeSingle();
    const apiKey = (data as { credentials?: { api_key?: string } } | null)?.credentials?.api_key;
    return typeof apiKey === 'string' && apiKey.length > 0 ? apiKey : null;
}

export async function loadKeywordResearchTarget(
    clientId: string,
    organizationId: string,
    admin: { from: (table: string) => Query } = createAdminClient() as unknown as { from: (table: string) => Query },
): Promise<{ domain: string | null; siteUrl: string | null }> {
    const { data: clientRow } = await admin.from('clients').select('domain').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
    const { data: gscRow } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('organization_id', organizationId)
        .eq('service', 'gsc')
        .maybeSingle();
    return {
        domain: (clientRow as { domain?: string | null } | null)?.domain ?? null,
        siteUrl: (gscRow as { credentials?: { site_url?: string } } | null)?.credentials?.site_url ?? null,
    };
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

async function fetchOrganicKeywords(domain: string, apiKey: string, fetchImpl: typeof fetch) {
    const params = new URLSearchParams({
        target: domain,
        country: 'us',
        limit: '100',
        order_by: 'traffic:desc',
        output: 'json',
    });
    const res = await fetchImpl(`https://api.ahrefs.com/v3/site-explorer/organic-keywords?${params}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
        return { error: `Ahrefs request failed (HTTP ${res.status})` as const };
    }
    const data = await res.json();
    const keywords = (Array.isArray(data.keywords) ? data.keywords : []).map((keyword: Record<string, unknown>) => ({
        keyword: keyword.keyword,
        volume: keyword.volume ?? null,
        difficulty: keyword.keyword_difficulty ?? null,
        position: keyword.serp_position ?? null,
        traffic: keyword.traffic ?? null,
    }));
    return { keywords };
}

export function createKeywordResearchHandler(deps: KeywordResearchDeps) {
    return {
        async GET(request: Request) {
            const params = new URL(request.url).searchParams;
            const clientId = params.get('clientId');
            if (!clientId) return json({ error: 'clientId required' }, 400);
            if (!isUuid(clientId)) return json({ error: 'Invalid clientId' }, 400);
            const auth = await deps.requireClientOrgMember(clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            if (auth.role === 'viewer') return json({ error: 'Forbidden' }, 403);

            const mode = params.get('mode') ?? 'domain';
            if (mode !== 'domain' && mode !== 'competitor') return json({ error: 'Invalid mode' }, 400);

            const apiKey = await deps.loadKey(auth.clientId, auth.organizationId);
            if (!apiKey) {
                return json({ error: 'Ahrefs not connected for this client. Connect it in the Integrations tab first.' }, 404);
            }

            let target: string | null;
            if (mode === 'competitor') {
                const competitor = params.get('competitor');
                if (!competitor) return json({ error: 'competitor domain required' }, 400);
                target = normalizeCompetitorHost(competitor);
                if (!target) return json({ error: 'Invalid competitor' }, 400);
            } else {
                const loaded = await deps.loadTarget(auth.clientId, auth.organizationId);
                target = keywordTarget(loaded.domain, loaded.siteUrl);
                if (!target) return json({ error: 'No website domain found. Set the client domain in Edit Client first.' }, 400);
            }

            try {
                const result = await fetchOrganicKeywords(target, apiKey, deps.fetch);
                if ('error' in result) return json({ error: result.error }, 502);
                return json({ domain: target, keywords: result.keywords, source: mode });
            } catch {
                return json({ error: 'Ahrefs request failed' }, 502);
            }
        },
    };
}
