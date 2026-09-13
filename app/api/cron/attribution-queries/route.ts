import { NextRequest, NextResponse } from 'next/server';
import { getConversionsMissingQueries, matchQueries, updateConversionQueries } from '@/lib/supabase/attribution';

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

    const conversions = await getConversionsMissingQueries(7);

    let matched = 0;
    let errors = 0;
    for (const conv of conversions) {
        try {
            const monthDate = typeof conv.month === 'string' ? conv.month.slice(0, 7) : new Date(conv.month).toISOString().slice(0, 7);
            const queries = await matchQueries(conv.clientId, conv.landingPage, monthDate);
            if (queries.length > 0) {
                await updateConversionQueries(conv.id, queries);
                matched++;
            }
        } catch (err) {
            errors++;
            console.error(`attribution-queries: failed for conversion ${conv.id}:`, err);
        }
    }

    return NextResponse.json({
        total: conversions.length,
        matched,
        errors,
        timestamp: new Date().toISOString(),
    });
}
