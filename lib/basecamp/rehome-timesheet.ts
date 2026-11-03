/**
 * Time logged before a task has a Basecamp to-do either lands on the project
 * timesheet or never leaves SEO Ops. When the to-do is linked, move the
 * project entries onto it and create the hours that never synced.
 *
 * A crash between those steps is safe to retry. The new entry is adopted
 * instead of duplicated, and deleting an entry Basecamp has already removed
 * counts as success.
 */

import { selectAdoptableTimesheetEntry, type AdoptableTimesheetEntry } from './timesheet-post-route.ts';

export interface ProjectTimesheetLog {
    id: string;
    /** Null when the hours were saved here and never reached Basecamp. */
    entryId: string | null;
    recordingId: string | null;
    date: string;
    hours: number;
    description: string | null;
    personId: number | null;
}

export interface RehomeTimesheetDeps {
    listLogs(taskId: string, organizationId: string): Promise<ProjectTimesheetLog[]>;
    projectTimesheetRecordingId(projectId: string): Promise<string | null>;
    listEntries(projectId: string): Promise<AdoptableTimesheetEntry[]>;
    claimedEntryIds(
        organizationId: string,
        entryIds: Array<string | number>,
    ): Promise<Array<string | number | null | undefined>>;
    createEntry(
        recordingId: string,
        fields: { date: string; hours: number; description?: string; personId?: number },
    ): Promise<{ id: string | number } | null>;
    /** True when the entry is gone, including when it was already gone. */
    deleteEntry(entryId: string): Promise<boolean>;
    /**
     * Point the log at the to-do entry only while it still names the project
     * entry. False means another write won; the caller must not count a move.
     */
    saveLink(input: {
        logId: string;
        organizationId: string;
        /** Null when this log has no Basecamp entry yet. */
        previousEntryId: string | null;
        entryId: string;
        recordingId: string;
        projectId: string;
    }): Promise<boolean>;
}

export async function rehomeProjectTimesheetEntries(
    input: { taskId: string; organizationId: string; projectId: string; todoId: string },
    deps: RehomeTimesheetDeps,
): Promise<{ moved: number; failed: number }> {
    const projectRecording = numeric(await deps.projectTimesheetRecordingId(input.projectId));
    const todoId = numeric(input.todoId);
    if (!projectRecording || !todoId || projectRecording === todoId) return { moved: 0, failed: 0 };

    const logs = (await deps.listLogs(input.taskId, input.organizationId))
        .filter(log => {
            const entryId = numeric(log.entryId);
            const recordingId = numeric(log.recordingId);
            if (!entryId) return log.hours > 0;
            return recordingId === projectRecording;
        });
    if (logs.length === 0) return { moved: 0, failed: 0 };

    const entries = await deps.listEntries(input.projectId);
    const claimed = new Set(
        (await deps.claimedEntryIds(input.organizationId, entries.map(entry => entry.id)))
            .map(entryId => numeric(entryId))
            .filter((entryId): entryId is string => entryId !== null),
    );

    let moved = 0;
    let failed = 0;
    for (const log of logs) {
        const entryId = numeric(log.entryId);
        const adopted = selectAdoptableTimesheetEntry(entries, {
            recordingId: todoId,
            date: log.date.slice(0, 10),
            hours: log.hours,
            description: log.description,
        }, claimed);
        const created = adopted
            ? { id: adopted }
            : await deps.createEntry(todoId, {
                date: log.date.slice(0, 10),
                hours: log.hours,
                ...(log.description ? { description: log.description } : {}),
                ...(log.personId ? { personId: log.personId } : {}),
            });
        const newId = created ? numeric(created.id) : null;
        if (!newId) {
            failed += 1;
            continue;
        }
        claimed.add(newId);
        if (!adopted) {
            entries.push({
                id: newId,
                date: log.date.slice(0, 10),
                hours: log.hours,
                description: log.description,
                parent: { id: todoId, type: 'Todo' },
            });
        }
        if (entryId && !await deps.deleteEntry(entryId)) {
            failed += 1;
            continue;
        }
        const saved = await deps.saveLink({
            logId: log.id,
            organizationId: input.organizationId,
            previousEntryId: entryId,
            entryId: newId,
            recordingId: todoId,
            projectId: input.projectId,
        });
        if (!saved) {
            failed += 1;
            continue;
        }
        moved += 1;
    }
    return { moved, failed };
}

function numeric(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    return /^\d+$/.test(text) ? text : null;
}
