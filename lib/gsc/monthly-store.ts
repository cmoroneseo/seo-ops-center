import { createAdminClient } from '@/lib/supabase/admin';
import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';
import { fetchError, noData, notConfigured, ok, type FetchResult } from '@/lib/sync/fetch-result';
import { monthBounds } from '@/lib/sync/months';
import { deriveMonthlyGsc, type DaySnapshot } from './monthly';

function count(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
    return null;
}

/**
 * Monthly GSC from stored Pacific days. Missing days are not written as zero.
 * The property grain is the full property total; surface splits stay on page rows.
 */
export async function loadMonthlyGsc(clientId: string, metricMonth: string): Promise<FetchResult> {
    let auth: Awaited<ReturnType<typeof getGoogleAccessToken>>;
    try {
        auth = await getGoogleAccessToken(clientId, 'gsc');
    } catch (error) {
        if (error instanceof GoogleAuthError) {
            return fetchError(error.message, error.kind === 'transient', error.kind === 'reauth_required');
        }
        throw error;
    }
    if (!auth || typeof auth.creds.site_url !== 'string' || auth.creds.site_url.length === 0) {
        return notConfigured('Search Console not connected');
    }

    const admin = createAdminClient();
    const { data: client, error: clientError } = await admin.from('clients').select('organization_id').eq('id', clientId).maybeSingle();
    if (clientError || !client) return fetchError('Unable to read Search Console history', true);
    const bounds = monthBounds(metricMonth);
    const { data: days, error: daysError } = await admin.from('gsc_history_days')
        .select('id, data_date, is_incomplete')
        .eq('organization_id', client.organization_id)
        .eq('client_id', clientId)
        .eq('property', auth.creds.site_url)
        .eq('search_type', 'web')
        .gte('data_date', bounds.start)
        .lte('data_date', bounds.end);
    if (daysError || !days) return fetchError('Unable to read Search Console history', true);
    if (days.length === 0) return noData('no stored Search Console history for this month');

    const { data: facts, error: factsError } = await admin.from('gsc_history_facts')
        .select('day_id, clicks, impressions, position')
        .in('day_id', days.map(day => day.id))
        .eq('grain', 'property');
    if (factsError || !facts) return fetchError('Unable to read Search Console history', true);

    const byDay = new Map(facts.map(fact => [fact.day_id, fact]));
    let snapshots: DaySnapshot[];
    try {
        snapshots = days.map(day => {
            const fact = byDay.get(day.id);
            if (!fact) return { date: day.data_date, isIncomplete: day.is_incomplete, property: { clicks: 0, impressions: 0, position: 0 } };
            const clicks = count(fact.clicks);
            const impressions = count(fact.impressions);
            const position = typeof fact.position === 'number' ? fact.position : Number(fact.position);
            if (clicks == null || impressions == null || !Number.isFinite(position)) throw new Error('Invalid stored Search Console day');
            return { date: day.data_date, isIncomplete: day.is_incomplete, property: { clicks, impressions, position } };
        });
    } catch {
        return fetchError('Unable to read Search Console history', true);
    }

    const derived = deriveMonthlyGsc(metricMonth, snapshots);
    if (!derived) return noData('no stored Search Console history for this month');
    return ok(derived.data, derived.provenance);
}
