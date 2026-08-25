import {
    buildClientMonthSnapshot,
    detectPostApprovalChanges,
    type ApprovalEntry,
    type ClientMonthSnapshot,
} from './review.ts';
import type { LedgerLog } from './ledger.ts';

/**
 * Client-month review and approval boundaries.
 *
 * The rule this enforces end to end: **approval freezes a snapshot.** The
 * server computes the snapshot from the ledger at approval time, stores the
 * exact rows and minutes it included, and from then on only ever *compares*
 * against it. A later edit to an included entry produces a reported change and
 * a manager decision — never a quietly different approved total.
 */

const MONTH_FORMAT = /^\d{4}-\d{2}$/;

export type ReviewAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        clientName: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        isManager: boolean;
        /** From existing client data — this is not a second budget source. */
        budgetMinutes: number;
    }
    | { ok: false; status: number; error: string };

/** A stored approval, as read back. Its numbers are history, not a view. */
export interface StoredApproval {
    id: string;
    status: 'approved' | 'reopened';
    approvedAt: string;
    approvedBy?: string;
    note?: string;
    budgetMinutes: number;
    eligibleMinutes: number;
    nonBudgetMinutes: number;
    entries: ApprovalEntry[];
}

export interface ReviewRouteDependencies {
    now(): string;
    authorize(organizationId: string, clientId: string): Promise<ReviewAuthorization>;
    listClientMonthLogs(
        organizationId: string,
        clientId: string,
        month: string,
    ): Promise<LedgerLog[]>;
    /** The live approval for this client month, if one exists. */
    getApproval(
        organizationId: string,
        clientId: string,
        month: string,
    ): Promise<StoredApproval | null>;
}

export interface SaveApprovalInput {
    organizationId: string;
    clientId: string;
    month: string;
    approvedBy: string;
    approvedAt: string;
    note: string;
    budgetMinutes: number;
    eligibleMinutes: number;
    nonBudgetMinutes: number;
    entries: ApprovalEntry[];
    snapshot: ClientMonthSnapshot;
}

export interface ApprovalRouteDependencies extends ReviewRouteDependencies {
    saveApproval(input: SaveApprovalInput): Promise<{ id: string }>;
    reopenApproval(input: {
        approvalId: string;
        reopenedBy: string;
        reopenedAt: string;
        note: string;
    }): Promise<{ id: string }>;
    logActivity(input: {
        organizationId: string;
        clientId: string;
        eventType: string;
        actorName: string;
        actorId: string;
        metadata: Record<string, unknown>;
    }): Promise<void>;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

type Resolved =
    | { ok: false; response: Response }
    | {
        ok: true;
        authorization: Extract<ReviewAuthorization, { ok: true }>;
        logs: LedgerLog[];
        approval: StoredApproval | null;
        snapshot: ClientMonthSnapshot;
    };

async function resolve(
    dependencies: ReviewRouteDependencies,
    organizationId: string,
    clientId: string,
    month: string,
): Promise<Resolved> {
    if (!MONTH_FORMAT.test(month)) {
        return { ok: false, response: json({ error: 'month must be formatted YYYY-MM' }, 400) };
    }

    const authorization = await dependencies.authorize(organizationId, clientId);
    if (!authorization.ok) {
        return { ok: false, response: json({ error: authorization.error }, authorization.status) };
    }
    // Client budgets and other people's time are manager information.
    if (!authorization.isManager) {
        return { ok: false, response: json({ error: 'Forbidden' }, 403) };
    }

    const [logs, approval] = await Promise.all([
        dependencies.listClientMonthLogs(authorization.organizationId, authorization.clientId, month),
        dependencies.getApproval(authorization.organizationId, authorization.clientId, month),
    ]);

    const snapshot = buildClientMonthSnapshot(logs, {
        clientId: authorization.clientId,
        month,
        budgetMinutes: authorization.budgetMinutes,
    });

    return { ok: true, authorization, logs, approval, snapshot };
}

export function createClientReviewGet(dependencies: ReviewRouteDependencies) {
    return async function getClientReview(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const resolved = await resolve(
            dependencies,
            params.get('organizationId')?.trim() ?? '',
            params.get('clientId')?.trim() ?? '',
            params.get('month')?.trim() ?? '',
        );
        if (!resolved.ok) return resolved.response;

        const { authorization, logs, approval, snapshot } = resolved;

        // Drift is measured against the frozen snapshot, never the other way.
        const changes = approval && approval.status === 'approved'
            ? detectPostApprovalChanges(
                {
                    ...snapshot,
                    budgetMinutes: approval.budgetMinutes,
                    eligibleMinutes: approval.eligibleMinutes,
                    nonBudgetMinutes: approval.nonBudgetMinutes,
                    entries: approval.entries,
                },
                logs,
            )
            : [];

        return json({
            clientId: authorization.clientId,
            clientName: authorization.clientName,
            month: params.get('month')?.trim(),
            snapshot,
            approval,
            changes,
        });
    };
}

export function createApprovalPost(dependencies: ApprovalRouteDependencies) {
    return async function postApproval(request: Request): Promise<Response> {
        let body: unknown;
        try {
            body = await request.json();
        } catch {
            return json({ error: 'Invalid JSON' }, 400);
        }

        const input = (body ?? {}) as Record<string, unknown>;
        const action = typeof input.action === 'string' ? input.action : '';
        const note = typeof input.note === 'string' ? input.note.trim() : '';

        if (action !== 'approve' && action !== 'reopen') {
            return json({ error: 'action must be approve or reopen' }, 400);
        }

        const month = typeof input.month === 'string' ? input.month : '';
        const resolved = await resolve(
            dependencies,
            typeof input.organizationId === 'string' ? input.organizationId : '',
            typeof input.clientId === 'string' ? input.clientId : '',
            month,
        );
        if (!resolved.ok) return resolved.response;

        const { authorization, approval, snapshot } = resolved;

        if (action === 'reopen') {
            if (!approval || approval.status !== 'approved') {
                return json({ error: 'No approved month to reopen' }, 404);
            }
            const reopened = await dependencies.reopenApproval({
                approvalId: approval.id,
                reopenedBy: authorization.userId,
                reopenedAt: dependencies.now(),
                note,
            });
            await dependencies.logActivity({
                organizationId: authorization.organizationId,
                clientId: authorization.clientId,
                eventType: 'timesheet.client_month_reopened',
                actorName: authorization.actorName,
                actorId: authorization.userId,
                metadata: {
                    month,
                    approvalId: reopened.id,
                    // The prior snapshot is quoted, not modified.
                    approvedEligibleMinutes: approval.eligibleMinutes,
                    note,
                },
            });
            return json({ ok: true, action: 'reopened', approvalId: reopened.id });
        }

        if (approval && approval.status === 'approved') {
            return json({ error: 'This client month is already approved' }, 409);
        }
        if (snapshot.unmappedCount > 0) {
            return json({
                error: `Resolve ${snapshot.unmappedCount} unmapped ${
                    snapshot.unmappedCount === 1 ? 'entry' : 'entries'} before approving`,
            }, 409);
        }
        if (snapshot.requiresNote && !note) {
            return json({ error: 'Add a note explaining the over-budget month' }, 400);
        }

        const approvedAt = dependencies.now();
        const saved = await dependencies.saveApproval({
            organizationId: authorization.organizationId,
            clientId: authorization.clientId,
            month,
            approvedBy: authorization.userId,
            approvedAt,
            note,
            budgetMinutes: snapshot.budgetMinutes,
            eligibleMinutes: snapshot.eligibleMinutes,
            nonBudgetMinutes: snapshot.nonBudgetMinutes,
            entries: snapshot.entries,
            snapshot,
        });

        await dependencies.logActivity({
            organizationId: authorization.organizationId,
            clientId: authorization.clientId,
            eventType: 'timesheet.client_month_approved',
            actorName: authorization.actorName,
            actorId: authorization.userId,
            metadata: {
                month,
                approvalId: saved.id,
                budgetMinutes: snapshot.budgetMinutes,
                eligibleMinutes: snapshot.eligibleMinutes,
                nonBudgetMinutes: snapshot.nonBudgetMinutes,
                entryCount: snapshot.entries.length,
                note,
            },
        });

        return json({ ok: true, action: 'approved', approvalId: saved.id });
    };
}
