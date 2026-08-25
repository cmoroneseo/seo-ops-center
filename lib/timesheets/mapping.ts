import type { TimeLogImportStatus, TimeLogSource } from '../types.ts';

/**
 * Human resolution of an unmapped imported entry.
 *
 * The importer refuses to guess a client, task, or member. This is the other
 * half of that contract: a manager states the mapping explicitly, and every
 * referenced record is re-checked against the actor's organization here — a
 * mapping must never be able to pull a row across a tenant boundary.
 */

export interface MappingRequest {
    timeLogId: string;
    clientId: string;
    taskId: string | null;
    userId: string;
}

export interface MappingContext {
    organizationId: string;
    actorUserId: string;
    now: string;
    log: {
        id: string;
        organizationId: string;
        importStatus: TimeLogImportStatus;
        source: TimeLogSource;
    };
    /** Resolved from the database, or null when the id does not exist. */
    client: { id: string; organizationId: string } | null;
    task: { id: string; organizationId: string; clientId: string | null } | null;
    member: { userId: string; organizationId: string } | null;
}

export interface MappingPatch {
    client_id: string;
    task_id: string | null;
    user_id: string;
    import_status: 'mapped';
    mapped_by: string;
    mapped_at: string;
}

export type MappingResult =
    | { ok: true; patch: MappingPatch }
    | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export function buildMappingUpdate(
    context: MappingContext,
    request: MappingRequest,
): MappingResult {
    if (context.log.organizationId !== context.organizationId) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }
    if (context.log.importStatus !== 'needs_review') {
        return {
            ok: false,
            status: 409,
            error: 'Only entries awaiting review can be mapped',
        };
    }

    if (!request.clientId) {
        return { ok: false, status: 400, error: 'Select a client' };
    }
    if (!request.userId) {
        return { ok: false, status: 400, error: 'Select a team member' };
    }

    if (!context.client) {
        return { ok: false, status: 404, error: 'Client not found' };
    }
    if (context.client.organizationId !== context.organizationId) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (!context.member) {
        return { ok: false, status: 404, error: 'Team member not found' };
    }
    if (context.member.organizationId !== context.organizationId) {
        return { ok: false, status: 403, error: 'Forbidden' };
    }

    if (request.taskId) {
        if (!context.task) {
            return { ok: false, status: 404, error: 'Task not found' };
        }
        if (context.task.organizationId !== context.organizationId) {
            return { ok: false, status: 403, error: 'Forbidden' };
        }
        if (context.task.clientId !== request.clientId) {
            return {
                ok: false,
                status: 400,
                error: 'That task belongs to a different client',
            };
        }
    }

    return {
        ok: true,
        patch: {
            client_id: request.clientId,
            task_id: request.taskId ?? null,
            user_id: request.userId,
            import_status: 'mapped',
            mapped_by: context.actorUserId,
            mapped_at: context.now,
        },
    };
}
