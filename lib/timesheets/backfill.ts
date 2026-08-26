import { fingerprintFor, parseTimesheetCsv } from '../basecamp/timesheet-csv.ts';
import { resolveProjectRole, type ProjectRoleRecord } from '../basecamp/project-roles.ts';
import type { ImportedEntryInput } from '../basecamp/timesheet-webhook-route.ts';

/**
 * Historical import from Basecamp's timesheet CSV report.
 *
 * One request per person and date range, rather than sweeping every project —
 * the report filters server-side, and the JSON alternative repeats its entries
 * across pages (see lib/basecamp/pagination.ts).
 *
 * Every row lands as `needs_context`. Nothing imported here counts toward a
 * client's budget until a member supplies an activity and a manager approves.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface BackfillRequest {
    userId: string;
    from: string;
    to: string;
}

export type BackfillAuthorization =
    | {
        ok: true;
        organizationId: string;
        actorUserId: string;
        targetUserId: string;
        basecampPersonId: string;
    }
    | { ok: false; status: number; error: string };

export interface BackfillDependencies {
    now(): string;
    authorize(userId: string): Promise<BackfillAuthorization>;
    listProjectRoles(organizationId: string): Promise<ProjectRoleRecord[]>;
    fetchCsv(input: {
        personId: string;
        from: string;
        to: string;
    }): Promise<string | 'unavailable'>;
    startRun(input: {
        organizationId: string;
        requestedBy: string;
        userId: string;
        from: string;
        to: string;
    }): Promise<{ id: string }>;
    finishRun(id: string, patch: Record<string, unknown>): Promise<void>;
    upsertImportedEntry(input: ImportedEntryInput): Promise<'created' | 'updated'>;
}

export interface BackfillOutcome {
    status: number;
    body: unknown;
}

export function createCsvBackfill(dependencies: BackfillDependencies) {
    return async function backfill(request: BackfillRequest): Promise<BackfillOutcome> {
        if (!DATE_ONLY.test(request.from) || !DATE_ONLY.test(request.to)) {
            return { status: 400, body: { error: 'from and to must be yyyy-MM-dd dates' } };
        }
        if (request.from > request.to) {
            return { status: 400, body: { error: 'from must not be after to' } };
        }

        const authorization = await dependencies.authorize(request.userId);
        if (!authorization.ok) {
            return { status: authorization.status, body: { error: authorization.error } };
        }

        const run = await dependencies.startRun({
            organizationId: authorization.organizationId,
            requestedBy: authorization.actorUserId,
            userId: authorization.targetUserId,
            from: request.from,
            to: request.to,
        });

        const csv = await dependencies.fetchCsv({
            personId: authorization.basecampPersonId,
            from: request.from,
            to: request.to,
        });
        if (csv === 'unavailable') {
            await dependencies.finishRun(run.id, {
                status: 'failed', scanned: 0, imported: 0, skipped: 0,
                error: 'Basecamp timesheet report unavailable',
            });
            return { status: 503, body: { error: 'Basecamp timesheet report unavailable' } };
        }

        const roles = await dependencies.listProjectRoles(authorization.organizationId);
        const rows = parseTimesheetCsv(csv);
        const importedAt = dependencies.now();

        let imported = 0;
        let skipped = 0;

        for (const row of rows) {
            const resolution = resolveProjectRole(roles, {
                projectId: null,
                projectName: row.projectName,
            });
            if (resolution.kind === 'ignored') {
                skipped += 1;
                continue;
            }

            await dependencies.upsertImportedEntry({
                // The CSV carries no ids at all; fingerprint is the identity.
                basecampEntryId: '',
                basecampProjectId: '',
                basecampRecordingId: '',
                organizationId: authorization.organizationId,
                clientId: resolution.clientId,
                taskId: null,
                userId: authorization.targetUserId,
                date: row.date,
                hours: row.hours,
                // Basecamp's own notes, kept verbatim. 13 of 14 are empty —
                // that is exactly what the review queue exists to fix.
                description: row.notes,
                importStatus: 'needs_context',
                providerUpdatedAt: row.created,
                importedAt,
                importFingerprint: fingerprintFor(row),
            });
            imported += 1;
        }

        await dependencies.finishRun(run.id, {
            status: 'complete', scanned: rows.length, imported, skipped, error: null,
        });

        return {
            status: 200,
            body: { ok: true, runId: run.id, scanned: rows.length, imported, skipped },
        };
    };
}
