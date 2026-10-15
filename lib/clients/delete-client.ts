import { isUuid } from '@/lib/reports/access';

/** Same roles create_client_with_setup already allows to manage clients. */
export const CLIENT_MANAGER_ROLES = ['owner', 'admin', 'member'] as const;

export const DELETE_CLIENT_FORBIDDEN = 'You cannot delete clients in this organization';

/** Database status for a Cancelled client. The product shows that as Archived. */
export const ARCHIVED_CLIENT_DB_STATUS = 'inactive';

export const ARCHIVED_CLIENT_STATUS = 'Cancelled';

export const CLIENTS_CHANGED_EVENT = 'clients:changed';

const DB_STATUS_LABEL: Record<string, string> = {
    active: 'Active',
    inactive: 'Cancelled',
    pending: 'Onboarding',
    paused: 'Paused',
    onboarding: 'Onboarding',
};

export type DeleteClientRole = 'owner' | 'admin' | 'member' | 'viewer';

export type DeleteClientAuth =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string;
        role: DeleteClientRole;
    }
    | { ok: false; status: 400 | 401 | 403 | 404 | 500; error: string };

export interface ClientArchiveRow {
    name: string;
    status: string;
}

export interface DeleteClientDeps {
    authorize(clientId: string): Promise<DeleteClientAuth>;
    loadClient(clientId: string, organizationId: string): Promise<ClientArchiveRow | null>;
    archiveClient(clientId: string, organizationId: string): Promise<{ error?: string; statusCode?: number }>;
    logStatusChange(event: {
        organizationId: string;
        clientId: string;
        actorId: string;
        actorName: string;
        clientName: string;
        fromStatus: string;
        toStatus: string;
    }): Promise<void>;
}

export function canDeleteClient(role: string | null | undefined): boolean {
    return role === 'owner' || role === 'admin' || role === 'member';
}

export function clientStatusLabel(dbStatus: string): string {
    return DB_STATUS_LABEL[dbStatus] ?? dbStatus;
}

export function archivedClientPath(clientName: string): string {
    return `/workspace?clientArchived=${encodeURIComponent(clientName)}`;
}

export function readArchivedClientNotice(search: string): string | null {
    const query = search.startsWith('?') ? search.slice(1) : search;
    const name = new URLSearchParams(query).get('clientArchived')?.trim();
    return name ? name : null;
}

export function notifyClientsChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

/**
 * Archive a client. The row stays, with status inactive (Cancelled), which is
 * how the workspace already removes a client from the active list. Related
 * tasks, time, and deliverables stay attached.
 */
export async function deleteClient(clientId: string, deps: DeleteClientDeps): Promise<Response> {
    if (!isUuid(clientId)) return json({ error: 'Invalid client id' }, 400);

    const auth = await deps.authorize(clientId);
    if (!auth.ok) return json({ error: auth.error }, auth.status);
    if (!canDeleteClient(auth.role)) return json({ error: DELETE_CLIENT_FORBIDDEN }, 403);

    const client = await deps.loadClient(auth.clientId, auth.organizationId);
    if (!client) return json({ error: 'Client not found' }, 404);

    if (client.status !== ARCHIVED_CLIENT_DB_STATUS) {
        const archived = await deps.archiveClient(auth.clientId, auth.organizationId);
        if (archived.error) return json({ error: archived.error }, archived.statusCode ?? 500);
        try {
            await deps.logStatusChange({
                organizationId: auth.organizationId,
                clientId: auth.clientId,
                actorId: auth.userId,
                actorName: auth.actorName,
                clientName: client.name,
                fromStatus: clientStatusLabel(client.status),
                toStatus: ARCHIVED_CLIENT_STATUS,
            });
        } catch {
            console.error('archive client activity log failed');
        }
    }

    return json({
        ok: true,
        archived: true,
        clientName: client.name,
        status: ARCHIVED_CLIENT_STATUS,
    });
}
