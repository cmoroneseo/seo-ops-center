import type { SessionOrganization } from '../reports/session-org';
import { isTaskStage } from '../tasks/stage';
import { taskCreateRow } from '../tasks/create-row';
import type { TaskStage } from '../types';
import { nextStagePositions } from './stage-add';
import { stageAddTitlesError, STAGE_ADD_MAX_TITLE_LENGTH } from './stage-add-lines';
import type { StageAddParent } from './stage-add-db';
import type { StageListTask } from './stage-list';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StageAddDependencies {
    session: () => Promise<SessionOrganization>;
    /** Whether the stage list is on for the session organization. */
    enabled: (organizationId: string) => boolean;
    /**
     * Basecamp push follows createTask: only when this is true.
     * The add bar has no sync toggle, and the route leaves it false.
     * That is the same default as the Create Task dialog.
     */
    syncToBasecamp?: boolean;
    /** Fire-and-forget. The same hook createTask uses when sync is requested. */
    pushToBasecamp?: (taskId: string) => void;
    now?: () => string;
    /** False when the client is not in the session organization. */
    loadClient: (organizationId: string, clientId: string) => Promise<boolean>;
    loadParent: (
        organizationId: string,
        clientId: string,
        parentTaskId: string,
    ) => Promise<StageAddParent | null>;
    maxPosition: (
        organizationId: string,
        clientId: string,
        stage: TaskStage,
        parentTaskId: string | null,
    ) => Promise<number | null>;
    insertTasks: (rows: Record<string, unknown>[]) => Promise<StageListTask[]>;
    logCreated?: (event: {
        organizationId: string;
        clientId: string;
        userId: string;
        task: StageListTask;
        parentTitle?: string;
    }) => Promise<void>;
}

export type StageAddResult =
    | { status: 200; body: { tasks: StageListTask[] } }
    | { status: 400 | 401 | 403 | 404 | 500; body: { error: string } };

interface StageAddInput {
    stage: TaskStage;
    titles: string[];
    parentTaskId: string | null;
}

function readStageAddBody(body: unknown): { ok: true; value: StageAddInput } | { ok: false; error: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Enter a title.' };
    const record = body as Record<string, unknown>;
    if (!isTaskStage(record.stage)) return { ok: false, error: 'Choose a stage.' };
    if (!Array.isArray(record.titles)) return { ok: false, error: 'Enter a title.' };

    const titles: string[] = [];
    for (const title of record.titles) {
        if (typeof title !== 'string') return { ok: false, error: 'Enter a title.' };
        const trimmed = title.trim();
        if (!trimmed || trimmed.length > STAGE_ADD_MAX_TITLE_LENGTH || /[\r\n]/.test(title)) {
            if (trimmed.length > STAGE_ADD_MAX_TITLE_LENGTH) {
                return { ok: false, error: `Keep each title under ${STAGE_ADD_MAX_TITLE_LENGTH} characters.` };
            }
            return { ok: false, error: 'Enter a title.' };
        }
        titles.push(trimmed);
    }
    const titlesError = stageAddTitlesError(titles);
    if (titlesError) return { ok: false, error: titlesError };

    let parentTaskId: string | null = null;
    if (record.parentTaskId != null && record.parentTaskId !== '') {
        if (typeof record.parentTaskId !== 'string' || !ID.test(record.parentTaskId.trim())) {
            return { ok: false, error: 'Not found' };
        }
        parentTaskId = record.parentTaskId.trim();
    }
    return { ok: true, value: { stage: record.stage, titles, parentTaskId } };
}

function orderCreated(rows: readonly Record<string, unknown>[], tasks: readonly StageListTask[]): StageListTask[] {
    const byPosition = new Map<number, StageListTask[]>();
    for (const task of tasks) {
        if (task.position == null) continue;
        const list = byPosition.get(task.position) ?? [];
        list.push(task);
        byPosition.set(task.position, list);
    }
    const ordered: StageListTask[] = [];
    for (const row of rows) {
        if (typeof row.position !== 'number') continue;
        const task = byPosition.get(row.position)?.shift();
        if (task) ordered.push(task);
    }
    return ordered;
}

/**
 * Create tasks in one stage for the signed-in organization.
 * The client id is only a path key. Organization, role, and user id come from
 * the session. A flag that is off never writes. Viewers never write.
 */
export async function createStageTasks(
    clientIdInput: unknown,
    body: unknown,
    dependencies: StageAddDependencies,
): Promise<StageAddResult> {
    const clientId = typeof clientIdInput === 'string' ? clientIdInput.trim() : '';
    if (!ID.test(clientId)) return { status: 400, body: { error: 'Not found' } };

    const session = await dependencies.session();
    if (!session.ok) return { status: session.status, body: { error: session.error } };
    if (!dependencies.enabled(session.organizationId)) return { status: 404, body: { error: 'Not found' } };
    if (session.role === 'viewer') return { status: 403, body: { error: 'Forbidden' } };

    const parsed = readStageAddBody(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

    try {
        const allowed = await dependencies.loadClient(session.organizationId, clientId);
        if (!allowed) return { status: 404, body: { error: 'Not found' } };

        let stage = parsed.value.stage;
        let parentTitle: string | undefined;
        if (parsed.value.parentTaskId) {
            const parent = await dependencies.loadParent(session.organizationId, clientId, parsed.value.parentTaskId);
            if (!parent) return { status: 404, body: { error: 'Not found' } };
            if (parent.parentTaskId) return { status: 400, body: { error: 'That task cannot have subtasks' } };
            if (!isTaskStage(parent.stage)) return { status: 500, body: { error: 'Could not add tasks' } };
            stage = parent.stage;
            parentTitle = parent.title;
        }

        const max = await dependencies.maxPosition(
            session.organizationId,
            clientId,
            stage,
            parsed.value.parentTaskId,
        );
        const positions = nextStagePositions(max, parsed.value.titles.length);
        const now = dependencies.now?.() ?? new Date().toISOString();
        const rows = parsed.value.titles.map((title, index) => ({
            ...taskCreateRow({
                organizationId: session.organizationId,
                clientId,
                title,
                stage,
                position: positions[index],
                parentTaskId: parsed.value.parentTaskId ?? undefined,
                createdBy: session.userId,
                status: 'todo',
                priority: 'medium',
                sortOrder: index,
            }),
            status_history: [{ status: 'todo', at: now, by: session.userId }],
        }));

        const inserted = await dependencies.insertTasks(rows);
        const tasks = orderCreated(rows, inserted);
        if (tasks.length !== parsed.value.titles.length) return { status: 500, body: { error: 'Could not add tasks' } };

        if (dependencies.syncToBasecamp) {
            for (const task of tasks) {
                try {
                    dependencies.pushToBasecamp?.(task.id);
                } catch {
                    // createTask reports a push failure on its own and still returns the task.
                }
            }
        }
        if (dependencies.logCreated) {
            for (const task of tasks) {
                try {
                    await dependencies.logCreated({
                        organizationId: session.organizationId,
                        clientId,
                        userId: session.userId,
                        task,
                        ...(parentTitle ? { parentTitle } : {}),
                    });
                } catch {
                    // Same as createTask: the feed is best-effort and does not undo the insert.
                }
            }
        }
        return { status: 200, body: { tasks } };
    } catch {
        return { status: 500, body: { error: 'Could not add tasks' } };
    }
}
