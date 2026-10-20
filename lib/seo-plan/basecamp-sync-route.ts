import type { SessionOrganization } from '../reports/session-org';
import type { PlanBasecampReadout, PlanBasecampSyncState } from './basecamp-push';
import type { PlanPushOutcome } from './basecamp-push-run';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlanBasecampSyncRouteDependencies {
    session: () => Promise<SessionOrganization>;
    /** The task's organization, or null when the id is unknown. */
    loadTask: (taskId: string) => Promise<{ organizationId: string } | null>;
    read: (taskId: string) => Promise<PlanBasecampReadout | null>;
    sync: (taskId: string) => Promise<PlanPushOutcome>;
}

export type PlanBasecampSyncRouteResult = {
    status: number;
    body: Record<string, unknown>;
};

function syncBody(outcome: PlanPushOutcome): { sync: PlanBasecampSyncState | null; banner: unknown } {
    if (outcome.status === 'skipped') return { sync: null, banner: null };
    return { sync: outcome.sync, banner: outcome.banner };
}

/**
 * Read or push one plan task.
 * Organization comes from the session. Viewers cannot push. A successful
 * push and a failed one both return 200 so the row can update without a toast.
 */
export async function handlePlanBasecampSync(
    method: string,
    url: string,
    body: unknown,
    dependencies: PlanBasecampSyncRouteDependencies,
): Promise<PlanBasecampSyncRouteResult> {
    const session = await dependencies.session();
    if (!session.ok) return { status: session.status, body: { error: session.error } };

    const taskId = method === 'GET'
        ? new URL(url).searchParams.get('taskId')?.trim() ?? ''
        : (body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { taskId?: unknown }).taskId === 'string'
            ? (body as { taskId: string }).taskId.trim()
            : '');
    if (!ID.test(taskId)) return { status: 400, body: { error: 'Not found' } };

    const task = await dependencies.loadTask(taskId);
    if (!task || task.organizationId !== session.organizationId) {
        return { status: 404, body: { error: 'Not found' } };
    }

    if (method === 'GET') {
        const readout = await dependencies.read(taskId);
        if (!readout) return { status: 404, body: { error: 'Not found' } };
        return { status: 200, body: { ...readout } };
    }

    if (method !== 'POST') return { status: 405, body: { error: 'Not found' } };
    if (session.role === 'viewer') return { status: 403, body: { error: 'Forbidden' } };

    const outcome = await dependencies.sync(taskId);
    if (outcome.status === 'skipped' && outcome.reason === 'missing') {
        return { status: 404, body: { error: 'Not found' } };
    }
    const recorded = syncBody(outcome);
    return {
        status: 200,
        body: {
            ok: outcome.status === 'ok' || outcome.status === 'skipped',
            outcome: outcome.status,
            ...(outcome.status === 'skipped' ? { reason: outcome.reason } : {}),
            ...(outcome.status === 'failed' ? { scope: outcome.scope } : {}),
            ...(outcome.status === 'ok' ? { todoId: outcome.todoId } : {}),
            sync: recorded.sync,
            basecamp: recorded.banner,
        },
    };
}
