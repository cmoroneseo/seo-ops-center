import { deriveIssues, isReadyToSubmit, type ImportIssue } from './import-issues.ts';
import { minutesFromHours } from './ledger.ts';
import type { TimeLogImportStatus } from '../types.ts';

/**
 * The review queue read model.
 *
 * Members read their own rows; managers read anyone's. That boundary is here
 * rather than in RLS, which is organization-scoped and cannot express
 * "your own rows only".
 */

export interface QueueSourceRow {
    id: string;
    /**
     * The org member this time belongs to, or null when the Basecamp person
     * who logged it has never been mapped in Settings. Null, never a sentinel:
     * this field is the member-privacy check in the entries route, the one
     * boundary RLS cannot express, and a placeholder that types as a real id
     * is exactly how that check quietly stops failing closed.
     */
    userId: string | null;
    clientId: string | null;
    clientName: string | null;
    isInternal: boolean;
    activityKey: string | null;
    taskId: string | null;
    taskTitle: string | null;
    importStatus: TimeLogImportStatus;
    date: string;
    hours: number;
    description: string;
    countsTowardBudget: boolean;
    basecampProjectName: string | null;
    reviewNote: string | null;
}

export interface QueueRow extends QueueSourceRow {
    minutes: number;
    issues: ImportIssue[];
    isReady: boolean;
}

export type QueueAuthorization =
    | { ok: true; userId: string; organizationId: string; isManager: boolean }
    | { ok: false; status: number; error: string };

export interface ImportQueueDependencies {
    authorize(organizationId: string): Promise<QueueAuthorization>;
    listQueue(scope: {
        organizationId: string;
        userId: string | null;
    }): Promise<QueueSourceRow[]>;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

export function createImportQueueGet(dependencies: ImportQueueDependencies) {
    return async function getImportQueue(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const organizationId = params.get('organizationId')?.trim() ?? '';
        const requestedUser = params.get('userId')?.trim() ?? '';

        const authorization = await dependencies.authorize(organizationId);
        if (!authorization.ok) {
            return json({ error: authorization.error }, authorization.status);
        }

        let targetUserId: string | null = authorization.userId;
        if (authorization.isManager) {
            targetUserId = requestedUser || null;
        } else if (requestedUser && requestedUser !== authorization.userId) {
            return json({ error: 'Forbidden' }, 403);
        }

        const source = await dependencies.listQueue({
            organizationId: authorization.organizationId,
            userId: targetUserId,
        });

        const rows: QueueRow[] = source.map(row => ({
            ...row,
            minutes: minutesFromHours(row.hours),
            issues: deriveIssues(row),
            isReady: isReadyToSubmit(row),
        }));

        return json({
            isManager: authorization.isManager,
            rows,
            summary: {
                total: rows.length,
                ready: rows.filter(row => row.isReady).length,
                blocked: rows.filter(row =>
                    row.importStatus === 'needs_context' && !row.isReady).length,
                pendingReview: rows.filter(row => row.importStatus === 'pending_review').length,
            },
        });
    };
}
