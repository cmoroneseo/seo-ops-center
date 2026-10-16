import type { SessionOrganization } from '../reports/session-org';
import type { StageListTask } from './stage-list';

const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StageListReadDependencies {
    session: () => Promise<SessionOrganization>;
    /** Whether the stage list is on for the session organization. */
    enabled: (organizationId: string) => boolean;
    /**
     * Load tasks for the session organization and the path client.
     * A null result means the client is not in that organization.
     */
    load: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
}

export type StageListReadResult =
    | { status: 200; body: { tasks: StageListTask[] } }
    | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } };

/**
 * Read the stage list for the signed-in organization.
 * The client id is only a path key. The organization and role come from the
 * session, and a flag that is off never reads tasks.
 */
export async function readClientStageList(
    clientIdInput: unknown,
    dependencies: StageListReadDependencies,
): Promise<StageListReadResult> {
    const clientId = typeof clientIdInput === 'string' ? clientIdInput.trim() : '';
    if (!CLIENT_ID.test(clientId)) return { status: 400, body: { error: 'Not found' } };

    const session = await dependencies.session();
    if (!session.ok) return { status: session.status, body: { error: session.error } };
    if (!dependencies.enabled(session.organizationId)) return { status: 404, body: { error: 'Not found' } };

    try {
        const tasks = await dependencies.load(session.organizationId, clientId);
        if (!tasks) return { status: 404, body: { error: 'Not found' } };
        return { status: 200, body: { tasks } };
    } catch {
        return { status: 500, body: { error: 'Could not load tasks' } };
    }
}
