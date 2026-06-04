import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { upsertMetric, getClientMetrics } from '@/lib/sync/upsertMetric';

/**
 * GET /api/metrics?clientId=...&month=...
 * Returns all metric rows for a client (optionally filtered by month).
 */
export async function GET(req: NextRequest) {
    const clientId = req.nextUrl.searchParams.get('clientId');
    const month = req.nextUrl.searchParams.get('month') ?? undefined;

    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const rows = await getClientMetrics(clientId, { month });
    return NextResponse.json({ metrics: rows });
}

/**
 * POST /api/metrics
 * Manual entry for a metric source. source_type is set to 'manual'.
 * Body: { clientId, orgId, source, metricMonth, data }
 */
export async function POST(req: NextRequest) {
    const { clientId, orgId, source, metricMonth, data } = await req.json();

    if (!clientId || !orgId || !source || !metricMonth || !data) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const validSources = ['ga4', 'gsc', 'gbp', 'ahrefs'];
    if (!validSources.includes(source)) {
        return NextResponse.json({ error: 'Invalid source' }, { status: 400 });
    }

    const result = await upsertMetric({
        organizationId: orgId,
        clientId,
        source,
        metricMonth,
        data,
        sourceType: 'manual',
    });

    if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
