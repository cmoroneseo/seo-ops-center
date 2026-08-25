import { weekDays, weekStartFor } from './ledger.ts';
import { buildTeamSummary, type TeamMemberIdentity } from './team.ts';
import { formatLocalDate } from '../planner/local-date.ts';
import type { LedgerAuthorization, LedgerQueryScope } from './ledger-route.ts';
import type { LedgerLog } from './ledger.ts';

/**
 * Manager-only read boundary for the team view.
 *
 * There is no "member sees a limited team view" mode: a non-manager gets 403
 * before any query runs, so another person's time never leaves the database.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface TeamRouteDependencies {
    now(): string;
    authorize(organizationId: string): Promise<LedgerAuthorization>;
    listLogs(scope: LedgerQueryScope): Promise<LedgerLog[]>;
    listMembers(organizationId: string): Promise<TeamMemberIdentity[]>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createTimesheetTeamGet(dependencies: TeamRouteDependencies) {
    return async function getTeamTimesheet(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const organizationId = params.get('organizationId')?.trim() ?? '';
        const requestedWeek = params.get('weekStart')?.trim() ?? '';

        if (requestedWeek && !DATE_ONLY.test(requestedWeek)) {
            return json({ error: 'weekStart must be a yyyy-MM-dd date' }, 400);
        }

        const authorization = await dependencies.authorize(organizationId);
        if (!authorization.ok) {
            return json({ error: authorization.error }, authorization.status);
        }
        if (!authorization.isManager) {
            return json({ error: 'Forbidden' }, 403);
        }

        const weekStart = weekStartFor(
            requestedWeek || formatLocalDate(new Date(dependencies.now())),
        );
        const days = weekDays(weekStart);

        const [logs, members] = await Promise.all([
            dependencies.listLogs({
                organizationId: authorization.organizationId,
                userId: null,
                from: days[0],
                to: days[days.length - 1],
            }),
            dependencies.listMembers(authorization.organizationId),
        ]);

        return json({ summary: buildTeamSummary(logs, weekStart, members) });
    };
}
