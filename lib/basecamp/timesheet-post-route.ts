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
    /** Lets the comment recognize a description that is only the title fallback. */
    taskTitle?: string | null;
    personId: number | null;
    basecampSyncError?: string | null;
    /** 'seo_pm', or the provider this work was imported from. */
    source?: string | null;
    /** Written by every import path, including those that learn no entry id. */
    importFingerprint?: string | null;
    clientCustomFields?: Record<string, unknown>;
}

export interface AdoptableTimesheetEntry {
    id: string | number;
    date?: string | null;
    hours?: string | number | null;
    description?: string | null;
    parent?: { id: string | number; type?: string } | null;
}

export interface AdoptableTimesheetTarget {
    recordingId: string;
    date: string;
    hours: number;
    description: string | null;
}

function normalizedDescription(value: string | null | undefined): string {
    return (value ?? '').trim();
}

function decimalHours(value: string | number | null | undefined): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const hours = Number(value);
    return Number.isFinite(hours) ? Math.round(hours * 100) / 100 : null;
}

/**
 * Recovers from a create whose response was lost: an entry already sitting under
 * the authorized recording with this log's exact date, hours, and description,
 * claimed by no other local time log, is adopted instead of duplicated. Provider
 * IDs are only ever read from server-resolved provenance, never from the caller.
 */
export function selectAdoptableTimesheetEntry(
    candidates: AdoptableTimesheetEntry[],
    target: AdoptableTimesheetTarget,
    claimedEntryIds: Iterable<string | number | null | undefined>,
): string | null {
    const recordingId = numericId(target.recordingId);
    const targetHours = decimalHours(target.hours);
    if (!recordingId || targetHours === null) return null;

    const claimed = new Set(
        [...claimedEntryIds]
            .map(entryId => numericId(entryId))
            .filter((entryId): entryId is string => entryId !== null),
    );
    const targetDescription = normalizedDescription(target.description);

    const matches = candidates.filter(candidate => (
        numericId(candidate.parent?.id ?? null) === recordingId
        && String(candidate.date ?? '').slice(0, 10) === target.date.slice(0, 10)
        && decimalHours(candidate.hours) === targetHours
        && normalizedDescription(candidate.description) === targetDescription
        && numericId(candidate.id) !== null
        && !claimed.has(numericId(candidate.id)!)
    ));

    // Several unclaimed identical entries mean earlier lost responses already
    // duplicated this log. Adopting the oldest stops the duplication growing.
    return matches
        .map(candidate => numericId(candidate.id)!)
        .sort((left, right) => Number(left) - Number(right))[0] ?? null;
}

/**
 * Decides whether a completed sync should refresh the cached project-timesheet
 * recording on the client (clients.custom_fields.basecamp_timesheet_recording_id).
 *
 * That cache only exists to let resolveRecording skip rediscovery of the
 * PROJECT-LEVEL timesheet recording. A task-linked sync resolves to the task's
 * to-do id instead, so caching that here would make the next NON-task sync read
 * a stale to-do as its candidate and attach project time to the wrong recording.
 * Returns a merge patch (never a full custom_fields object, so concurrent keys
 * survive) or null when there is nothing safe to cache.
 */
export function planTimesheetRecordingCacheWrite(
    log: Pick<CanonicalTimeLog, 'clientId' | 'taskBasecampTodoId'>,
    recordingId: string | number | null,
): { patch: { basecamp_timesheet_recording_id: number } } | null {
    if (!log.clientId) return null;
    const recording = numericId(recordingId);
    if (!recording) return null;
    const taskTodoId = numericId(log.taskBasecampTodoId);
    if (taskTodoId !== null && taskTodoId === recording) return null;
    return { patch: { basecamp_timesheet_recording_id: Number(recording) } };
}

interface RecordingCacheMergeArguments {
    p_client_id: string;
    p_organization_id: string;
    p_patch: { basecamp_timesheet_recording_id: number };
}

export async function persistTimesheetRecordingCache(
    log: Pick<CanonicalTimeLog, 'organizationId' | 'clientId' | 'taskBasecampTodoId'>,
    recordingId: string | number | null,
    merge: (
        args: RecordingCacheMergeArguments,
    ) => PromiseLike<{ error: unknown }>,
): Promise<void> {
    const cacheWrite = planTimesheetRecordingCacheWrite(log, recordingId);
    if (!cacheWrite || !log.clientId) return;

    const { error } = await merge({
        p_client_id: log.clientId,
        p_organization_id: log.organizationId,
        p_patch: cacheWrite.patch,
    });
    if (error) throw error;
}

export interface AuthorizedTimeLogContext {
    authorization: Extract<TimeLogAuthorization, { ok: true }>;
    log: CanonicalTimeLog;
    projectId: string | null;
    recordingId: string | null;
    entryId: string | null;
}

export type RecordingCandidateKind = 'task-todo' | 'project-timesheet';

interface TimesheetRecordingProvider {
    getTodo(
        projectId: string,
        todoId: string,
    ): Promise<{ id: string | number } | null>;
    findProjectTimesheetRecordingId(projectId: string): Promise<string | number | null>;
}

/**
 * Verifies a recording candidate according to where it came from. A task link
 * may intentionally target a to-do. The client cache may only target the
 * project-level timesheet recording; if that cache points at a to-do, discard
 * it and rediscover the project recording so the next successful sync heals it.
 */
export async function resolveBasecampTimesheetRecording(
    projectId: string,
    candidateRecordingId: string | null,
    candidateKind: RecordingCandidateKind,
    provider: TimesheetRecordingProvider,
): Promise<string | null> {
    let candidate = numericId(candidateRecordingId);
    if (candidate) {
        const todo = await provider.getTodo(projectId, candidate);
        const isMatchingTodo = numericId(todo?.id) === candidate;
        if (candidateKind === 'task-todo') return isMatchingTodo ? candidate : null;
        if (isMatchingTodo) candidate = null;
    } else if (candidateKind === 'task-todo') {
        return null;
    }

    const projectRecording = numericId(
        await provider.findProjectTimesheetRecordingId(projectId),
    );
    if (!projectRecording) return null;
    return !candidate || candidate === projectRecording ? projectRecording : null;
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
    resolveRecording(
        projectId: string,
        candidateRecordingId: string | null,
        candidateKind: RecordingCandidateKind,
    ): Promise<string | null>;
    performAuthorized(
        body: Record<string, unknown>,
        context: AuthorizedTimeLogContext,
    ): Promise<Response>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function numericId(value: unknown): string | null {
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
            let recordingCandidateKind: RecordingCandidateKind = 'project-timesheet';
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
                    if (taskProjectId === projectId && taskTodoId) {
                        recordingId = taskTodoId;
                        recordingCandidateKind = 'task-todo';
                    }
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
                    recordingCandidateKind,
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
