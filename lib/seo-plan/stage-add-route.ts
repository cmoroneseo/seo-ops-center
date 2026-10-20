import type { SessionOrganization } from '../reports/session-org';
import { isTaskStage } from '../tasks/stage';
import { taskCreateRow } from '../tasks/create-row';
import type { TaskStage } from '../types';
import { nextStagePositions } from './stage-add';
import { stageAddTitlesError, STAGE_ADD_MAX_TITLE_LENGTH } from './stage-add-lines';
import { subtaskLineDrafts, subtaskLinesError } from '../tasks/live-url';
import type { StageAddParent } from './stage-add-db';
import { planTaskQualifiesForBasecampPush, type PlanBasecampSyncState } from './basecamp-push';
import type { StageListTask } from './stage-list';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StageAddDependencies {
    session: () => Promise<SessionOrganization>;
    /** Whether the stage list is on for the session organization. */
    enabled: (organizationId: string) => boolean;
    /**
     * Push one task that already qualifies (due date, or it left Backlog).
     * Undated backlog tasks are not passed here. A returned sync state is
     * copied onto the task so a failure dot can render without a reload.
     */
    pushToBasecamp?: (taskId: string) => void | PlanBasecampSyncState | null | Promise<void | PlanBasecampSyncState | null>;
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
    /** Best-effort undo when a later insert in the same add fails. */
    deleteTasks?: (ids: string[]) => Promise<void>;
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

interface StageAddItem {
    title: string;
    depth: 0 | 1;
}

interface StageAddInput {
    stage: TaskStage;
    titles: string[];
    publishedUrls: Array<string | null>;
    parentTaskId: string | null;
    /** Set only for the paste path. Null means the chip chose no date. */
    dueDate?: string | null;
    /** Mixed parents. Null keeps the single parentTaskId path. */
    items: StageAddItem[] | null;
}

const CALENDAR_DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function isCalendarDay(value: string): boolean {
    const match = CALENDAR_DAY.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function readDueDate(value: unknown): { ok: true; dueDate: string | null } | { ok: false; error: string } {
    if (value == null || value === '') return { ok: true, dueDate: null };
    if (typeof value !== 'string' || !isCalendarDay(value)) return { ok: false, error: 'Choose a due date.' };
    return { ok: true, dueDate: value };
}

function readPlanItems(value: unknown): { ok: true; items: StageAddItem[] } | { ok: false; error: string } {
    if (!Array.isArray(value)) return { ok: false, error: 'Enter a title.' };
    const items: StageAddItem[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Enter a title.' };
        const record = item as Record<string, unknown>;
        if (typeof record.title !== 'string') return { ok: false, error: 'Enter a title.' };
        const title = record.title.trim();
        if (!title || /[\r\n]/.test(record.title)) return { ok: false, error: 'Enter a title.' };
        if (record.depth !== 0 && record.depth !== 1) return { ok: false, error: 'Enter a title.' };
        items.push({ title, depth: record.depth });
    }
    const problem = stageAddTitlesError(items.map(item => item.title));
    if (problem) return { ok: false, error: problem };
    return { ok: true, items };
}

function readStageAddBody(body: unknown): { ok: true; value: StageAddInput } | { ok: false; error: string } {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Enter a title.' };
    const record = body as Record<string, unknown>;
    if (!isTaskStage(record.stage)) return { ok: false, error: 'Choose a stage.' };
    if (Array.isArray(record.items)) {
        const due = readDueDate(record.dueDate);
        if (!due.ok) return due;
        const items = readPlanItems(record.items);
        if (!items.ok) return items;
        return {
            ok: true,
            value: {
                stage: record.stage,
                titles: items.items.map(item => item.title),
                publishedUrls: items.items.map(() => null),
                parentTaskId: null,
                dueDate: due.dueDate,
                items: items.items,
            },
        };
    }
    if (!Array.isArray(record.titles)) return { ok: false, error: 'Enter a title.' };

    const parentProvided = record.parentTaskId != null && record.parentTaskId !== '';
    const parentIsValid = typeof record.parentTaskId === 'string' && ID.test(record.parentTaskId.trim());
    const titles: string[] = [];
    for (const title of record.titles) {
        if (typeof title !== 'string') return { ok: false, error: 'Enter a title.' };
        const trimmed = title.trim();
        if (!trimmed || /[\r\n]/.test(title)) return { ok: false, error: 'Enter a title.' };
        if (!parentIsValid && trimmed.length > STAGE_ADD_MAX_TITLE_LENGTH) {
            return { ok: false, error: `Keep each title under ${STAGE_ADD_MAX_TITLE_LENGTH} characters.` };
        }
        titles.push(trimmed);
    }
    if (parentProvided && !parentIsValid) return { ok: false, error: 'Not found' };
    if (parentIsValid && typeof record.parentTaskId === 'string') {
        const problem = subtaskLinesError(titles, stageAddTitlesError);
        if (problem) return { ok: false, error: problem };
        const drafts = subtaskLineDrafts(titles);
        return {
            ok: true,
            value: {
                stage: record.stage,
                titles: drafts.map(draft => draft.title),
                publishedUrls: drafts.map(draft => draft.publishedUrl),
                parentTaskId: record.parentTaskId.trim(),
                items: null,
            },
        };
    }
    const titlesError = stageAddTitlesError(titles);
    if (titlesError) return { ok: false, error: titlesError };
    return {
        ok: true,
        value: { stage: record.stage, titles, publishedUrls: titles.map(() => null), parentTaskId: null, items: null },
    };
}

function placementKey(parentTaskId: unknown, position: unknown): string | null {
    if (typeof position !== 'number') return null;
    const parent = typeof parentTaskId === 'string' ? parentTaskId : '';
    return `${parent}\0${position}`;
}

function orderCreated(rows: readonly Record<string, unknown>[], tasks: readonly StageListTask[]): StageListTask[] {
    const byKey = new Map<string, StageListTask[]>();
    for (const task of tasks) {
        const key = placementKey(task.parentTaskId, task.position);
        if (!key) continue;
        const list = byKey.get(key) ?? [];
        list.push(task);
        byKey.set(key, list);
    }
    const ordered: StageListTask[] = [];
    for (const row of rows) {
        const key = placementKey(row.parent_task_id, row.position);
        if (!key) continue;
        const task = byKey.get(key)?.shift();
        if (task) ordered.push(task);
    }
    return ordered;
}

interface PlanBlock {
    title: string;
    children: string[];
}

/** Depth 1 attaches to the latest depth 0. A leading subtask is promoted. */
function planBlocks(items: readonly StageAddItem[]): PlanBlock[] {
    const blocks: PlanBlock[] = [];
    for (const item of items) {
        const current = blocks[blocks.length - 1];
        if (item.depth === 1 && current) current.children.push(item.title);
        else blocks.push({ title: item.title, children: [] });
    }
    return blocks;
}

function planRow(input: {
    organizationId: string;
    clientId: string;
    title: string;
    stage: TaskStage;
    position: number;
    parentTaskId?: string;
    dueDate: string | null;
    createdBy: string;
    sortOrder: number;
    at: string;
}): Record<string, unknown> {
    return {
        ...taskCreateRow({
            organizationId: input.organizationId,
            clientId: input.clientId,
            title: input.title,
            stage: input.stage,
            position: input.position,
            parentTaskId: input.parentTaskId,
            createdBy: input.createdBy,
            status: 'todo',
            priority: 'medium',
            sortOrder: input.sortOrder,
        }),
        due_date: input.dueDate,
        assignee_ids: [],
        status_history: [{ status: 'todo', at: input.at, by: input.createdBy }],
    };
}

async function undoPlanTasks(dependencies: StageAddDependencies, ids: string[]): Promise<void> {
    if (!dependencies.deleteTasks || ids.length === 0) return;
    try {
        await dependencies.deleteTasks(ids);
    } catch {
        // The add still fails. A leftover row is better than leaking the delete error.
    }
}

/**
 * One request, two inserts: top-level rows first, then their subtasks.
 * Children of a new pillar share that pillar. A failed child insert removes
 * the parents created in this request.
 */
async function insertPlanItems(input: {
    clientId: string;
    stage: TaskStage;
    dueDate: string | null;
    items: StageAddItem[];
    organizationId: string;
    userId: string;
    dependencies: StageAddDependencies;
}): Promise<StageAddResult> {
    const blocks = planBlocks(input.items);
    const max = await input.dependencies.maxPosition(input.organizationId, input.clientId, input.stage, null);
    const positions = nextStagePositions(max, blocks.length);
    const now = input.dependencies.now?.() ?? new Date().toISOString();
    let sort = 0;
    const parentRows = blocks.map((block, index) => planRow({
        organizationId: input.organizationId,
        clientId: input.clientId,
        title: block.title,
        stage: input.stage,
        position: positions[index] ?? index + 1,
        dueDate: input.dueDate,
        createdBy: input.userId,
        sortOrder: sort++,
        at: now,
    }));
    const insertedParents = await input.dependencies.insertTasks(parentRows);
    const parents = orderCreated(parentRows, insertedParents);
    if (parents.length !== blocks.length) {
        await undoPlanTasks(input.dependencies, parents.map(parent => parent.id));
        return { status: 500, body: { error: 'Could not add tasks' } };
    }

    const childRows: Record<string, unknown>[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
        const parent = parents[index];
        const children = blocks[index]?.children ?? [];
        if (!parent || children.length === 0) continue;
        const childPositions = nextStagePositions(null, children.length);
        children.forEach((title, childIndex) => {
            childRows.push(planRow({
                organizationId: input.organizationId,
                clientId: input.clientId,
                title,
                stage: input.stage,
                position: childPositions[childIndex] ?? childIndex + 1,
                parentTaskId: parent.id,
                dueDate: input.dueDate,
                createdBy: input.userId,
                sortOrder: sort++,
                at: now,
            }));
        });
    }

    let children: StageListTask[] = [];
    if (childRows.length > 0) {
        try {
            const insertedChildren = await input.dependencies.insertTasks(childRows);
            children = orderCreated(childRows, insertedChildren);
        } catch {
            await undoPlanTasks(input.dependencies, parents.map(parent => parent.id));
            return { status: 500, body: { error: 'Could not add tasks' } };
        }
        if (children.length !== childRows.length) {
            await undoPlanTasks(input.dependencies, [...parents, ...children].map(task => task.id));
            return { status: 500, body: { error: 'Could not add tasks' } };
        }
    }

    const tasks: StageListTask[] = [];
    let cursor = 0;
    for (let index = 0; index < blocks.length; index += 1) {
        const parent = parents[index];
        if (!parent) continue;
        tasks.push(parent);
        const count = blocks[index]?.children.length ?? 0;
        tasks.push(...children.slice(cursor, cursor + count));
        cursor += count;
    }
    const titlesById = new Map(parents.map(parent => [parent.id, parent.title]));
    await finishCreatedTasks(tasks, input, parentId => titlesById.get(parentId), input.stage, input.dueDate);
    return { status: 200, body: { tasks } };
}

async function pushQualifiedTasks(
    tasks: readonly StageListTask[],
    dependencies: StageAddDependencies,
    stage: TaskStage,
    dueDate: string | null,
): Promise<void> {
    if (!planTaskQualifiesForBasecampPush({ stage, dueDate })) return;
    for (const task of tasks) {
        try {
            const sync = await dependencies.pushToBasecamp?.(task.id);
            if (sync && typeof sync === 'object') task.basecampSync = sync;
        } catch {
            // The push records its own failure. The task is already saved.
        }
    }
}

async function finishCreatedTasks(
    tasks: readonly StageListTask[],
    input: {
        clientId: string;
        organizationId: string;
        userId: string;
        dependencies: StageAddDependencies;
    },
    parentTitle: (parentTaskId: string) => string | undefined,
    stage: TaskStage,
    dueDate: string | null,
): Promise<void> {
    await pushQualifiedTasks(tasks, input.dependencies, stage, dueDate);
    if (!input.dependencies.logCreated) return;
    for (const task of tasks) {
        const title = task.parentTaskId ? parentTitle(task.parentTaskId) : undefined;
        try {
            await input.dependencies.logCreated({
                organizationId: input.organizationId,
                clientId: input.clientId,
                userId: input.userId,
                task,
                ...(title ? { parentTitle: title } : {}),
            });
        } catch {
            // Same as createTask: the feed is best-effort and does not undo the insert.
        }
    }
}

/**
 * Create tasks in one stage for the signed-in organization.
 * The client id is only a path key. Organization, role, and user id come from
 * the session. A flag that is off never writes. Viewers never write.
 * A body with `items` creates mixed parents in this request: pillars first,
 * then their subtasks. A qualifying task is pushed; an undated backlog task is not.
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

        if (parsed.value.items) {
            return await insertPlanItems({
                clientId,
                stage: parsed.value.stage,
                dueDate: parsed.value.dueDate ?? null,
                items: parsed.value.items,
                organizationId: session.organizationId,
                userId: session.userId,
                dependencies,
            });
        }

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
                publishedUrl: parsed.value.publishedUrls[index] ?? undefined,
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

        await pushQualifiedTasks(tasks, dependencies, stage, null);
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
