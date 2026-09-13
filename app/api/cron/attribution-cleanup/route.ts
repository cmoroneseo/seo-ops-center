import { NextRequest, NextResponse } from 'next/server';
import { deleteOldPageviews } from '@/lib/supabase/attribution';

export const maxDuration = 300;

/**
 * POST /api/cron/attribution-cleanup
 *
 * Triggered daily at 10:00 UTC by Vercel Cron: deletes attribution pageview
 * events older than the 90-day retention window. Conversion events and
 * conversion records are never touched.
 *
 * Headers: { Authorization: 'Bearer <CRON_SECRET>' }
 */
export async function POST(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const deleted = await deleteOldPageviews(90);

    return NextResponse.json({
        deleted,
        timestamp: new Date().toISOString(),
    });
}

export const GET = POST;
