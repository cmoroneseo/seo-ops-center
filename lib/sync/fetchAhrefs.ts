import { createAdminClient } from '@/lib/supabase/admin';
import { markIntegrationError, markIntegrationSynced } from './token';

/**
 * Fetch Ahrefs metrics for a client for a given month.
 * Returns { domain_rating, ranked_keywords, top_10_keywords, top_20_keywords, top_50_keywords } or null.
 *
 * Uses Ahrefs API v3. Base plan = 1M quota/month.
 * Cost estimate: ~50 units per client per month (well within quota).
 *
 * Methodology verified live against a real account (and cross-checked against
 * Ahrefs' own Organic Keywords UI report, which returned the same total):
 *   - Domain Rating is a single point-in-time snapshot — anchored to the
 *     target month's last day, not "today" (a report for a past month should
 *     never silently show whatever DR is on the day someone happens to sync).
 *   - Organic keywords MUST use a period comparison (`date` + `date_compared`
 *     spanning the month), not a single-day snapshot. A single date only
 *     returns keywords ranking on that exact day; Ahrefs' own UI (and this
 *     comparison mode) returns the union of every keyword that ranked at
 *     EITHER the start or end of the period — including ones that dropped
 *     out by month-end (best_position: null, best_position_prev: set) and
 *     ones that newly appeared. That's the number agencies actually mean by
 *     "ranked keywords this month," and it's meaningfully larger than a
 *     snapshot count.
 *   - Top 10/20/50 tier counts follow the same logic: a keyword counts
 *     toward a tier if it ranked there at EITHER point in the period, not
 *     just at period end.
 */
export async function fetchAhrefs(
    clientId: string,
    metricMonth: string, // 'YYYY-MM'
): Promise<Record<string, number> | null> {
    const admin = createAdminClient();

    // No sync_status filter — gating the credentials lookup on the *previous*
    // attempt's outcome creates a deadlock: once a sync fails and flips status
    // to 'error', every subsequent attempt would silently refuse to even try,
    // since only a successful sync can flip it back to 'active'. This
    // function decides active/error based on THIS attempt, not the last one.
    // A disconnected integration has its credentials wiped to {}, so the
    // api_key check just below already excludes it — no extra status check needed.
    const { data: row } = await admin
        .from('client_integrations')
        .select('credentials')
        .eq('client_id', clientId)
        .eq('service', 'ahrefs')
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
    // Ahrefs rejects both ("bad target"). (Verified a trailing slash makes no difference
    // either way, so we don't add one back.)
    const cleanTarget = target
        .replace(/^sc-domain:/, '')
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');

    const headers = { Authorization: `Bearer ${apiKey}` };

    const [y, m] = metricMonth.split('-').map(Number);
    const dateStart = `${metricMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const dateEnd = `${metricMonth}-${String(lastDay).padStart(2, '0')}`;

    const [drRes, kwRes] = await Promise.all([
        fetch(
            `https://api.ahrefs.com/v3/site-explorer/domain-rating?${new URLSearchParams({ target: cleanTarget, date: dateEnd, output: 'json' })}`,
            { headers },
        ),
        fetch(
            `https://api.ahrefs.com/v3/site-explorer/organic-keywords?${new URLSearchParams({
                target: cleanTarget,
                country: 'us',
                limit: '1000',
                date: dateEnd,
                date_compared: dateStart,
                select: 'keyword,best_position,best_position_prev',
                output: 'json',
            })}`,
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

    // Counts toward a tier if it ranked there at either the start or end of the period.
    const inTier = (k: any, max: number) =>
        (k.best_position != null && k.best_position <= max) ||
        (k.best_position_prev != null && k.best_position_prev <= max);

    const ranked_keywords = keywords.length;
    const top_10_keywords = keywords.filter(k => inTier(k, 10)).length;
    const top_20_keywords = keywords.filter(k => inTier(k, 20)).length;
    const top_50_keywords = keywords.filter(k => inTier(k, 50)).length;

    await markIntegrationSynced(clientId, 'ahrefs');
    return { domain_rating, ranked_keywords, top_10_keywords, top_20_keywords, top_50_keywords };
}
