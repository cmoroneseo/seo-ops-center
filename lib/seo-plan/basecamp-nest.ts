/**
 * Turn a Basecamp to-do into a subtask, or a subtask back into a to-do.
 *
 * Basecamp cannot move a to-do under another to-do. The safe order is:
 * create the replacement, save its id on the task, and only then trash the
 * old recording. Trash is recoverable. A retry must not create a second
 * recording, and it must not trash the recording the task now points at.
 *
 * Nothing here calls Basecamp. The provider and the store are injected.
 *
 * A completed child becomes a completed step. The signal is the task being
 * done, or the old recording already being completed. A completed parent
 * to-do is reopened before a step is created or completed, then completed
 * again before anything is trashed. Trash stays a recoverable status change.
 */

import { alignBasecampStepOrder, linkedStepIds, sortByAppOrder } from './basecamp-step-order';

export type NestScope = 'client' | 'task';

export type BasecampRecording =
    | { kind: 'missing' }
    | { kind: 'unknown' }
    | { kind: 'todo'; trashed: boolean; completed?: boolean }
    | { kind: 'step'; parentTodoId: string | null; trashed: boolean; completed?: boolean };

export interface ListedRecording {
    id: string;
    title: string;
    completed?: boolean;
}

export interface NestTask {
    id: string;
    title: string;
    basecampTodoId: string | null;
    pendingTrashId?: string | null;
    /** True when the task status is done. */
    completed?: boolean;
    description?: string | null;
    dueDate?: string | null;
    assigneePersonIds?: number[];
    /** Plan order. Missing values sort after numbered rows, then by created_at and id. */
    position?: number | null;
    createdAt?: string | null;
}

export type NestAction =
    | 'already-nested'
    | 'already-top-level'
    | 'skipped-unlinked'
    | 'skipped-no-parent-todo'
    | 'skipped-no-todolist'
    | 'would-nest'
    | 'nested'
    | 'would-unnest'
    | 'unnested'
    | 'would-finish-trash'
    | 'finished-trash'
    | 'failed';

export interface NestResult {
    taskId: string;
    title: string;
    parentTaskId: string | null;
    parentTodoId: string | null;
    action: NestAction;
    /** Set when this run creates a recording. A reused recording leaves this null. */
    create: { kind: 'step' | 'todo'; title: string; parentTodoId: string | null } | null;
    reusedRecordingId: string | null;
    /** Old recording to trash after the new id is saved. Null when nothing should be trashed. */
    trashRecordingId: string | null;
    linkedRecordingId: string | null;
    message: string | null;
    /** What this run does with completion. A dry run fills it and writes nothing. */
    completion: NestCompletion;
    /**
     * The replacement to-do was left completed. The caller should not reopen it
     * just because the task status is still open.
     */
    carriedCompletion?: boolean;
    status?: number;
    scope?: NestScope;
}

/** Completion as a dry run or a real run reports it for one child. */
export interface NestCompletion {
    /** The task is done, or the recording it points at is completed. */
    childCompleted: boolean;
    /** This run marks the replacement step, or the replacement to-do, completed. */
    willCompleteStep: boolean;
    /** The parent to-do is completed in Basecamp right now. */
    parentTodoCompleted: boolean;
    /** This run reopens the parent before creating or completing a step. */
    reopenParent: boolean;
    /** This run completes the parent again afterwards. */
    recompleteParent: boolean;
}

type NestCall =
    | { ok: true; id?: string }
    | { ok: false; status: number; message: string; scope: NestScope };

export interface BasecampNestProvider {
    inspectRecording(input: { projectId: string; recordingId: string }): Promise<
        | { ok: true; recording: BasecampRecording }
        | { ok: false; status: number; message: string; scope: NestScope }
    >;
    listSteps(input: { projectId: string; parentTodoId: string }): Promise<
        | { ok: true; steps: ListedRecording[] }
        | { ok: false; status: number; message: string; scope: NestScope }
    >;
    listTodos?(input: { projectId: string; todolistId: string }): Promise<
        | { ok: true; todos: ListedRecording[] }
        | { ok: false; status: number; message: string; scope: NestScope }
    >;
    createStep(input: { projectId: string; parentTodoId: string; title: string }): Promise<NestCall>;
    createTodo?(input: {
        projectId: string;
        todolistId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
        assigneePersonIds: number[];
    }): Promise<NestCall>;
    /** POST /subtasks/{id}/completion.json. Absent means a completed child cannot be marked done. */
    completeStep?(input: { projectId: string; stepId: string }): Promise<NestCall>;
    /** POST /buckets/{project}/todos/{id}/completion.json. */
    completeTodo?(input: { projectId: string; todoId: string }): Promise<NestCall>;
    /** DELETE on the to-do completion path. Used to open a completed parent before adding a step. */
    reopenTodo?(input: { projectId: string; todoId: string }): Promise<NestCall>;
    /**
     * PUT /subtasks/{id}/position.json. Absent means an older provider
     * leaves the checklist order alone.
     */
    repositionStep?(input: { projectId: string; stepId: string; position: number }): Promise<NestCall>;
    trashRecording(input: { projectId: string; recordingId: string }): Promise<
        | { ok: true; alreadyGone: boolean }
        | { ok: false; status: number; message: string; scope: NestScope }
    >;
}

export interface BasecampNestStore {
    linkTodo(
        taskId: string,
        projectId: string,
        recordingId: string,
        at: string,
        pendingTrashId: string | null,
    ): Promise<void>;
    clearPendingTrash(taskId: string, at: string): Promise<void>;
}

export interface BasecampNestDependencies {
    provider: BasecampNestProvider;
    store: BasecampNestStore;
    now: () => string;
}

const PENDING_TRASH = /^Pending Basecamp trash (\d+):/;

/** The sync error written after the new id is saved and before the old recording is trashed. */
export function pendingTrashMessage(recordingId: string): string {
    return `Pending Basecamp trash ${recordingId}: the new recording is saved and the old one still needs to be trashed.`;
}

/** Recording id still waiting to be trashed, or null when the error is about something else. */
export function readPendingTrashId(error: string | null | undefined): string | null {
    if (!error) return null;
    return PENDING_TRASH.exec(error)?.[1] ?? null;
}

/**
 * Columns for a service-role task update that points the task at a recording.
 * A pending trash id is stored on the same write as the new id, so a crash
 * before the trash call can finish the trash without creating another recording.
 */
export function taskBasecampLinkUpdate(input: {
    projectId: string;
    todoId: string;
    at: string;
    pendingTrashId?: string | null;
}): Record<string, unknown> {
    const update: Record<string, unknown> = {
        basecamp_todo_id: Number(input.todoId),
        basecamp_project_id: Number(input.projectId),
        last_synced_at: input.at,
    };
    if (input.pendingTrashId && /^\d+$/.test(input.pendingTrashId)) {
        update.basecamp_sync_state = 'failed';
        update.basecamp_sync_error = pendingTrashMessage(input.pendingTrashId);
        update.basecamp_sync_attempted_at = input.at;
    }
    return update;
}

/** Clears a pending-trash error after the old recording is gone. */
export function clearPendingTrashUpdate(at: string): Record<string, unknown> {
    return {
        basecamp_sync_state: 'ok',
        basecamp_sync_error: null,
        basecamp_sync_attempted_at: at,
        last_synced_at: at,
    };
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function digit(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

/**
 * A to-do's parent is a to-do list. A step's parent is a to-do, and its type
 * is `Kanban::Step`. Anything else is left alone: this path only trashes a
 * recording it has classified.
 */
export function classifyBasecampRecording(body: unknown): BasecampRecording {
    const row = record(body);
    if (!row) return { kind: 'unknown' };
    const trashed = row.status === 'trashed';
    const completed = row.completed === true;
    const type = typeof row.type === 'string' ? row.type : '';
    const parent = record(row.parent);
    const parentType = parent && typeof parent.type === 'string' ? parent.type : '';
    const parentId = digit(parent?.id);
    if (type === 'Kanban::Step' || parentType === 'Todo') {
        return { kind: 'step', parentTodoId: parentType === 'Todo' ? parentId : null, trashed, completed };
    }
    if (type === 'Todo' || parentType === 'Todolist') {
        return { kind: 'todo', trashed, completed };
    }
    return { kind: 'unknown' };
}

/** Map a recording read. 404 is missing. A body that says trashed stays classified. */
export function recordingFromRead(status: number, body: unknown): BasecampRecording {
    if (status === 404) return { kind: 'missing' };
    return classifyBasecampRecording(body);
}

function blank(task: NestTask, parentTaskId: string | null, parentTodoId: string | null, patch: Partial<NestResult>): NestResult {
    const completion: NestCompletion = {
        childCompleted: task.completed === true,
        willCompleteStep: false,
        parentTodoCompleted: false,
        reopenParent: false,
        recompleteParent: false,
        ...patch.completion,
    };
    return {
        taskId: task.id,
        title: task.title,
        parentTaskId,
        parentTodoId,
        action: 'failed',
        create: null,
        reusedRecordingId: null,
        trashRecordingId: null,
        linkedRecordingId: task.basecampTodoId,
        message: null,
        ...patch,
        completion,
    };
}

function failed(
    task: NestTask,
    parentTaskId: string | null,
    parentTodoId: string | null,
    status: number,
    scope: NestScope,
    message: string,
    completion?: NestCompletion,
): NestResult {
    return blank(task, parentTaskId, parentTodoId, {
        action: 'failed',
        status,
        scope,
        message,
        linkedRecordingId: task.basecampTodoId,
        ...(completion ? { completion } : {}),
    });
}

function titleOf(task: NestTask): string {
    return task.title.trim();
}

/**
 * One unclaimed recording with this title is the recording a previous attempt
 * created and did not save. More than one is ambiguous, so this creates nothing.
 */
function matchUnclaimed(
    rows: readonly ListedRecording[],
    title: string,
    claimed: ReadonlySet<string>,
    ownId: string | null,
): ListedRecording | 'ambiguous' | null {
    const matches = rows.filter(row => row.title.trim() === title && row.id !== ownId && !claimed.has(row.id));
    if (matches.length > 1) return 'ambiguous';
    return matches[0] ?? null;
}

function live(recording: BasecampRecording): boolean {
    return recording.kind !== 'missing' && recording.kind !== 'unknown' && recording.trashed !== true;
}

/** Save the new id first. A store error leaves the old recording in place. */
async function saveLink(
    dependencies: BasecampNestDependencies,
    task: NestTask,
    projectId: string,
    recordingId: string,
    pendingTrashId: string | null,
): Promise<boolean> {
    try {
        await dependencies.store.linkTodo(task.id, projectId, recordingId, dependencies.now(), pendingTrashId);
    } catch {
        return false;
    }
    task.basecampTodoId = recordingId;
    task.pendingTrashId = pendingTrashId;
    return true;
}

async function clearTrash(dependencies: BasecampNestDependencies, task: NestTask): Promise<boolean> {
    try {
        await dependencies.store.clearPendingTrash(task.id, dependencies.now());
    } catch {
        return false;
    }
    task.pendingTrashId = null;
    return true;
}

type Mutation =
    | { ok: true }
    | { ok: false; status: number; message: string; scope: NestScope };

function childDone(task: NestTask, recording: BasecampRecording | null): boolean {
    if (task.completed === true) return true;
    return !!recording
        && (recording.kind === 'todo' || recording.kind === 'step')
        && recording.completed === true;
}

function liveTodo(recording: BasecampRecording): recording is { kind: 'todo'; trashed: boolean; completed?: boolean } {
    return recording.kind === 'todo' && recording.trashed !== true;
}

function planCompletion(input: {
    childCompleted: boolean;
    targetCompleted: boolean;
    parent: BasecampRecording | null;
    parentTaskCompleted: boolean;
    /** Creating a step, or completing one, needs the parent to-do open. */
    needsOpenParent: boolean;
}): NestCompletion {
    const parentTodoCompleted = !!input.parent && liveTodo(input.parent) && input.parent.completed === true;
    const parentOpen = !!input.parent && liveTodo(input.parent) && input.parent.completed !== true;
    const willCompleteStep = input.childCompleted && !input.targetCompleted;
    const reopenParent = parentTodoCompleted && input.needsOpenParent;
    return {
        childCompleted: input.childCompleted,
        willCompleteStep,
        parentTodoCompleted,
        reopenParent,
        recompleteParent: reopenParent || (input.parentTaskCompleted && parentOpen),
    };
}

function completionSentence(completion: NestCompletion): string {
    const child = completion.childCompleted ? 'Child is completed.' : 'Child is open.';
    const step = completion.willCompleteStep ? ' The step will be completed.' : ' The step will be left open.';
    const parent = completion.parentTodoCompleted ? ' Parent to-do is completed.' : ' Parent to-do is open.';
    const motion = completion.reopenParent
        ? ' Parent will be reopened and completed again.'
        : (completion.recompleteParent ? ' Parent will be completed.' : '');
    return `${child}${step}${parent}${motion}`;
}

/** Keep the pending-trash prefix so a later retry can still finish the trash. */
function keptTrashMessage(trashId: string | null, message: string): string {
    if (!trashId) return message;
    return `${pendingTrashMessage(trashId)} ${message}`;
}

async function mutate(
    run: (() => Promise<NestCall>) | undefined,
    missing: string,
): Promise<Mutation> {
    if (!run) return { ok: false, status: 500, scope: 'task', message: missing };
    const result = await run();
    return result.ok ? { ok: true } : result;
}

async function reopenParentTodo(
    dependencies: BasecampNestDependencies,
    projectId: string,
    parentTodoId: string,
): Promise<Mutation> {
    return mutate(
        dependencies.provider.reopenTodo
            ? () => dependencies.provider.reopenTodo!({ projectId, todoId: parentTodoId })
            : undefined,
        'Reopening the parent to-do is not available.',
    );
}

async function completeTodoId(
    dependencies: BasecampNestDependencies,
    projectId: string,
    todoId: string,
): Promise<Mutation> {
    return mutate(
        dependencies.provider.completeTodo
            ? () => dependencies.provider.completeTodo!({ projectId, todoId })
            : undefined,
        'Basecamp to-do completion is not available.',
    );
}

async function completeStepId(
    dependencies: BasecampNestDependencies,
    projectId: string,
    stepId: string,
): Promise<Mutation> {
    return mutate(
        dependencies.provider.completeStep
            ? () => dependencies.provider.completeStep!({ projectId, stepId })
            : undefined,
        'Basecamp step completion is not available.',
    );
}

/**
 * Complete the replacement, then complete the parent when this run reopened it
 * or the parent task is done. A step failure still tries to put the parent back.
 */
async function finishCompletion(
    dependencies: BasecampNestDependencies,
    projectId: string,
    parentTodoId: string | null,
    target: { kind: 'step' | 'todo'; id: string } | null,
    plan: NestCompletion,
): Promise<Mutation> {
    if (plan.willCompleteStep && target) {
        const completed = target.kind === 'step'
            ? await completeStepId(dependencies, projectId, target.id)
            : await completeTodoId(dependencies, projectId, target.id);
        if (!completed.ok) {
            if (plan.recompleteParent && parentTodoId) {
                const restored = await completeTodoId(dependencies, projectId, parentTodoId);
                if (!restored.ok) {
                    return {
                        ok: false,
                        status: restored.status,
                        scope: restored.scope,
                        message: `${completed.message} The parent to-do was reopened and could not be completed again.`,
                    };
                }
            }
            return completed;
        }
    }
    if (plan.recompleteParent && parentTodoId) {
        return completeTodoId(dependencies, projectId, parentTodoId);
    }
    return { ok: true };
}

async function readParentTodo(
    dependencies: BasecampNestDependencies,
    projectId: string,
    parentTodoId: string,
): Promise<
    | { ok: true; recording: BasecampRecording }
    | { ok: false; status: number; message: string; scope: NestScope }
> {
    return dependencies.provider.inspectRecording({ projectId, recordingId: parentTodoId });
}

async function finishTrash(
    dependencies: BasecampNestDependencies,
    task: NestTask,
    parentTaskId: string | null,
    parentTodoId: string | null,
    projectId: string,
    trashId: string,
    linkedId: string,
    dryRun: boolean,
    context?: {
        recording: BasecampRecording;
        parentTaskCompleted: boolean;
    },
): Promise<NestResult> {
    if (trashId === linkedId) {
        return failed(task, parentTaskId, parentTodoId, 409, 'task', 'Refusing to trash the recording this task is linked to.');
    }
    const recording = context?.recording ?? null;
    const parentTaskCompleted = context?.parentTaskCompleted === true;
    const childCompleted = childDone(task, recording);
    const targetCompleted = !!recording
        && (recording.kind === 'todo' || recording.kind === 'step')
        && recording.completed === true;
    const targetKind: 'step' | 'todo' = recording?.kind === 'todo' ? 'todo' : 'step';
    let parent: BasecampRecording | null = null;
    if (parentTodoId && (childCompleted || parentTaskCompleted)) {
        const read = await readParentTodo(dependencies, projectId, parentTodoId);
        if (!read.ok) {
            return failed(task, parentTaskId, parentTodoId, read.status, read.scope, keptTrashMessage(trashId, read.message));
        }
        parent = read.recording;
    }
    const willComplete = childCompleted && !targetCompleted;
    const plan = planCompletion({
        childCompleted,
        targetCompleted,
        parent,
        parentTaskCompleted,
        needsOpenParent: targetKind === 'step' && willComplete,
    });
    if (dryRun) {
        return blank(task, parentTaskId, parentTodoId, {
            action: 'would-finish-trash',
            trashRecordingId: trashId,
            linkedRecordingId: linkedId,
            message: `${pendingTrashMessage(trashId)} ${completionSentence(plan)}`,
            completion: plan,
        });
    }
    if (plan.reopenParent && parentTodoId) {
        const reopened = await reopenParentTodo(dependencies, projectId, parentTodoId);
        if (!reopened.ok) {
            return failed(
                task,
                parentTaskId,
                parentTodoId,
                reopened.status,
                reopened.scope,
                keptTrashMessage(trashId, reopened.message),
                plan,
            );
        }
    }
    const finished = await finishCompletion(
        dependencies,
        projectId,
        parentTodoId,
        { kind: targetKind, id: linkedId },
        plan,
    );
    if (!finished.ok) {
        return failed(
            task,
            parentTaskId,
            parentTodoId,
            finished.status,
            finished.scope,
            keptTrashMessage(trashId, finished.message),
            plan,
        );
    }
    const trashed = await dependencies.provider.trashRecording({ projectId, recordingId: trashId });
    if (!trashed.ok) {
        return failed(task, parentTaskId, parentTodoId, trashed.status, trashed.scope, pendingTrashMessage(trashId), plan);
    }
    const cleared = await clearTrash(dependencies, task);
    if (!cleared) {
        return failed(task, parentTaskId, parentTodoId, 500, 'task', pendingTrashMessage(trashId), plan);
    }
    return blank(task, parentTaskId, parentTodoId, {
        action: 'finished-trash',
        trashRecordingId: trashId,
        linkedRecordingId: linkedId,
        completion: plan,
        carriedCompletion: targetKind === 'todo' && childCompleted,
        message: `${trashed.alreadyGone ? 'The old recording was already gone.' : 'Trashed the old recording.'} ${completionSentence(plan)}`,
    });
}

export interface NestChildInput {
    projectId: string;
    /** To-do the child should sit under. Null asks to make the child a top-level to-do. */
    parentTodoId: string | null;
    parentTaskId: string | null;
    /** Required when lifting a step back to a to-do. */
    todolistId?: string | null;
    child: NestTask;
    claimed: Set<string>;
    dryRun: boolean;
    /** True when the parent task status is done. That is what recompletes the parent after a retry. */
    parentTaskCompleted?: boolean;
}

/**
 * Make one child a subtask of `parentTodoId`.
 * The child object is updated when its Basecamp id changes, so a caller that
 * still holds it sees the saved step.
 */
export async function nestFlatChild(
    input: NestChildInput,
    dependencies: BasecampNestDependencies,
): Promise<NestResult> {
    const { child, parentTodoId, parentTaskId } = input;
    const title = titleOf(child);
    if (!parentTodoId) {
        return blank(child, parentTaskId, null, {
            action: 'skipped-no-parent-todo',
            message: 'The parent task has no Basecamp to-do, so this child cannot become a subtask yet.',
        });
    }
    if (!title) {
        return failed(child, parentTaskId, parentTodoId, 400, 'task', 'This task has no title to put on a Basecamp subtask.');
    }

    const pending = child.pendingTrashId && /^\d+$/.test(child.pendingTrashId) ? child.pendingTrashId : null;
    if (pending && child.basecampTodoId && child.basecampTodoId !== pending) {
        const current = await dependencies.provider.inspectRecording({
            projectId: input.projectId,
            recordingId: child.basecampTodoId,
        });
        if (!current.ok) return failed(child, parentTaskId, parentTodoId, current.status, current.scope, current.message);
        const savedStep = current.recording.kind === 'step'
            && !current.recording.trashed
            && current.recording.parentTodoId === parentTodoId;
        if (savedStep) {
            return finishTrash(
                dependencies,
                child,
                parentTaskId,
                parentTodoId,
                input.projectId,
                pending,
                child.basecampTodoId,
                input.dryRun,
                { recording: current.recording, parentTaskCompleted: input.parentTaskCompleted === true },
            );
        }
        if (current.recording.kind === 'missing' || (current.recording.kind !== 'unknown' && current.recording.trashed)) {
            return failed(
                child,
                parentTaskId,
                parentTodoId,
                409,
                'task',
                `The saved recording ${child.basecampTodoId} is gone, so the old recording ${pending} was left in place.`,
            );
        }
    }

    if (!child.basecampTodoId) {
        return blank(child, parentTaskId, parentTodoId, {
            action: 'skipped-unlinked',
            message: 'This task has no Basecamp recording.',
        });
    }

    const inspected = await dependencies.provider.inspectRecording({
        projectId: input.projectId,
        recordingId: child.basecampTodoId,
    });
    if (!inspected.ok) return failed(child, parentTaskId, parentTodoId, inspected.status, inspected.scope, inspected.message);
    const recording = inspected.recording;
    if (recording.kind === 'unknown') {
        return failed(
            child,
            parentTaskId,
            parentTodoId,
            502,
            'task',
            'Basecamp did not say whether this recording is a to-do or a subtask, so nothing was changed.',
        );
    }
    const parentRead = await readParentTodo(dependencies, input.projectId, parentTodoId);
    if (!parentRead.ok) return failed(child, parentTaskId, parentTodoId, parentRead.status, parentRead.scope, parentRead.message);
    const parentRecording = parentRead.recording;
    const childCompleted = childDone(child, recording);
    if (recording.kind === 'step' && !recording.trashed && recording.parentTodoId === parentTodoId) {
        const stepCompleted = recording.completed === true;
        const plan = planCompletion({
            childCompleted,
            targetCompleted: stepCompleted,
            parent: parentRecording,
            parentTaskCompleted: input.parentTaskCompleted === true,
            needsOpenParent: childCompleted && !stepCompleted,
        });
        const idle = !plan.willCompleteStep && !plan.reopenParent && !plan.recompleteParent;
        if (input.dryRun || idle) {
            return blank(child, parentTaskId, parentTodoId, {
                action: 'already-nested',
                linkedRecordingId: child.basecampTodoId,
                completion: plan,
                message: completionSentence(plan),
            });
        }
        if (plan.reopenParent && !liveTodo(parentRecording)) {
            return failed(
                child,
                parentTaskId,
                parentTodoId,
                409,
                'task',
                'The parent recording is not a to-do that can take a subtask, so nothing was changed.',
                plan,
            );
        }
        if (plan.reopenParent) {
            const reopened = await reopenParentTodo(dependencies, input.projectId, parentTodoId);
            if (!reopened.ok) return failed(child, parentTaskId, parentTodoId, reopened.status, reopened.scope, reopened.message, plan);
        }
        const finished = await finishCompletion(
            dependencies,
            input.projectId,
            parentTodoId,
            child.basecampTodoId ? { kind: 'step', id: child.basecampTodoId } : null,
            plan,
        );
        if (!finished.ok) return failed(child, parentTaskId, parentTodoId, finished.status, finished.scope, finished.message, plan);
        return blank(child, parentTaskId, parentTodoId, {
            action: 'already-nested',
            linkedRecordingId: child.basecampTodoId,
            completion: plan,
            message: completionSentence(plan),
        });
    }
    if (!liveTodo(parentRecording)) {
        return failed(
            child,
            parentTaskId,
            parentTodoId,
            409,
            'task',
            'The parent recording is not a to-do that can take a subtask, so nothing was created or trashed.',
        );
    }

    const listed = await dependencies.provider.listSteps({ projectId: input.projectId, parentTodoId });
    if (!listed.ok) return failed(child, parentTaskId, parentTodoId, listed.status, listed.scope, listed.message);
    const match = matchUnclaimed(listed.steps, title, input.claimed, child.basecampTodoId);
    if (match === 'ambiguous') {
        return failed(
            child,
            parentTaskId,
            parentTodoId,
            409,
            'task',
            `More than one unlinked Basecamp subtask is titled "${title}". Nothing was created or trashed.`,
        );
    }

    const shouldTrash = live(recording);
    const trashRecordingId = shouldTrash ? child.basecampTodoId : null;
    const targetCompleted = match?.completed === true;
    const plan = planCompletion({
        childCompleted,
        targetCompleted,
        parent: parentRecording,
        parentTaskCompleted: input.parentTaskCompleted === true,
        needsOpenParent: !match || (childCompleted && !targetCompleted),
    });
    if (match) input.claimed.add(match.id);
    if (input.dryRun) {
        return blank(child, parentTaskId, parentTodoId, {
            action: 'would-nest',
            create: match ? null : { kind: 'step', title, parentTodoId },
            reusedRecordingId: match?.id ?? null,
            trashRecordingId,
            linkedRecordingId: match?.id ?? null,
            completion: plan,
            message: `${dryNestMessage(match?.id ?? null, trashRecordingId, recording)} ${completionSentence(plan)}`,
        });
    }

    if (plan.reopenParent) {
        const reopened = await reopenParentTodo(dependencies, input.projectId, parentTodoId);
        if (!reopened.ok) return failed(child, parentTaskId, parentTodoId, reopened.status, reopened.scope, reopened.message, plan);
    }

    let stepId = match?.id ?? null;
    if (!stepId) {
        const created = await dependencies.provider.createStep({
            projectId: input.projectId,
            parentTodoId,
            title,
        });
        if (!created.ok || !created.id) {
            const message = created.ok ? `Basecamp subtask sync failed: ${title}` : created.message;
            const status = created.ok ? 502 : created.status;
            const scope = created.ok ? 'task' as const : created.scope;
            if (plan.reopenParent) {
                const restored = await finishCompletion(
                    dependencies,
                    input.projectId,
                    parentTodoId,
                    null,
                    { ...plan, willCompleteStep: false },
                );
                if (!restored.ok) {
                    return failed(
                        child,
                        parentTaskId,
                        parentTodoId,
                        restored.status,
                        restored.scope,
                        `${message} The parent to-do was reopened and could not be completed again.`,
                        plan,
                    );
                }
            }
            return failed(child, parentTaskId, parentTodoId, status, scope, message, plan);
        }
        stepId = created.id;
        input.claimed.add(stepId);
    }
    if (stepId === child.basecampTodoId) {
        return failed(child, parentTaskId, parentTodoId, 409, 'task', 'Refusing to trash the recording this task is linked to.', plan);
    }

    const linked = await saveLink(dependencies, child, input.projectId, stepId, trashRecordingId);
    if (!linked) {
        let message = 'The new subtask was created but its id was not saved, so the old recording was left in place.';
        if (plan.reopenParent) {
            const restored = await finishCompletion(
                dependencies,
                input.projectId,
                parentTodoId,
                null,
                { ...plan, willCompleteStep: false },
            );
            if (!restored.ok) message = `${message} The parent to-do was reopened and could not be completed again.`;
        }
        return failed(child, parentTaskId, parentTodoId, 500, 'task', message, plan);
    }

    const finished = await finishCompletion(
        dependencies,
        input.projectId,
        parentTodoId,
        { kind: 'step', id: stepId },
        plan,
    );
    if (!finished.ok) {
        return failed(
            child,
            parentTaskId,
            parentTodoId,
            finished.status,
            finished.scope,
            keptTrashMessage(trashRecordingId, finished.message),
            plan,
        );
    }

    const made = match ? 'Reused an existing subtask' : 'Created a subtask';
    if (trashRecordingId && trashRecordingId !== stepId) {
        const trashed = await dependencies.provider.trashRecording({
            projectId: input.projectId,
            recordingId: trashRecordingId,
        });
        if (!trashed.ok) {
            return failed(child, parentTaskId, parentTodoId, trashed.status, trashed.scope, pendingTrashMessage(trashRecordingId), plan);
        }
        const cleared = await clearTrash(dependencies, child);
        if (!cleared) {
            return failed(child, parentTaskId, parentTodoId, 500, 'task', pendingTrashMessage(trashRecordingId), plan);
        }
        return blank(child, parentTaskId, parentTodoId, {
            action: 'nested',
            create: match ? null : { kind: 'step', title, parentTodoId },
            reusedRecordingId: match?.id ?? null,
            trashRecordingId,
            linkedRecordingId: stepId,
            completion: plan,
            message: `${trashed.alreadyGone ? 'Saved the subtask. The old recording was already gone.' : `${made} and trashed the old recording.`} ${completionSentence(plan)}`,
        });
    }

    return blank(child, parentTaskId, parentTodoId, {
        action: 'nested',
        create: match ? null : { kind: 'step', title, parentTodoId },
        reusedRecordingId: match?.id ?? null,
        trashRecordingId: null,
        linkedRecordingId: stepId,
        completion: plan,
        message: `${goneMessage(recording, match?.id ?? null)} ${completionSentence(plan)}`,
    });
}

function dryNestMessage(reusedId: string | null, trashId: string | null, recording: BasecampRecording): string {
    const made = reusedId ? `Would reuse subtask ${reusedId}` : 'Would create a subtask';
    if (trashId) return `${made} and trash recording ${trashId}.`;
    if (recording.kind === 'missing') return `${made}. The old recording is already missing.`;
    return `${made}. The old recording is already trashed.`;
}

function goneMessage(recording: BasecampRecording, reusedId: string | null): string {
    const made = reusedId ? 'Reused an existing subtask.' : 'Created a subtask.';
    if (recording.kind === 'missing') return `${made} The old recording was already missing.`;
    return `${made} The old recording was already trashed.`;
}

/**
 * Make a step a top-level to-do.
 * Called only for a task that qualifies for a push. An undated backlog task
 * is not passed here: creating a to-do would put it on the list, and trashing
 * the step would drop the only Basecamp record.
 */
export async function unnestToTodo(
    input: NestChildInput,
    dependencies: BasecampNestDependencies,
): Promise<NestResult> {
    const { child, parentTaskId } = input;
    const title = titleOf(child);
    if (!title) {
        return failed(child, parentTaskId, null, 400, 'task', 'This task has no title to put on a Basecamp to-do.');
    }
    const pending = child.pendingTrashId && /^\d+$/.test(child.pendingTrashId) ? child.pendingTrashId : null;
    if (pending && child.basecampTodoId && child.basecampTodoId !== pending) {
        const current = await dependencies.provider.inspectRecording({
            projectId: input.projectId,
            recordingId: child.basecampTodoId,
        });
        if (!current.ok) return failed(child, parentTaskId, null, current.status, current.scope, current.message);
        if (current.recording.kind === 'todo' && !current.recording.trashed) {
            return finishTrash(
                dependencies,
                child,
                parentTaskId,
                null,
                input.projectId,
                pending,
                child.basecampTodoId,
                input.dryRun,
                { recording: current.recording, parentTaskCompleted: false },
            );
        }
    }
    if (!child.basecampTodoId) {
        return blank(child, parentTaskId, null, {
            action: 'skipped-unlinked',
            message: 'This task has no Basecamp recording.',
        });
    }

    const inspected = await dependencies.provider.inspectRecording({
        projectId: input.projectId,
        recordingId: child.basecampTodoId,
    });
    if (!inspected.ok) return failed(child, parentTaskId, null, inspected.status, inspected.scope, inspected.message);
    const recording = inspected.recording;
    if (recording.kind === 'unknown') {
        return failed(
            child,
            parentTaskId,
            null,
            502,
            'task',
            'Basecamp did not say whether this recording is a to-do or a subtask, so nothing was changed.',
        );
    }
    if (recording.kind === 'todo' && !recording.trashed) {
        return blank(child, parentTaskId, null, {
            action: 'already-top-level',
            linkedRecordingId: child.basecampTodoId,
        });
    }
    if (recording.kind !== 'step' || recording.trashed) {
        return blank(child, parentTaskId, null, {
            action: 'already-top-level',
            linkedRecordingId: child.basecampTodoId,
            message: 'The linked recording is not a live subtask, so it was left for the normal to-do update.',
        });
    }

    const todolistId = input.todolistId ?? null;
    if (!todolistId) {
        return blank(child, parentTaskId, null, {
            action: 'skipped-no-todolist',
            message: 'This client has no SEO Plan to-do list, so the subtask cannot become a top-level to-do.',
        });
    }

    let match: ListedRecording | 'ambiguous' | null = null;
    if (dependencies.provider.listTodos) {
        const listed = await dependencies.provider.listTodos({ projectId: input.projectId, todolistId });
        if (!listed.ok) return failed(child, parentTaskId, null, listed.status, listed.scope, listed.message);
        match = matchUnclaimed(listed.todos, title, input.claimed, child.basecampTodoId);
        if (match === 'ambiguous') {
            return failed(
                child,
                parentTaskId,
                null,
                409,
                'task',
                `More than one unlinked Basecamp to-do is titled "${title}". Nothing was created or trashed.`,
            );
        }
    }
    if (match) input.claimed.add(match.id);
    const trashRecordingId = child.basecampTodoId;
    const childCompleted = childDone(child, recording);
    const plan = planCompletion({
        childCompleted,
        targetCompleted: match?.completed === true,
        parent: null,
        parentTaskCompleted: false,
        needsOpenParent: false,
    });
    if (input.dryRun) {
        return blank(child, parentTaskId, null, {
            action: 'would-unnest',
            create: match ? null : { kind: 'todo', title, parentTodoId: null },
            reusedRecordingId: match?.id ?? null,
            trashRecordingId,
            linkedRecordingId: match?.id ?? null,
            completion: plan,
            message: `${match
                ? `Would reuse to-do ${match.id} and trash subtask ${trashRecordingId}.`
                : `Would create a to-do and trash subtask ${trashRecordingId}.`} ${completionSentence(plan)}`,
        });
    }
    if (!dependencies.provider.createTodo && !match) {
        return failed(child, parentTaskId, null, 500, 'task', 'Basecamp to-do creation is not available.');
    }

    let todoId = match?.id ?? null;
    if (!todoId) {
        const created = await dependencies.provider.createTodo!({
            projectId: input.projectId,
            todolistId,
            title,
            description: child.description ?? null,
            dueDate: child.dueDate ?? null,
            assigneePersonIds: child.assigneePersonIds ?? [],
        });
        if (!created.ok) return failed(child, parentTaskId, null, created.status, created.scope, created.message);
        if (!created.id) return failed(child, parentTaskId, null, 502, 'task', 'Basecamp returned 502.');
        todoId = created.id;
        input.claimed.add(todoId);
    }
    if (todoId === trashRecordingId) {
        return failed(child, parentTaskId, null, 409, 'task', 'Refusing to trash the recording this task is linked to.');
    }

    const linked = await saveLink(dependencies, child, input.projectId, todoId, trashRecordingId);
    if (!linked) {
        return failed(
            child,
            parentTaskId,
            null,
            500,
            'task',
            'The new to-do was created but its id was not saved, so the subtask was left in place.',
            plan,
        );
    }
    const finished = await finishCompletion(
        dependencies,
        input.projectId,
        null,
        { kind: 'todo', id: todoId },
        plan,
    );
    if (!finished.ok) {
        return failed(
            child,
            parentTaskId,
            null,
            finished.status,
            finished.scope,
            keptTrashMessage(trashRecordingId, finished.message),
            plan,
        );
    }
    const trashed = await dependencies.provider.trashRecording({ projectId: input.projectId, recordingId: trashRecordingId });
    if (!trashed.ok) {
        return failed(child, parentTaskId, null, trashed.status, trashed.scope, pendingTrashMessage(trashRecordingId), plan);
    }
    const cleared = await clearTrash(dependencies, child);
    if (!cleared) {
        return failed(child, parentTaskId, null, 500, 'task', pendingTrashMessage(trashRecordingId), plan);
    }
    return blank(child, parentTaskId, null, {
        action: 'unnested',
        create: match ? null : { kind: 'todo', title, parentTodoId: null },
        reusedRecordingId: match?.id ?? null,
        trashRecordingId,
        linkedRecordingId: todoId,
        completion: plan,
        carriedCompletion: childCompleted,
        message: `${trashed.alreadyGone
            ? 'Saved the to-do. The old subtask was already gone.'
            : (match ? 'Reused a to-do and trashed the old subtask.' : 'Created a to-do and trashed the old subtask.')} ${completionSentence(plan)}`,
    });
}

export interface RelinkParent {
    id: string;
    basecampTodoId: string | null;
    /** True when this parent task is done. */
    completed?: boolean;
    children: NestTask[];
}

/**
 * One result per child, in plan order. A failure on one child does not stop
 * the others. A real run then moves steps when Basecamp's order does not
 * match. `claimedRecordingIds` is copied, so the caller's set is left as it was.
 */
export async function relinkChildren(
    input: {
        projectId: string;
        dryRun: boolean;
        parents: readonly RelinkParent[];
        claimedRecordingIds: Iterable<string>;
    },
    dependencies: BasecampNestDependencies,
): Promise<NestResult[]> {
    const claimed = new Set(input.claimedRecordingIds);
    const results: NestResult[] = [];
    for (const parent of input.parents) {
        const children = sortByAppOrder(parent.children);
        for (const child of children) {
            results.push(await nestFlatChild({
                projectId: input.projectId,
                parentTodoId: parent.basecampTodoId,
                parentTaskId: parent.id,
                parentTaskCompleted: parent.completed === true,
                child,
                claimed,
                dryRun: input.dryRun,
            }, dependencies));
        }
        const repositionStep = dependencies.provider.repositionStep;
        if (input.dryRun || !parent.basecampTodoId || !repositionStep) continue;
        const parentTodoId = parent.basecampTodoId;
        const aligned = await alignBasecampStepOrder({
            projectId: input.projectId,
            parentTodoId,
            desiredStepIds: linkedStepIds(children),
            listSteps: () => dependencies.provider.listSteps({
                projectId: input.projectId,
                parentTodoId,
            }),
            repositionStep: move => repositionStep({
                projectId: input.projectId,
                stepId: move.stepId,
                position: move.position,
            }),
        });
        if (!aligned.ok) {
            results.push(failed(
                { id: parent.id, title: 'Subtask order', basecampTodoId: parentTodoId },
                parent.id,
                parentTodoId,
                aligned.status,
                aligned.scope,
                aligned.message,
            ));
        }
    }
    return results;
}
