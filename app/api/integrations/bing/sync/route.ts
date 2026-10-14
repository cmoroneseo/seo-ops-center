import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { bingJson } from '@/lib/bing/client';
import { bingWebmasterApiKey, bingWebmasterEnabled } from '@/lib/bing/flags';
import { logBingSyncSummary } from '@/lib/bing/log';
import { runBingManual } from '@/lib/bing/manual';
import type { BingManualView } from '@/lib/bing/manual-view';
import { createBingStore } from '@/lib/bing/store';
import { readBingSite } from '@/lib/bing/sync';
import { requireOrganizationAdmin } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { SELECTED_ORG_COOKIE } from '@/lib/theme/cookie';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function skipped(reason: BingManualView['skipped']): BingManualView {
    return { sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped: reason };
}

/**
 * Admin click for one organization. Maps hosts the same way the daily cron
 * does, then syncs a few sites in this request so it does not wait on the
 * queue callback. The JSON body is counts and HTTP status codes.
 */
export async function POST() {
    const jar = await cookies();
    const auth = await requireOrganizationAdmin(jar.get(SELECTED_ORG_COOKIE)?.value);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const result = await runForOrganization(auth.organizationId);
    logBingSyncSummary({
        source: 'manual',
        sitesMapped: result.sitesMapped,
        sitesSynced: result.sitesSynced,
        remaining: result.remaining,
        errors: result.errors,
    });
    return NextResponse.json({
        sitesMapped: result.sitesMapped,
        sitesSynced: result.sitesSynced,
        remaining: result.remaining,
        errors: result.errors,
        skipped: result.skipped,
    });
}

async function runForOrganization(organizationId: string): Promise<BingManualView> {
    if (!bingWebmasterEnabled(process.env, organizationId)) return skipped('flag_off');
    const apiKey = bingWebmasterApiKey(process.env);
    if (!apiKey) return skipped('missing_key');
    try {
        return await runBingManual(organizationId, {
            env: process.env,
            now: () => new Date(),
            newRunId: () => crypto.randomUUID(),
            fetchSites: () => bingJson({ method: 'GetUserSites', apiKey }),
            readSite: siteUrl => readBingSite(siteUrl, apiKey),
            store: createBingStore(createAdminClient(), process.env),
            publish: async () => {},
        });
    } catch {
        return skipped('unavailable');
    }
}
