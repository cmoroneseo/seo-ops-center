import {
    authorizeBasecampProject,
    type BasecampProjectAccessSource,
} from './project-access.ts';

type TimeLogAuthorization =
    | {
        ok: true;
        userId: string;
        actorName: string;
        organizationId: string;
        clientId: string | null;
        timeLogId: string;
        organizationIsInternal: boolean;
        role: 'owner' | 'admin' | 'member' | 'viewer';
        canManageIntegrations: boolean;
    }
    | { ok: false; status: number; error: string };

export interface CanonicalTimeLog {
    id: string;
    organizationId: string;
    clientId: string | null;
    userId: string | null;
    taskId: string | null;
    date: string;
    hours: number;
    description: string | null;
    status: string;
    basecampEntryId: string | number | null;
    basecampRecordingId: string | number | null;
    selectedBasecampProjectId: string | number | null;
    configuredProjectId: string | number | null;
    syncEnabled: boolean;
    timesheetEnabled: boolean;
    cachedRecordingId: string | number | null;
    taskBasecampTodoId: string | number | null;
    taskBasecampProjectId: string | number | null;
    personId: number | null;
    clientCustomFields?: Record<string, unknown>;
}

export interface AuthorizedTimeLogContext {
    authorization: Extract<TimeLogAuthorization, { ok: true }>;
    log: CanonicalTimeLog;
    projectId: string | null;
    recordingId: string | null;
    entryId: string | null;
}

interface Dependencies {
    authorizeTimeLog(timeLogId: unknown): Promise<TimeLogAuthorization>;
    createStore(): {
        getTimeLog(
            timeLogId: string,
            organizationId: string,
            clientId: string | null,
        ): Promise<CanonicalTimeLog | null>;
    };
    createAccessSource(): BasecampProjectAccessSource;
    verifyEntry(
        projectId: string,
        entryId: string,
    ): Promise<{ entryId: string; recordingId: string } | null>;
    resolveRecording(projectId: string, candidateRecordingId: string | null): Promise<string | null>;
    performAuthorized(
        body: Record<string, unknown>,
        context: AuthorizedTimeLogContext,
    ): Promise<Response>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function numericId(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

export function createBasecampTimesheetPost(dependencies: Dependencies) {
    return async function postBasecampTimesheet(req: Request): Promise<Response> {
        try {
            const body = await req.json() as Record<string, unknown>;
            const action = typeof body.action === 'string' ? body.action : '';
            if ((action !== 'sync' && action !== 'remove') || !body.timeLogId) {
                return json({ error: 'Valid action and timeLogId are required' }, 400);
            }

            const authorization = await dependencies.authorizeTimeLog(body.timeLogId);
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            const log = await dependencies.createStore().getTimeLog(
                authorization.timeLogId,
                authorization.organizationId,
                authorization.clientId,
            );
            if (!log) return json({ error: 'Time log not found' }, 404);

            let projectId: string | null;
            let recordingId: string | null = null;
            if (log.clientId) {
                projectId = numericId(log.configuredProjectId);
                if (!projectId) {
                    return json({ error: 'Time log has no authorized Basecamp project' }, 409);
                }
                if (action === 'sync' && (!log.syncEnabled || !log.timesheetEnabled)) {
                    return json({ skipped: true, reason: 'timesheet sync not enabled for this client' });
                }

                const taskProjectId = numericId(log.taskBasecampProjectId);
                const taskTodoId = numericId(log.taskBasecampTodoId);
                if (taskProjectId && taskProjectId !== projectId) {
                    return json({ error: 'Task Basecamp link does not match client configuration' }, 409);
                }
                if (action === 'sync') {
                    if (taskProjectId === projectId && taskTodoId) recordingId = taskTodoId;
                    if (!recordingId) recordingId = numericId(log.cachedRecordingId);
                }
            } else {
                if (!authorization.organizationIsInternal) {
                    return json({ error: 'Internal Basecamp time requires a trusted internal organization manager' }, 403);
                }
                projectId = numericId(log.selectedBasecampProjectId);
                if (!projectId) return json({ error: 'No authorized Basecamp project selected' }, 409);
            }

            const projectAccess = await authorizeBasecampProject(
                {
                    userId: authorization.userId,
                    organizationId: authorization.organizationId,
                    projectId,
                },
                dependencies.createAccessSource(),
            );
            if (!projectAccess.ok) {
                return json({ error: projectAccess.error }, projectAccess.status);
            }

            const canonicalEntryId = numericId(log.basecampEntryId);
            if (action === 'remove') {
                const entryId = numericId(body.entryId);
                if (!entryId || !canonicalEntryId || entryId !== canonicalEntryId) {
                    return json({ error: 'Entry does not belong to this time log' }, 409);
                }
            }

            if (canonicalEntryId) {
                const verifiedEntry = await dependencies.verifyEntry(
                    projectAccess.projectId,
                    canonicalEntryId,
                );
                if (!verifiedEntry || verifiedEntry.entryId !== canonicalEntryId) {
                    return json({ error: 'Basecamp entry could not be verified in the authorized project' }, 409);
                }
                const protectedRecordingId = numericId(log.basecampRecordingId);
                if (!protectedRecordingId) {
                    return json({
                        error: 'Legacy Basecamp entry requires operator provenance audit',
                    }, 409);
                }
                if (protectedRecordingId !== verifiedEntry.recordingId) {
                    return json({ error: 'Basecamp entry recording does not match the protected link' }, 409);
                }
                recordingId = protectedRecordingId;
            } else if (action === 'remove') {
                return json({ error: 'Entry does not belong to this time log' }, 409);
            } else {
                recordingId = await dependencies.resolveRecording(
                    projectAccess.projectId,
                    recordingId,
                );
                if (!recordingId) {
                    return json({ error: 'No verified Basecamp timesheet recording is available' }, 409);
                }
            }

            return dependencies.performAuthorized(body, {
                authorization,
                log,
                projectId: projectAccess.projectId,
                recordingId,
                entryId: canonicalEntryId,
            });
        } catch {
            return json({ error: 'Unable to authorize Basecamp timesheet operation' }, 500);
        }
    };
}
