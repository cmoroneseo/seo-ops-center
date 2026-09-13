import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getConversionsMissingQueries, updateConversionQueries } from '@/lib/supabase/attribution';
import { rankQueries } from '@/lib/attribution/query-matcher';

export const maxDuration = 300;

/**
 * POST /api/cron/attribution-queries
 *
 * Triggered daily at 09:00 UTC by Vercel Cron: cross-references recent
 * attribution conversions with no likely-queries match against imported GSC
 * history for the conversion's month, and backfills the top-ranked queries.
 *
 * Headers: { Authorization: 'Bearer <CRON_SECRET>' }
 */
export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const conversions = await getConversionsMissingQueries(7);

    let matched = 0;
    for (const conv of conversions) {
        const monthDate = typeof conv.month === 'string' ? conv.month.slice(0, 7) : new Date(conv.month).toISOString().slice(0, 7);

        const { data: days } = await admin
            .from('gsc_history_days')
            .select('id')
            .eq('client_id', conv.clientId)
            .gte('data_date', monthDate + '-01')
            .lte('data_date', monthDate + '-31');

        if (!days || days.length === 0) continue;

        const dayIds = days.map(d => d.id);
        const { data: facts } = await admin
            .from('gsc_history_facts')
            .select('query, page, clicks, impressions')
            .in('day_id', dayIds)
            .eq('grain', 'query_page')
            .gt('clicks', 0);

        if (!facts || facts.length === 0) continue;

        const queries = rankQueries(facts, conv.landingPage);
        if (queries.length > 0) {
            await updateConversionQueries(conv.id, queries);
            matched++;
        }
    }

    return NextResponse.json({
        total: conversions.length,
        matched,
        timestamp: new Date().toISOString(),
    });
}
