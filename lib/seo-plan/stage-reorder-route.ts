import type { SessionOrganization } from '../reports/session-org';
import { isTaskStage } from '../tasks/stage';
import {
    applyStageReorder,
    STAGE_REORDER_NOT_FOUND,
    type StageReorderMove,
    type StageReorderWrite,
} from './stage-reorder';
import { planTaskQualifiesForBasecampPush, type PlanBasecampSyncState } from './basecamp-push';
import type { StageListTask } from './stage-list';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PATCHES = 500;

export interface StageReorderDependencies {
    session: () => Promise<SessionOrganization>;
    /** Whether the stage list is on for the session organization. */
    enabled: (organizationId: string) => boolean;
    /** Null when the client is not in the session organization. */
    load: (organizationId: string, clientId: string) => Promise<StageListTask[] | null>;
    /** One atomic rewrite of the affected rows. */
    rewrite: (
        organizationId: string,
        clientId: string,
        writes: readonly StageReorderWrite[],
    ) => Promise<StageListTask[]>;
    /**
     * Write tasks.due_date for the dragged row. Null clears it.
     */
    setDue?: (
        organizationId: string,
        clientId: string,
        taskId: string,
        dueDate: string | null,
    ) => Promise<void>;
    /**
     * Push a task that qualifies after the move. Undated backlog moves are
     * not passed here. The same function create uses.
     */
    pushPlanTask?: (
        taskId: string,
    ) => Promise<PlanBasecampSyncState | null | void> | PlanBasecampSyncState | null | void;
}

export type StageReorderResult =
    | { status: 200; body: { tasks: StageListTask[] } }
    | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } };

function readDueDate(record: Record<string, unknown>): { ok: true; dueDate?: string | null } | { ok: false } {
    if (!Object.hasOwn(record, 'dueDate')) return { ok: true };
    if (record.dueDate === null) return { ok: true, dueDate: null };
    if (typeof record.dueDate === 'string' && DAY.test(record.dueDate)) return { ok: true, dueDate: record.dueDate };
    return { ok: false };
}

function readMove(body: unknown): { ok: true; value: StageReorderMove } | { ok: false } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
    const record = body as Record<string, unknown>;
    if (typeof record.taskId !== 'string' || !ID.test(record.taskId.trim())) return { ok: false };
    if (!isTaskStage(record.stage)) return { ok: false };
    if (typeof record.index !== 'number' || !Number.isInteger(record.index) || record.index < 0 || record.index > 10000) {
        return { ok: false };
    }
    let parentTaskId: string | null = null;
    if (record.parentTaskId != null && record.parentTaskId !== '') {
        if (typeof record.parentTaskId !== 'string' || !ID.test(record.parentTaskId.trim())) return { ok: false };
        parentTaskId = record.parentTaskId.trim();
    }
    const due = readDueDate(record);
    if (!due.ok) return { ok: false };
    return {
        ok: true,
        value: {
            taskId: record.taskId.trim(),
            stage: record.stage,
            parentTaskId,
            index: record.index,
            ...(due.dueDate !== undefined ? { dueDate: due.dueDate } : {}),
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
        if (parsed.value.dueDate !== undefined) {
            if (!dependencies.setDue) return { status: 500, body: { error: 'Could not move tasks' } };
            await dependencies.setDue(session.organizationId, clientId, parsed.value.taskId, parsed.value.dueDate);
            const dueDate = parsed.value.dueDate;
            if (updated.some(task => task.id === parsed.value.taskId)) {
                updated = updated.map(task => task.id === parsed.value.taskId ? { ...task, dueDate } : task);
            } else if (current) {
                updated = [...updated, { ...current, dueDate }];
            }
        }
        const dueDate = parsed.value.dueDate !== undefined
            ? parsed.value.dueDate
            : (current?.dueDate ?? null);
        // A parent change has to relink Basecamp even when the task itself
        // does not qualify for a push. An undated backlog row would otherwise
        // keep a flat to-do after Move under.
        const parentChanged = (current?.parentTaskId ?? null) !== parsed.value.parentTaskId;
        const qualifies = planTaskQualifiesForBasecampPush({ stage: parsed.value.stage, dueDate });
        if (parentChanged || qualifies) {
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
        return { status: 200, body: { tasks: updated } };
    } catch {
        return { status: 500, body: { error: 'Could not move tasks' } };
    }
}
