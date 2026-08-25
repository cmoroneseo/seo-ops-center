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
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/** Two months is enough to repair a missed month-end without a history sweep. */
const MAX_RANGE_DAYS = 62;

const reconcile = createTimesheetReconciler({
    expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
    maxRangeDays: MAX_RANGE_DAYS,

    /**
     * Authority and the Basecamp project are resolved together, from the
     * database. A caller can name a client, never a project.
     */
    async authorize(clientId) {
        if (!isBasecampConfigured() || !process.env.BASECAMP_ACCOUNT_ID) {
            return { ok: false, status: 503, error: 'Basecamp is not configured' };
        }

        const manager = await requireClientIntegrationManager(clientId);
        if (!manager.ok) return { ok: false, status: manager.status, error: manager.error };

        const { data, error } = await createAdminClient()
            .from('clients')
            .select('custom_fields')
            .eq('id', manager.clientId)
            .maybeSingle();
        if (error) return { ok: false, status: 500, error: 'Unable to read client integration' };

        const fields = (data?.custom_fields as Record<string, unknown>) ?? {};
        const projectId = fields.basecamp_project_id;
        if (!fields.basecamp_sync_enabled || !fields.basecamp_timesheet_enabled || !projectId) {
            return { ok: false, status: 400, error: 'Basecamp time tracking is not enabled for this client' };
        }

        return {
            ok: true,
            organizationId: manager.organizationId,
            projectId: String(projectId),
        };
    },

    provider: {
        listTimesheetEntries: projectId => listBasecampTimesheetEntryStubs(projectId),
    },

    // The exact importer the webhook uses — one write path, one dedupe key.
    importEntry: createTimesheetEntryImporter({
        expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
        now: () => new Date().toISOString(),
        provider: {
            isConfigured: isBasecampConfigured,
            getTimesheetEntry: getBasecampTimesheetEntryState,
        },
        store: createTimesheetImportStore(),
    }),
});

/**
 * POST /api/integrations/basecamp/timesheet/reconcile
 * Body: { clientId, from: 'yyyy-MM-dd', to: 'yyyy-MM-dd' }
 *
 * Repairs missed or deactivated webhook deliveries. Manager-only, bounded, and
 * idempotent — running it twice cannot create a second ledger row.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const outcome = await reconcile({
        clientId: typeof input.clientId === 'string' ? input.clientId : '',
        from: typeof input.from === 'string' ? input.from : '',
        to: typeof input.to === 'string' ? input.to : '',
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
}
