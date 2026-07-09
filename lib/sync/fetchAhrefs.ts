import { createAdminClient } from '@/lib/supabase/admin';
import { markIntegrationError, markIntegrationSynced } from './token';

/**
 * Fetch Ahrefs metrics for a client.
 * Returns { domain_rating, ranked_keywords, top_10_keywords, top_20_keywords, top_50_keywords } or null.
 *
 * Uses Ahrefs API v3. Base plan = 1M quota/month.
 * Cost estimate: ~50 units per client per month (well within quota).
 */
export async function fetchAhrefs(
    clientId: string,
): Promise<Record<string, number> | null> {
    const admin = createAdminClient();

    const { data: row } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'ahrefs')
        .eq('sync_status', 'active')
        .maybeSingle();

    if (!row?.credentials) return null;
    const creds = row.credentials as Record<string, any>;
    const apiKey = creds.api_key as string | undefined;
    if (!apiKey) return null;

    // We need the client's website URL — pull from GSC site_url or clients table
    const { data: gscRow } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'gsc')
        .maybeSingle();

    const { data: clientRow } = await admin
        .from('clients')
        .select('website_url, name')
        .eq('id', clientId)
        .maybeSingle();

    const target: string =
        (gscRow?.credentials as any)?.site_url ||
        clientRow?.website_url ||
        '';

    if (!target) {
        await markIntegrationError(clientId, 'ahrefs', 'No website URL found — set one on the client or connect GSC first.');
        return null;
    }

    // Strip GSC's "sc-domain:" domain-property prefix and any URL scheme/trailing slash —
    // Ahrefs rejects both ("bad target").
    const cleanTarget = target
        .replace(/^sc-domain:/, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');

    const headers = { Authorization: `Bearer ${apiKey}` };
    const today = new Date().toISOString().slice(0, 10);

    // Fetch Domain Rating and ranked keywords in parallel.
    // Both now require `date`; organic-keywords also requires an explicit `select`.
    const [drRes, kwRes] = await Promise.all([
        fetch(
            `https://api.ahrefs.com/v3/site-explorer/domain-rating?${new URLSearchParams({ target: cleanTarget, date: today, output: 'json' })}`,
            { headers },
        ),
        fetch(
            `https://api.ahrefs.com/v3/site-explorer/organic-keywords?${new URLSearchParams({ target: cleanTarget, country: 'us', limit: '1000', date: today, select: 'keyword,best_position', output: 'json' })}`,
            { headers },
        ),
    ]);

    if (!drRes.ok || !kwRes.ok) {
        const errText = await (drRes.ok ? kwRes : drRes).text();
        await markIntegrationError(clientId, 'ahrefs', `Ahrefs API error: ${errText.slice(0, 200)}`);
        return null;
    }

    const [drData, kwData] = await Promise.all([drRes.json(), kwRes.json()]);

    const domain_rating = Math.round(drData.domain_rating?.domain_rating ?? 0);
    const keywords: any[] = kwData.keywords ?? [];

    const ranked_keywords = keywords.length;
    const top_10_keywords = keywords.filter(k => k.best_position <= 10).length;
    const top_20_keywords = keywords.filter(k => k.best_position <= 20).length;
    const top_50_keywords = keywords.filter(k => k.best_position <= 50).length;

    await markIntegrationSynced(clientId, 'ahrefs');
    return { domain_rating, ranked_keywords, top_10_keywords, top_20_keywords, top_50_keywords };
}
