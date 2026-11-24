import { NO_PROJECT_GROUP } from './project-groups';
import type { PartOfChoice } from '../tasks/part-of';
import type { SessionOrganization } from '../reports/session-org';
import {
    applyStageReorder,
    STAGE_REORDER_NOT_FOUND,
    type StageReorderMove,
    type StageReorderWrite,
} from './stage-reorder';
import { planTaskQualifiesForBasecampPush, type PlanBasecampSyncState } from './basecamp-push';
import type { StageListTask } from './stage-list';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATCHES = 500;

export interface StageReorderDependencies {
    session: () => Promise<SessionOrganization>;
    /** Whether the stage list is on for the session organization. */
    enabled: (organizationId: string) => boolean;
    /** Null when the client is not in the session organization. */
    load: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
    loadProjects?: (organizationId: string, clientId: string) => Promise<Pick<PartOfChoice, 'id'>[]>;
    /** One atomic rewrite of the affected rows. */
    rewrite: (
        organizationId: string,
        clientId: string,
        writes: readonly StageReorderWrite[],
    ) => Promise<StageListTask[]>;
    /**
     * Push a moved task when its parent changed or it qualifies for plan sync.
     */
    pushPlanTask?: (
        taskId: string,
    ) => Promise<PlanBasecampSyncState | null | void> | PlanBasecampSyncState | null | void;
    /**
     * Move one parent's Basecamp steps into the new sibling order.
     * Called for every parent whose children were rewritten.
     */
    syncStepOrder?: (parentTaskId: string) => Promise<void> | void;
}

export type StageReorderResult =
    | { status: 200; body: { tasks: StageListTask[] } }
    | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } };

/**
 * Parents whose checklist may have changed.
 * The dragged row's old parent, its new parent, and any rewritten child.
 * A top-level reorder has no parent and is not included.
 */
export function stepOrderParentIds(
    tasks: readonly StageListTask[],
    move: StageReorderMove,
    writes: readonly StageReorderWrite[],
): string[] {
    if (writes.length === 0) return [];
    const ids: string[] = [];
    const add = (id: string | null | undefined) => {
        if (id && !ids.includes(id)) ids.push(id);
    };
    add(tasks.find(task => task.id === move.taskId)?.parentTaskId);
    add(move.parentTaskId);
    for (const write of writes) add(write.parentTaskId);
    return ids;
}

function readMove(body: unknown): { ok: true; value: StageReorderMove } | { ok: false } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
    const record = body as Record<string, unknown>;
    if (typeof record.taskId !== 'string' || !ID.test(record.taskId.trim())) return { ok: false };
    if (typeof record.index !== 'number' || !Number.isInteger(record.index) || record.index < 0 || record.index > 10000) {
        return { ok: false };
    }
    let parentTaskId: string | null = null;
    if (record.parentTaskId != null && record.parentTaskId !== '') {
        if (typeof record.parentTaskId !== 'string' || !ID.test(record.parentTaskId.trim())) return { ok: false };
        parentTaskId = record.parentTaskId.trim();
    }
    const projectGroup = record.projectGroup;
    if (projectGroup !== undefined && (typeof projectGroup !== 'string'
        || (projectGroup !== NO_PROJECT_GROUP && !ID.test(projectGroup)))) return { ok: false };
    return {
        ok: true,
        value: {
            taskId: record.taskId.trim(),
            parentTaskId,
            index: record.index,
            ...(projectGroup ? { projectGroup } : {}),
        },
    };
}

/**
 * Move one task for the signed-in organization.
 * The client id is only a path key. Organization and role come from the
 * session. Positions are computed here. A flag that is off never writes,
 * and viewers never write. The rewrite runs once for every affected row.
 */
export async function reorderStageTasks(
    clientIdInput: unknown,
    body: unknown,
    dependencies: StageReorderDependencies,
): Promise<StageReorderResult> {
    const clientId = typeof clientIdInput === 'string' ? clientIdInput.trim() : '';
    if (!ID.test(clientId)) return { status: 400, body: { error: 'Not found' } };

    const session = await dependencies.session();
    if (!session.ok) return { status: session.status, body: { error: session.error } };
    if (!dependencies.enabled(session.organizationId)) return { status: 404, body: { error: 'Not found' } };
    if (session.role === 'viewer') return { status: 403, body: { error: 'Forbidden' } };

    const parsed = readMove(body);
    if (!parsed.ok) return { status: 400, body: { error: 'Choose a task to move.' } };

    try {
        const tasks = await dependencies.load(session.organizationId, clientId);
        if (!tasks) return { status: 404, body: { error: 'Not found' } };

        parsed.value.projects = await dependencies.loadProjects?.(session.organizationId, clientId);
        const plan = applyStageReorder(tasks, parsed.value);
        if (!plan.ok) {
            const status = plan.error === STAGE_REORDER_NOT_FOUND ? 404 : 400;
            return { status, body: { error: plan.error } };
        }
        if (plan.writes.length > MAX_PATCHES) return { status: 400, body: { error: 'Choose a task to move.' } };

        let updated: StageListTask[] = [];
        if (plan.writes.length > 0) {
            updated = await dependencies.rewrite(session.organizationId, clientId, plan.writes);
            if (updated.length !== plan.writes.length) return { status: 500, body: { error: 'Could not move tasks' } };
        }
        const current = tasks.find(task => task.id === parsed.value.taskId);
        const dueDate = current?.dueDate ?? null;
        const parentChanged = (current?.parentTaskId ?? null) !== parsed.value.parentTaskId;
        const qualifies = planTaskQualifiesForBasecampPush({ dueDate, initiativeId: current?.initiativeId });
        if (plan.writes.length && (parentChanged || qualifies)) {
            try {
                const sync = await dependencies.pushPlanTask?.(parsed.value.taskId);
                if (sync && typeof sync === 'object') {
                    updated = updated.map(task => task.id === parsed.value.taskId
                        ? { ...task, basecampSync: sync }
                        : task);
                    if (!updated.some(task => task.id === parsed.value.taskId) && current) {
                        updated = [...updated, { ...current, dueDate, basecampSync: sync }];
                    }
                }
            } catch {
                // The move is saved. The push records its own failure.
            }
        }
        // Sibling order changed. Push the checklist even when the dragged
        // row itself does not qualify for a to-do update. A matching
        // Basecamp order makes no reposition calls.
        for (const parentId of stepOrderParentIds(tasks, parsed.value, plan.writes)) {
            try {
                await dependencies.syncStepOrder?.(parentId);
            } catch {
                // The move is saved. The step-order push records its own failure.
            }
        }
        return { status: 200, body: { tasks: updated } };
    } catch {
        return { status: 500, body: { error: 'Could not move tasks' } };
    }
}
