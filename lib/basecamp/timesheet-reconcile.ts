import type { TimesheetDelivery, TimesheetImportOutcome } from './timesheet-webhook-route.ts';

/**
 * Scheduled/manual recovery for missed webhook deliveries.
 *
 * Basecamp webhooks can be deactivated, dropped, or simply never delivered.
 * Reconciliation re-reads a bounded window of a client project's timesheet and
 * pushes each entry through the *same* importer the webhook uses — so there is
 * exactly one code path that can create a ledger row from provider state, and
 * one deduplication key (`basecamp_entry_id`) protecting it.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

export interface ReconcileProviderEntry {
    id: string;
    /** yyyy-MM-dd */
    date: string;
}

export interface ReconcileRequest {
    clientId: string;
    /** yyyy-MM-dd, inclusive */
    from: string;
    /** yyyy-MM-dd, inclusive */
    to: string;
}

export type ReconcileAuthorization =
    | { ok: true; organizationId: string; projectId: string }
    | { ok: false; status: number; error: string };

export interface ReconcileDependencies {
    expectedAccountId: string;
    /** Hard ceiling on the window, so a sweep can never walk all history. */
    maxRangeDays: number;
    /**
     * Resolves the caller's authority AND the canonical Basecamp project. The
     * project id must come from here, never from the request body.
     */
    authorize(clientId: string): Promise<ReconcileAuthorization>;
    provider: {
        listTimesheetEntries(
            projectId: string,
        ): Promise<ReconcileProviderEntry[] | 'unavailable'>;
    };
    importEntry(delivery: TimesheetDelivery): Promise<TimesheetImportOutcome>;
}

export interface ReconcileOutcome {
    status: number;
    body: unknown;
}

function isValidDate(value: unknown): value is string {
    return typeof value === 'string' && DATE_ONLY.test(value) && !Number.isNaN(Date.parse(value));
}

function daysBetween(from: string, to: string): number {
    return Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);
}

export function createTimesheetReconciler(dependencies: ReconcileDependencies) {
    return async function reconcile(request: ReconcileRequest): Promise<ReconcileOutcome> {
        if (!isValidDate(request.from) || !isValidDate(request.to)) {
            return { status: 400, body: { error: 'from and to must be yyyy-MM-dd dates' } };
        }
        const span = daysBetween(request.from, request.to);
        if (span < 0) {
            return { status: 400, body: { error: 'from must not be after to' } };
        }
        if (span > dependencies.maxRangeDays) {
            return {
                status: 400,
                body: { error: `Reconciliation range must be ${dependencies.maxRangeDays} days or fewer` },
            };
        }

        const authorization = await dependencies.authorize(request.clientId);
        if (!authorization.ok) {
            return { status: authorization.status, body: { error: authorization.error } };
        }

        const entries = await dependencies.provider.listTimesheetEntries(authorization.projectId);
        if (entries === 'unavailable') {
            return { status: 503, body: { error: 'Basecamp provider verification unavailable' } };
        }

        const inRange = entries.filter(entry =>
            isValidDate(entry.date) && entry.date >= request.from && entry.date <= request.to);

        let imported = 0;
        let failed = 0;
        for (const entry of inRange) {
            const delivery: TimesheetDelivery = {
                kind: 'timesheet_entry_reconciled',
                recordingId: entry.id,
                recordingUrl: `https://3.basecampapi.com/${dependencies.expectedAccountId}`
                    + `/buckets/${authorization.projectId}/timesheet_entries/${entry.id}.json`,
            };
            // One bad entry must not strand the rest of the window.
            const outcome = await dependencies.importEntry(delivery);
            if (outcome.status < 300) imported += 1;
            else failed += 1;
        }

        return {
            status: 200,
            body: { ok: true, scanned: inRange.length, imported, failed },
        };
    };
}
