/**
 * One-off repair: nest Basecamp to-dos that were pushed before their task
 * had a parent. Organization and role come from the session. `dryRun` is
 * required so a request cannot write by accident.
 *
 * Dry run (no creates, no links, no trashes):
 *   POST /api/seo-plan/basecamp-relink
 *   { "clientId": "<client uuid>", "parentTaskId": "<parent task uuid>", "dryRun": true }
 *
 * Real run, one parent first:
 *   { "clientId": "<client uuid>", "parentTaskId": "<parent task uuid>", "dryRun": false }
 *
 * Omit parentTaskId to cover every top-level task on that client.
 * Owner or admin only. The client must belong to the signed-in organization.
 *
 * Each result includes `completion`: whether the child is completed, whether
 * the step will be completed, whether the parent to-do is completed, and
 * whether this run reopens that parent and completes it again. A dry run
 * reports those flags and does not reopen, complete, create, link, or trash.
 * Trash is always the recoverable recording status, never a delete.
 */

import type { SessionOrganization } from '../reports/session-org';
import {
    relinkChildren,
    type BasecampNestDependencies,
    type NestResult,
    type NestTask,
    type RelinkParent,
} from './basecamp-nest';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RelinkSnapshot {
    clientId: string;
    projectId: string | null;
    parents: RelinkParent[];
    claimedRecordingIds: string[];
}

export interface RelinkLogLine {
    clientId: string;
    parentTaskId: string | null;
    taskId: string;
    title: string;
    dryRun: boolean;
    action: NestResult['action'];
    create: NestResult['create'];
    reusedRecordingId: string | null;
    trashRecordingId: string | null;
    linkedRecordingId: string | null;
    message: string | null;
    completion: NestResult['completion'];
}

export interface BasecampRelinkDependencies {
    session: () => Promise<SessionOrganization>;
    /**
     * Null when the client is not in the organization.
     * 400 when parentTaskId is not a top-level task on that client.
     */
    load: (
        organizationId: string,
        clientId: string,
        parentTaskId: string | null,
    ) => Promise<{ ok: true; snapshot: RelinkSnapshot } | { ok: false; status: 400 | 404; error: string }>;
    nesting: (snapshot: RelinkSnapshot) => BasecampNestDependencies;
    log: (line: RelinkLogLine) => void;
}

export type BasecampRelinkResult = {
    status: number;
    body: Record<string, unknown>;
};

export interface RelinkTaskRow {
    id: string;
    title: string;
    parentTaskId: string | null;
    basecampTodoId: string | null;
    pendingTrashId: string | null;
    /** `done` is carried onto the Basecamp step. */
    status?: string | null;
}

/** Group loaded tasks into the parents the relink walks. One level only. */
export function buildRelinkParents(
    rows: readonly RelinkTaskRow[],
    parentTaskId: string | null,
): { ok: true; parents: RelinkParent[]; claimedRecordingIds: string[] } | { ok: false; status: 400 | 404; error: string } {
    const claimed = rows.flatMap(row => row.basecampTodoId ? [row.basecampTodoId] : []);
    const byParent = new Map<string, NestTask[]>();
    for (const row of rows) {
        if (!row.parentTaskId) continue;
        const children = byParent.get(row.parentTaskId) ?? [];
        children.push({
            id: row.id,
            title: row.title,
            basecampTodoId: row.basecampTodoId,
            pendingTrashId: row.pendingTrashId,
            completed: row.status === 'done',
        });
        byParent.set(row.parentTaskId, children);
    }
    if (parentTaskId) {
        const parent = rows.find(row => row.id === parentTaskId);
        if (!parent) return { ok: false, status: 404, error: 'Not found' };
        if (parent.parentTaskId) return { ok: false, status: 400, error: 'Choose a top-level task.' };
        return {
            ok: true,
            claimedRecordingIds: claimed,
            parents: [{
                id: parent.id,
                basecampTodoId: parent.basecampTodoId,
                completed: parent.status === 'done',
                children: byParent.get(parent.id) ?? [],
            }],
        };
    }
    const parents = rows
        .filter(row => !row.parentTaskId)
        .map(row => ({
            id: row.id,
            basecampTodoId: row.basecampTodoId,
            completed: row.status === 'done',
            children: byParent.get(row.id) ?? [],
        }));
    return { ok: true, parents, claimedRecordingIds: claimed };
}

function readBody(body: unknown): { ok: true; clientId: string; parentTaskId: string | null; dryRun: boolean } | { ok: false; error: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Choose a client.' };
    const record = body as Record<string, unknown>;
    if (typeof record.clientId !== 'string' || !ID.test(record.clientId.trim())) return { ok: false, error: 'Choose a client.' };
    if (typeof record.dryRun !== 'boolean') return { ok: false, error: 'Set dryRun to true or false.' };
    let parentTaskId: string | null = null;
    if (record.parentTaskId != null && record.parentTaskId !== '') {
        if (typeof record.parentTaskId !== 'string' || !ID.test(record.parentTaskId.trim())) {
            return { ok: false, error: 'Choose a parent task.' };
        }
        parentTaskId = record.parentTaskId.trim();
    }
    return { ok: true, clientId: record.clientId.trim(), parentTaskId, dryRun: record.dryRun };
}

function logLine(clientId: string, dryRun: boolean, result: NestResult): RelinkLogLine {
    return {
        clientId,
        parentTaskId: result.parentTaskId,
        taskId: result.taskId,
        title: result.title,
        dryRun,
        action: result.action,
        create: result.create,
        reusedRecordingId: result.reusedRecordingId,
        trashRecordingId: result.trashRecordingId,
        linkedRecordingId: result.linkedRecordingId,
        message: result.message,
        completion: result.completion,
    };
}

/**
 * Repair flat children for one client.
 * Viewers and members are refused. A dry run reads Basecamp and writes nothing.
 */
export async function relinkBasecampChildren(
    body: unknown,
    dependencies: BasecampRelinkDependencies,
): Promise<BasecampRelinkResult> {
    const session = await dependencies.session();
    if (!session.ok) return { status: session.status, body: { error: session.error } };
    if (session.role !== 'owner' && session.role !== 'admin') {
        return { status: 403, body: { error: 'Forbidden' } };
    }

    const parsed = readBody(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

    let loaded: Awaited<ReturnType<BasecampRelinkDependencies['load']>>;
    try {
        loaded = await dependencies.load(session.organizationId, parsed.clientId, parsed.parentTaskId);
    } catch {
        return { status: 500, body: { error: 'Could not relink Basecamp subtasks' } };
    }
    if (!loaded.ok) return { status: loaded.status, body: { error: loaded.error } };
    if (!loaded.snapshot.projectId) {
        return { status: 409, body: { error: 'This client has no Basecamp project.' } };
    }

    let results: NestResult[];
    try {
        results = await relinkChildren({
            projectId: loaded.snapshot.projectId,
            dryRun: parsed.dryRun,
            parents: loaded.snapshot.parents,
            claimedRecordingIds: loaded.snapshot.claimedRecordingIds,
        }, dependencies.nesting(loaded.snapshot));
    } catch {
        return { status: 500, body: { error: 'Could not relink Basecamp subtasks' } };
    }

    const lines = results.map(result => logLine(parsed.clientId, parsed.dryRun, result));
    for (const line of lines) dependencies.log(line);
    return {
        status: 200,
        body: {
            dryRun: parsed.dryRun,
            clientId: parsed.clientId,
            parentTaskId: parsed.parentTaskId,
            results: lines,
        },
    };
}
