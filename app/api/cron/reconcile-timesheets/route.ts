import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    getBasecampTimesheetEntryState,
    isBasecampConfigured,
    listBasecampTimesheetEntryStubs,
} from '@/lib/basecamp/api';
import { createTimesheetEntryImporter } from '@/lib/basecamp/timesheet-webhook-route';
import { createTimesheetImportStore } from '@/lib/basecamp/timesheet-import-store';
import { createTimesheetReconciler } from '@/lib/basecamp/timesheet-reconcile';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Repair window: enough to cover a weekend outage plus month-end edits. */
const LOOKBACK_DAYS = 14;

/**
 * GET|POST /api/cron/reconcile-timesheets
 *
 * Daily recovery for missed or deactivated Basecamp webhook deliveries.
 *
 * The cadence is daily because the Vercel account is on the Hobby plan, which
 * rejects any cron running more than once per day. The webhook is the primary
 * path and is unaffected; this only sets how long a *missed* delivery can sit
 * unnoticed. Managers can always run it on demand from the reconcile route.
 * If the plan is upgraded, `0 * * * *` in vercel.json restores hourly.
 * Sweeps every timesheet-enabled client through the same importer the webhook
 * uses, so a re-run can never produce a duplicate ledger row.
 *
 * Auth: Bearer CRON_SECRET only — this runs with no user session, so unlike the
 * manager-facing reconcile route it must not fall back to cookie auth.
 */
function isAuthorized(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

function isoDaysAgo(days: number): string {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

async function run(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isBasecampConfigured() || !process.env.BASECAMP_ACCOUNT_ID) {
        return NextResponse.json({ error: 'Basecamp is not configured' }, { status: 503 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
        .from('clients')
        .select('id, organization_id, custom_fields')
        .not('custom_fields->basecamp_project_id', 'is', null);
    if (error) {
        return NextResponse.json({ error: 'Unable to list clients' }, { status: 500 });
    }

    const targets = (data ?? []).flatMap(client => {
        const fields = (client.custom_fields as Record<string, unknown>) ?? {};
        if (!fields.basecamp_sync_enabled || !fields.basecamp_timesheet_enabled) return [];
        if (!fields.basecamp_project_id) return [];
        return [{
            clientId: client.id,
            organizationId: client.organization_id,
            projectId: String(fields.basecamp_project_id),
        }];
    });

    const importEntry = createTimesheetEntryImporter({
        expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
        now: () => new Date().toISOString(),
        provider: {
            isConfigured: isBasecampConfigured,
            getTimesheetEntry: getBasecampTimesheetEntryState,
        },
        store: createTimesheetImportStore(),
    });

    const from = isoDaysAgo(LOOKBACK_DAYS);
    const to = new Date().toISOString().slice(0, 10);
    const results: { clientId: string; scanned: number; imported: number; failed: number }[] = [];

    for (const target of targets) {
        const reconcile = createTimesheetReconciler({
            expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
            maxRangeDays: LOOKBACK_DAYS + 1,
            // Authority is the cron secret; the project comes from the client row.
            async authorize() {
                return {
                    ok: true,
                    organizationId: target.organizationId,
                    projectId: target.projectId,
                };
            },
            provider: {
                listTimesheetEntries: projectId => listBasecampTimesheetEntryStubs(projectId),
            },
            importEntry,
        });

        // One unhealthy client project must not stop the sweep.
        const outcome = await reconcile({ clientId: target.clientId, from, to });
        const body = outcome.body as { scanned?: number; imported?: number; failed?: number };
        results.push({
            clientId: target.clientId,
            scanned: body.scanned ?? 0,
            imported: body.imported ?? 0,
            failed: body.failed ?? (outcome.status >= 400 ? 1 : 0),
        });
    }

    return NextResponse.json({ ok: true, from, to, clients: results.length, results });
}

export const GET = run;
export const POST = run;
