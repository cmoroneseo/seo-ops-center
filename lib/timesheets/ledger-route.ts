import { buildWeeklyLedger, weekDays, weekStartFor, type LedgerLog } from './ledger.ts';
import { formatLocalDate } from '../planner/local-date.ts';

/**
 * Authenticated read boundary for the weekly ledger.
 *
 * Two things are enforced here rather than in the browser:
 *   * **whose** time you may read — your own always, anyone else's only as a
 *     manager. RLS scopes `time_logs` to the organization, so member-level
 *     privacy cannot come from the database policy alone.
 *   * **what the totals are** — every number the grid renders is computed from
 *     the ledger on the server, so the UI has no arithmetic of its own to drift.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface LedgerQueryScope {
    organizationId: string;
    /** null means every member — managers only. */
    userId: string | null;
    from: string;
    to: string;
}

export type LedgerAuthorization =
    | {
        ok: true;
        userId: string;
        organizationId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        isManager: boolean;
    }
    | { ok: false; status: number; error: string };

export interface LedgerRouteDependencies {
    now(): string;
    authorize(organizationId: string): Promise<LedgerAuthorization>;
    listLogs(scope: LedgerQueryScope): Promise<LedgerLog[]>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createTimesheetLedgerGet(dependencies: LedgerRouteDependencies) {
    return async function getTimesheetLedger(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const organizationId = params.get('organizationId')?.trim() ?? '';
        const requestedWeek = params.get('weekStart')?.trim() ?? '';
        const requestedUser = params.get('userId')?.trim() ?? '';
        const scope = params.get('scope')?.trim() ?? 'member';

        if (requestedWeek && !DATE_ONLY.test(requestedWeek)) {
            return json({ error: 'weekStart must be a yyyy-MM-dd date' }, 400);
        }

        const authorization = await dependencies.authorize(organizationId);
        if (!authorization.ok) {
            return json({ error: authorization.error }, authorization.status);
        }

        let targetUserId: string | null = authorization.userId;
        if (scope === 'team') {
            if (!authorization.isManager) return json({ error: 'Forbidden' }, 403);
            targetUserId = null;
        } else if (requestedUser && requestedUser !== authorization.userId) {
            if (!authorization.isManager) return json({ error: 'Forbidden' }, 403);
            targetUserId = requestedUser;
        }

        const weekStart = weekStartFor(
            requestedWeek || formatLocalDate(new Date(dependencies.now())),
        );
        const days = weekDays(weekStart);

        const logs = await dependencies.listLogs({
            organizationId: authorization.organizationId,
            userId: targetUserId,
            from: days[0],
            to: days[days.length - 1],
        });

        const ledger = buildWeeklyLedger(logs, weekStart);
        // The inspector renders individual entries for the selected row. They
        // are already fetched and already authorized, so shipping them with the
        // grid avoids a second round trip that could see a different scope.
        const rendered = new Set(
            ledger.clients.flatMap(group => group.rows.flatMap(row => row.entryIds)),
        );

        return json({
            userId: targetUserId,
            role: authorization.role,
            isManager: authorization.isManager,
            ledger,
            entries: logs.filter(log => rendered.has(log.id)),
        });
    };
}
