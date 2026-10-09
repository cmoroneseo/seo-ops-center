/**
 * GET /api/reports/close?month=YYYY-MM
 * The month is the only query input. Organization id comes from the session.
 */

import { searchReportingEnabled } from '@/lib/search-reporting/flag';
import { previousMonth, ptMonth } from '@/lib/sync/months';
import type { CloseBoardView } from './close-view';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface CloseRouteDeps {
    enabled: () => boolean;
    authorize: () => Promise<
        | { ok: true; organizationId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
        | { ok: false; status: number; error: string }
    >;
    load: (
        organizationId: string,
        month: string,
        role: 'owner' | 'admin' | 'member' | 'viewer',
        now: Date,
    ) => Promise<{ ok: true; board: CloseBoardView } | { ok: false; status: number; error: string }>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createCloseHandler(deps: CloseRouteDeps) {
    return async function get(request: Request) {
        if (!deps.enabled()) return json({ error: 'Not found' }, 404);
        const monthParam = new URL(request.url).searchParams.get('month');
        const now = deps.now();
        const month = monthParam ?? previousMonth(ptMonth(now));
        if (!MONTH.test(month)) return json({ error: 'Invalid month' }, 400);

        const auth = await deps.authorize();
        if (!auth.ok) return json({ error: auth.status === 401 ? 'Unauthorized' : auth.status === 403 ? 'Forbidden' : 'Could not load the close board.' }, auth.status);

        const loaded = await deps.load(auth.organizationId, month, auth.role, now);
        if (!loaded.ok) {
            const status = loaded.status === 503 ? 503 : 500;
            const error = status === 503 ? 'The close board is not available yet.' : 'Could not load the close board.';
            return json({ error }, status);
        }
        return json({ board: loaded.board });
    };
}

export function closeRouteDeps(): CloseRouteDeps {
    return {
        enabled: searchReportingEnabled,
        authorize: async () => {
            const { resolveSessionOrganization } = await import('./session-org');
            return resolveSessionOrganization();
        },
        load: async (organizationId, month, role, now) => {
            const { loadCloseBoard } = await import('./close-load');
            return loadCloseBoard(organizationId, month, role, now);
        },
        now: () => new Date(),
    };
}
