import { NextRequest, NextResponse } from 'next/server';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { fetchAhrefs } from '@/lib/sync/fetchAhrefs';
import { fetchGA4 } from '@/lib/sync/fetchGA4';
import { fetchGBP } from '@/lib/sync/fetchGBP';
import { fetchGSC } from '@/lib/sync/fetchGSC';
import { createSupabaseSyncStore, runMetricsSync } from '@/lib/sync/metrics-sync';
import { authorizeSyncRequest, SyncRequestError } from '@/lib/sync/request';

export const maxDuration = 300; // 300 s; Vercel Pro with Fluid allows up to 800 s

/**
 * POST /api/sync/metrics
 *
 * Triggered by Vercel Cron (GET with the cron secret) and by an account
 * manager syncing one client from the report builder.
 */
export async function POST(req: NextRequest) {
    let scope;
    try {
        scope = await authorizeSyncRequest(req, process.env.CRON_SECRET, requireClientIntegrationManager);
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof SyncRequestError ? error.message : 'Unable to authorize sync' },
            { status: error instanceof SyncRequestError ? error.status : 500 },
        );
    }
    try {
        const result = await runMetricsSync(
            { organizationId: scope.organizationId, clientId: scope.clientId, months: scope.months, trigger: scope.trigger },
            {
                store: createSupabaseSyncStore(),
                fetchers: { gsc: fetchGSC, ga4: fetchGA4, gbp: fetchGBP, ahrefs: fetchAhrefs },
                now: () => Date.now(),
            },
        );
        return NextResponse.json(result);
    } catch {
        return NextResponse.json({ error: 'Unable to sync metrics' }, { status: 500 });
    }
}

export async function GET(req: NextRequest) {
    return POST(req);
}
