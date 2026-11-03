import { timeLogCommentBody, commentTargetFor } from './time-log-comment.ts';
import { stampPushedEntryIdentity } from './timesheet-push-identity.ts';
import {
    refuseProviderCreate,
    PROVIDER_CREATE_REFUSAL_MESSAGE,
} from './provider-origin.ts';
import {
    selectAdoptableTimesheetEntry,
    type AdoptableTimesheetEntry,
    type AuthorizedTimeLogContext,
    type CanonicalTimeLog,
} from './timesheet-post-route.ts';
import type { ProviderTimesheetEntry } from './timesheet-entry.ts';

export interface TimesheetSyncIO {
    isConfigured(): boolean;
    deleteEntry(entryId: string | number): Promise<boolean>;
    updateEntry(
        entryId: string | number,
        fields: { date: string; hours: number; description?: string; personId?: number },
    ): Promise<'ok' | 'not_found' | 'error'>;
    createEntry(
        recordingId: number,
        fields: { date: string; hours: number; description?: string; personId?: number },
    ): Promise<{ id: number; appUrl?: string } | null>;
    listEntries(projectId: string): Promise<AdoptableTimesheetEntry[]>;
    readEntry(
        projectId: string,
        entryId: string,
    ): Promise<ProviderTimesheetEntry | 'missing' | 'unavailable'>;
    createComment(projectId: string, todoId: string, content: string): Promise<number | null>;
    clearProviderLink(log: CanonicalTimeLog): Promise<void>;
    recordError(log: CanonicalTimeLog, message: string): Promise<void>;
    markSynced(
        log: CanonicalTimeLog,
        patch: { entryId?: string | number; projectId: string; recordingId: string | number },
    ): Promise<void>;
    writeFingerprint(log: CanonicalTimeLog, fingerprint: string): Promise<string | null>;
    cacheRecording(log: CanonicalTimeLog, recordingId: string | number | null): Promise<void>;
    claimedEntryIds(
        organizationId: string,
        entryIds: Array<string | number>,
    ): Promise<Array<string | number | null | undefined>>;
}

/**
 * The create-or-update the UI's timesheet route runs after the shared
 * authorization gate. Bot time calls this same function.
 */
export function createTimesheetPerformer(io: TimesheetSyncIO) {
    return async function performAuthorizedTimesheet(
        body: Record<string, unknown>,
        context: AuthorizedTimeLogContext,
    ): Promise<Response> {
        if (!io.isConfigured()) {
            return Response.json({ error: 'Basecamp not configured', configured: false }, { status: 503 });
        }

        const { log } = context;
        if (body.action === 'remove') {
            const ok = await io.deleteEntry(context.entryId!);
            if (ok) await io.clearProviderLink(log);
            return Response.json({ success: ok });
        }

        if (log.status !== 'logged' || !(log.hours > 0)) {
            return Response.json({ skipped: true, reason: 'not a logged entry with hours' });
        }

        const failSync = async (message: string) => {
            await io.recordError(log, message);
            return Response.json({ success: false, error: message });
        };
        const projectId = context.projectId!;
        const stampIdentity = (entryId: string | number) => stampPushedEntryIdentity({
            readEntry: (pid, eid) => io.readEntry(pid, eid),
            writeFingerprint: fingerprint => io.writeFingerprint(log, fingerprint),
        }, String(projectId), String(entryId));
        const entryFields = {
            date: log.date.slice(0, 10),
            hours: log.hours,
            description: log.description || undefined,
            personId: log.personId || undefined,
        };

        if (log.basecampEntryId) {
            const result = await io.updateEntry(log.basecampEntryId, entryFields);
            if (result === 'ok') {
                await io.markSynced(log, {
                    projectId,
                    recordingId: context.recordingId!,
                });
                await stampIdentity(log.basecampEntryId);
                return Response.json({ success: true, entryId: log.basecampEntryId });
            }
            if (result === 'error') {
                return failSync('Basecamp rejected the update — check the entry in Basecamp.');
            }
        } else if (body.createIfMissing !== true) {
            return Response.json({ skipped: true, reason: 'not synced yet' });
        }

        const refusal = refuseProviderCreate(log);
        if (refusal) {
            return Response.json(
                { skipped: true, reason: PROVIDER_CREATE_REFUSAL_MESSAGE[refusal] },
            );
        }

        const recordingId = Number(context.recordingId);
        await io.cacheRecording(log, context.recordingId);

        let adoptedEntryId: string | null = null;
        const priorCandidates = log.basecampSyncError
            ? await io.listEntries(projectId)
            : [];
        if (priorCandidates.length > 0) {
            const claimedEntryIds = await io.claimedEntryIds(
                log.organizationId,
                priorCandidates.map(entry => entry.id),
            );
            adoptedEntryId = selectAdoptableTimesheetEntry(priorCandidates, {
                recordingId: String(recordingId),
                date: entryFields.date,
                hours: entryFields.hours,
                description: log.description,
            }, claimedEntryIds);
        }

        const created = adoptedEntryId
            ? { id: Number(adoptedEntryId), appUrl: undefined as string | undefined }
            : await io.createEntry(recordingId, entryFields);
        if (!created) {
            return failSync('Basecamp rejected the entry — check that the Timesheet tool is enabled on the project.');
        }

        await io.markSynced(log, {
            entryId: created.id,
            projectId,
            recordingId,
        });
        await stampIdentity(created.id);

        const taskTodoId = commentTargetFor(log, projectId);
        if (taskTodoId) {
            const commentBody = timeLogCommentBody({
                description: log.description,
                taskTitle: log.taskTitle ?? null,
            });
            if (commentBody) {
                try {
                    await io.createComment(projectId, taskTodoId, commentBody);
                } catch (err) {
                    console.error('[Basecamp timesheet] comment failed:', err);
                }
            }
        }

        return Response.json({ success: true, entryId: created.id, appUrl: created.appUrl });
    };
}
