/**
 * One SEO Plan push.
 *
 * The first time a task qualifies, this creates its to-do. Later calls update
 * that same to-do in one request (title, description, due, assignees,
 * completion subscribers), then completion and child steps. A task that
 * already has basecamp_todo_id is never created again. A child push is that
 * parent's update, and the result is stored on the child as well. There is
 * one attempt: a failure is stored and left for Retry or the nightly pass.
 * Nothing here talks to Basecamp; the provider is injected.
 */

import {
    nestFlatChild,
    unnestToTodo,
    type BasecampNestDependencies,
    type BasecampNestProvider,
    type NestResult,
    type NestTask,
} from './basecamp-nest';
import {
    classifyBasecampHttpFailure,
    planBasecampBanner,
    planTaskQualifiesForBasecampPush,
    type PlanBasecampBanner,
    type PlanBasecampFailureScope,
    type PlanBasecampSyncState,
} from './basecamp-push';

export interface PlanPushChild {
    id: string;
    title: string;
    basecampTodoId: string | null;
    /** Set when a replacement was saved and the old recording still needs to be trashed. */
    pendingTrashId?: string | null;
    /** `done` is carried onto the Basecamp step. */
    status?: string;
}

export interface PlanPushTask {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    status: string;
    stage: string | null;
    parentTaskId: string | null;
    basecampTodoId: string | null;
    /** Set when a replacement was saved and the old recording still needs to be trashed. */
    pendingTrashId?: string | null;
    assigneePersonIds: number[];
    completionSubscriberPersonIds: number[];
    children: PlanPushChild[];
}

export interface PlanPushClient {
    id: string;
    syncEnabled: boolean;
    projectId: string | null;
    todolistId: string | null;
    projectName: string | null;
    todolistName: string | null;
    syncState: string | null;
    syncError: string | null;
}

export interface PlanPushSnapshot {
    task: PlanPushTask;
    client: PlanPushClient;
    /**
     * Set when this row sits under a pillar. The runner pushes that pillar
     * instead of creating a second to-do for the child.
     */
    parent: { id: string; stage: string | null; dueDate: string | null } | null;
}

export type PlanProviderResult =
    | { ok: true; todoId?: string; completed?: boolean; supportsSubtasks?: boolean }
    | { ok: false; status: number; message: string; scope: PlanBasecampFailureScope };

export interface PlanPushProvider {
    createTodo(input: {
        projectId: string;
        todolistId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
        assigneePersonIds: number[];
        completionSubscriberPersonIds: number[];
    }): Promise<PlanProviderResult>;
    updateTodo(input: {
        projectId: string;
        todoId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
        assigneePersonIds: number[];
        completionSubscriberPersonIds: number[];
    }): Promise<PlanProviderResult>;
    getTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    completeTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    reopenTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    createStep(input: { projectId: string; parentTodoId: string; title: string }): Promise<PlanProviderResult>;
    /** POST /subtasks/{id}/completion.json. Optional so older fakes still typecheck. */
    completeStep?(input: { projectId: string; stepId: string }): Promise<PlanProviderResult>;
    /**
     * Present when this provider can tell a top-level to-do from a subtask.
     * Without them, a linked child is left as it is.
     */
    inspectRecording?: BasecampNestProvider['inspectRecording'];
    listSteps?: BasecampNestProvider['listSteps'];
    listTodos?: BasecampNestProvider['listTodos'];
    trashRecording?: BasecampNestProvider['trashRecording'];
}

export interface PlanPushStore {
    load(taskId: string): Promise<PlanPushSnapshot | null>;
    linkTodo(
        taskId: string,
        projectId: string,
        todoId: string,
        at: string,
        pendingTrashId?: string | null,
    ): Promise<void>;
    /** Clears a pending-trash error after the old recording is gone. */
    clearPendingTrash?(taskId: string, at: string): Promise<void>;
    /** Recording ids already stored on tasks for this client. Used so a retry reuses one step. */
    listClaimedRecordingIds?(clientId: string): Promise<string[]>;
    recordTask(taskId: string, sync: PlanBasecampSyncState): Promise<void>;
    recordClient(clientId: string, sync: { state: 'ok' | 'failed'; error: string | null }): Promise<void>;
}

export interface PlanPushDependencies {
    store: PlanPushStore;
    provider: PlanPushProvider;
    now: () => string;
}

export type PlanPushOutcome =
    | { status: 'skipped'; reason: 'missing' | 'no-project' | 'not-qualified' }
    | { status: 'ok'; sync: PlanBasecampSyncState; todoId: string; banner: PlanBasecampBanner }
    | { status: 'failed'; sync: PlanBasecampSyncState; scope: PlanBasecampFailureScope; banner: PlanBasecampBanner };

function bannerFor(client: PlanPushClient, override?: { state: 'ok' | 'failed'; error: string | null }): PlanBasecampBanner {
    return planBasecampBanner({
        syncEnabled: client.syncEnabled,
        projectId: client.projectId,
        syncState: override?.state ?? client.syncState,
        syncError: override ? override.error : client.syncError,
    });
}

function failure(
    result: Extract<PlanProviderResult, { ok: false }>,
): { message: string; scope: PlanBasecampFailureScope } {
    return {
        message: result.message,
        scope: result.scope || classifyBasecampHttpFailure(result.status, 'other'),
    };
}

/** The row being pushed, plus any child whose push was redirected onto it. */
function recordedTaskIds(snapshot: PlanPushSnapshot, seen: ReadonlySet<string>): string[] {
    return [...new Set([snapshot.task.id, ...seen])];
}

async function rememberFailure(
    dependencies: PlanPushDependencies,
    snapshot: PlanPushSnapshot,
    error: string,
    scope: PlanBasecampFailureScope,
    seen: ReadonlySet<string>,
): Promise<PlanPushOutcome> {
    const sync: PlanBasecampSyncState = {
        state: 'failed',
        error,
        attemptedAt: dependencies.now(),
    };
    for (const taskId of recordedTaskIds(snapshot, seen)) {
        await dependencies.store.recordTask(taskId, sync);
    }
    if (scope === 'client') {
        await dependencies.store.recordClient(snapshot.client.id, { state: 'failed', error });
    }
    return {
        status: 'failed',
        sync,
        scope,
        banner: bannerFor(
            snapshot.client,
            scope === 'client' ? { state: 'failed', error } : undefined,
        ),
    };
}

async function rememberOk(
    dependencies: PlanPushDependencies,
    snapshot: PlanPushSnapshot,
    todoId: string,
    seen: ReadonlySet<string>,
): Promise<PlanPushOutcome> {
    const sync: PlanBasecampSyncState = {
        state: 'ok',
        error: null,
        attemptedAt: dependencies.now(),
    };
    for (const taskId of recordedTaskIds(snapshot, seen)) {
        await dependencies.store.recordTask(taskId, sync);
    }
    await dependencies.store.recordClient(snapshot.client.id, { state: 'ok', error: null });
    return {
        status: 'ok',
        sync,
        todoId,
        banner: bannerFor(snapshot.client, { state: 'ok', error: null }),
    };
}

/** Adapt a plan push provider. Null when it cannot tell a to-do from a subtask. */
export function asBasecampNestProvider(provider: PlanPushProvider): BasecampNestProvider | null {
    if (!provider.inspectRecording || !provider.listSteps || !provider.trashRecording) return null;
    return {
        inspectRecording: provider.inspectRecording,
        listSteps: provider.listSteps,
        listTodos: provider.listTodos,
        trashRecording: provider.trashRecording,
        async createStep(input) {
            const result = await provider.createStep(input);
            if (!result.ok) return { ok: false, status: result.status, message: result.message, scope: result.scope };
            if (!result.todoId) return { ok: false, status: 502, message: `Basecamp subtask sync failed: ${input.title}`, scope: 'task' };
            return { ok: true, id: result.todoId };
        },
        async createTodo(input) {
            const result = await provider.createTodo({
                ...input,
                completionSubscriberPersonIds: [],
            });
            if (!result.ok) return { ok: false, status: result.status, message: result.message, scope: result.scope };
            if (!result.todoId) return { ok: false, status: 502, message: 'Basecamp returned 502.', scope: 'task' };
            return { ok: true, id: result.todoId };
        },
        async completeStep(input) {
            if (!provider.completeStep) {
                return { ok: false, status: 500, message: 'Basecamp step completion is not available.', scope: 'task' };
            }
            const result = await provider.completeStep(input);
            if (!result.ok) return { ok: false, status: result.status, message: result.message, scope: result.scope };
            return { ok: true };
        },
        async completeTodo(input) {
            const result = await provider.completeTodo(input);
            if (!result.ok) return { ok: false, status: result.status, message: result.message, scope: result.scope };
            return { ok: true };
        },
        async reopenTodo(input) {
            const result = await provider.reopenTodo(input);
            if (!result.ok) return { ok: false, status: result.status, message: result.message, scope: result.scope };
            return { ok: true };
        },
    };
}

function nestDependencies(dependencies: PlanPushDependencies): BasecampNestDependencies {
    return {
        now: dependencies.now,
        provider: asBasecampNestProvider(dependencies.provider)!,
        store: {
            async linkTodo(taskId, projectId, recordingId, at, pendingTrashId) {
                await dependencies.store.linkTodo(taskId, projectId, recordingId, at, pendingTrashId);
            },
            async clearPendingTrash(taskId, at) {
                await dependencies.store.clearPendingTrash?.(taskId, at);
            },
        },
    };
}

async function claimedIds(
    dependencies: PlanPushDependencies,
    clientId: string,
    extra: Array<string | null | undefined>,
): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const id of extra) {
        if (id) ids.add(id);
    }
    if (dependencies.store.listClaimedRecordingIds) {
        for (const id of await dependencies.store.listClaimedRecordingIds(clientId)) ids.add(id);
    }
    return ids;
}

function nestFailure(result: NestResult): PlanProviderResult {
    return {
        ok: false,
        status: result.status ?? 502,
        message: result.message ?? 'Basecamp subtask sync failed.',
        scope: result.scope ?? 'task',
    };
}

function asNestTask(task: PlanPushTask | PlanPushChild): NestTask {
    const full = task as PlanPushTask;
    return {
        id: task.id,
        title: task.title,
        basecampTodoId: task.basecampTodoId,
        pendingTrashId: task.pendingTrashId ?? null,
        completed: task.status === 'done',
        description: full.description ?? null,
        dueDate: full.dueDate ?? null,
        assigneePersonIds: full.assigneePersonIds ?? [],
    };
}

/**
 * A linked child whose recording is a top-level to-do becomes a subtask.
 * Children with no Basecamp id are still created below. A provider that
 * cannot inspect a recording keeps the old behavior and skips linked children.
 */
async function syncSteps(
    dependencies: PlanPushDependencies,
    projectId: string,
    parent: PlanPushTask,
    supportsSubtasks: boolean | undefined,
): Promise<PlanProviderResult> {
    const todoId = parent.basecampTodoId;
    if (!todoId) return { ok: true };
    if (supportsSubtasks === false) return { ok: true };
    const provider = asBasecampNestProvider(dependencies.provider);
    if (provider) {
        const claimed = await claimedIds(dependencies, parent.clientId, [
            todoId,
            ...parent.children.map(child => child.basecampTodoId),
        ]);
        const nesting = nestDependencies(dependencies);
        for (const child of parent.children) {
            if (!child.basecampTodoId && !child.pendingTrashId) continue;
            const nestChild = asNestTask(child);
            const outcome = await nestFlatChild({
                projectId,
                parentTodoId: todoId,
                parentTaskId: parent.id,
                parentTaskCompleted: parent.status === 'done',
                child: nestChild,
                claimed,
                dryRun: false,
            }, nesting);
            child.basecampTodoId = nestChild.basecampTodoId;
            child.pendingTrashId = nestChild.pendingTrashId ?? null;
            if (outcome.action === 'failed') return nestFailure(outcome);
        }
    }
    const unlinked = parent.children.filter(child => !child.basecampTodoId);
    for (const child of unlinked) {
        const step = await dependencies.provider.createStep({
            projectId,
            parentTodoId: todoId,
            title: child.title,
        });
        if (!step.ok) return step;
        if (!step.todoId) {
            return { ok: false, status: 502, message: `Basecamp subtask sync failed: ${child.title}`, scope: 'task' };
        }
        await dependencies.store.linkTodo(child.id, projectId, step.todoId, dependencies.now());
        child.basecampTodoId = step.todoId;
    }
    return { ok: true };
}

/**
 * The parent does not qualify for its own push, but it already has a to-do.
 * Nest this child anyway. Settled means the child's recording is now a step,
 * so the caller must not also update it as a top-level to-do.
 */
async function nestUnderUnqualifiedParent(
    dependencies: PlanPushDependencies,
    snapshot: PlanPushSnapshot,
    projectId: string,
    seen: ReadonlySet<string>,
): Promise<{ failed: PlanPushOutcome } | { settled: boolean }> {
    const provider = asBasecampNestProvider(dependencies.provider);
    const parent = snapshot.parent;
    if (!provider || !parent) return { settled: false };
    if (!snapshot.task.basecampTodoId && !snapshot.task.pendingTrashId) return { settled: false };
    const parentSnapshot = await dependencies.store.load(parent.id);
    const parentTodoId = parentSnapshot?.task.basecampTodoId ?? null;
    if (!parentTodoId) return { settled: false };
    const claimed = await claimedIds(dependencies, snapshot.task.clientId, [
        parentTodoId,
        snapshot.task.basecampTodoId,
    ]);
    const child = asNestTask(snapshot.task);
    const outcome = await nestFlatChild({
        projectId,
        parentTodoId,
        parentTaskId: parent.id,
        parentTaskCompleted: parentSnapshot?.task.status === 'done',
        child,
        claimed,
        dryRun: false,
    }, nestDependencies(dependencies));
    snapshot.task.basecampTodoId = child.basecampTodoId;
    snapshot.task.pendingTrashId = child.pendingTrashId ?? null;
    if (outcome.action === 'failed') {
        return {
            failed: await rememberFailure(
                dependencies,
                snapshot,
                outcome.message ?? 'Basecamp subtask sync failed.',
                outcome.scope ?? 'task',
                seen,
            ),
        };
    }
    const settled = outcome.action === 'nested'
        || outcome.action === 'already-nested'
        || outcome.action === 'finished-trash';
    return { settled };
}

async function syncCompletion(
    dependencies: PlanPushDependencies,
    projectId: string,
    task: PlanPushTask,
    desiredDone = task.status === 'done',
): Promise<PlanProviderResult> {
    const todoId = task.basecampTodoId;
    if (!todoId) return { ok: true };
    const remote = await dependencies.provider.getTodo({ projectId, todoId });
    if (!remote.ok) return remote;
    const remoteDone = remote.completed === true;
    if (desiredDone && !remoteDone) {
        return dependencies.provider.completeTodo({ projectId, todoId });
    }
    if (!desiredDone && remoteDone) {
        return dependencies.provider.reopenTodo({ projectId, todoId });
    }
    return { ok: true };
}

/**
 * Push one qualifying task onto its existing to-do, or create that to-do.
 * A child is pushed as a step of a qualifying parent, not as a second to-do.
 */
export async function syncPlanTask(
    taskId: string,
    dependencies: PlanPushDependencies,
    seen: ReadonlySet<string> = new Set(),
): Promise<PlanPushOutcome> {
    const snapshot = await dependencies.store.load(taskId);
    if (!snapshot) return { status: 'skipped', reason: 'missing' };

    const projectId = snapshot.client.projectId;
    if (!snapshot.client.syncEnabled || !projectId) return { status: 'skipped', reason: 'no-project' };

    const parent = snapshot.parent;
    if (
        parent
        && !seen.has(parent.id)
        && planTaskQualifiesForBasecampPush({ stage: parent.stage, dueDate: parent.dueDate })
    ) {
        return syncPlanTask(parent.id, dependencies, new Set([...seen, snapshot.task.id]));
    }

    if (parent && !planTaskQualifiesForBasecampPush({ stage: parent.stage, dueDate: parent.dueDate })) {
        const nested = await nestUnderUnqualifiedParent(dependencies, snapshot, projectId, seen);
        if ('failed' in nested) return nested.failed;
        if (nested.settled) {
            if (!planTaskQualifiesForBasecampPush({
                stage: snapshot.task.stage,
                dueDate: snapshot.task.dueDate,
            })) {
                return { status: 'skipped', reason: 'not-qualified' };
            }
            return rememberOk(dependencies, snapshot, snapshot.task.basecampTodoId ?? '', seen);
        }
    }

    if (!planTaskQualifiesForBasecampPush({
        stage: snapshot.task.stage,
        dueDate: snapshot.task.dueDate,
    })) {
        return { status: 'skipped', reason: 'not-qualified' };
    }

    const task = snapshot.task;
    let carriedCompletion = false;
    if (!snapshot.parent && task.basecampTodoId && asBasecampNestProvider(dependencies.provider)) {
        const claimed = await claimedIds(dependencies, task.clientId, [task.basecampTodoId]);
        const lifted = asNestTask(task);
        const outcome = await unnestToTodo({
            projectId,
            parentTodoId: null,
            parentTaskId: null,
            todolistId: snapshot.client.todolistId,
            child: lifted,
            claimed,
            dryRun: false,
        }, nestDependencies(dependencies));
        task.basecampTodoId = lifted.basecampTodoId;
        task.pendingTrashId = lifted.pendingTrashId ?? null;
        if (outcome.carriedCompletion) carriedCompletion = true;
        if (outcome.action === 'failed') {
            return rememberFailure(
                dependencies,
                snapshot,
                outcome.message ?? 'Basecamp subtask sync failed.',
                outcome.scope ?? 'task',
                seen,
            );
        }
    }

    let supportsSubtasks: boolean | undefined;
    if (!task.basecampTodoId) {
        const todolistId = snapshot.client.todolistId;
        if (!todolistId) {
            return rememberFailure(
                dependencies,
                snapshot,
                'Basecamp returned 404: the to-do list no longer exists'
                    + (snapshot.client.projectName ? ` in project "${snapshot.client.projectName}".` : '.'),
                'task',
                seen,
            );
        }
        const created = await dependencies.provider.createTodo({
            projectId,
            todolistId,
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
            assigneePersonIds: task.assigneePersonIds,
            completionSubscriberPersonIds: task.completionSubscriberPersonIds,
        });
        if (!created.ok) {
            const reason = failure(created);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope, seen);
        }
        if (!created.todoId) {
            return rememberFailure(dependencies, snapshot, 'Basecamp returned 502.', 'task', seen);
        }
        task.basecampTodoId = created.todoId;
        supportsSubtasks = created.supportsSubtasks;
        await dependencies.store.linkTodo(task.id, projectId, created.todoId, dependencies.now());
        if (task.status === 'done') {
            const completed = await dependencies.provider.completeTodo({ projectId, todoId: created.todoId });
            if (!completed.ok) {
                const reason = failure(completed);
                return rememberFailure(dependencies, snapshot, reason.message, reason.scope, seen);
            }
        }
    } else {
        const updated = await dependencies.provider.updateTodo({
            projectId,
            todoId: task.basecampTodoId,
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
            assigneePersonIds: task.assigneePersonIds,
            completionSubscriberPersonIds: task.completionSubscriberPersonIds,
        });
        if (!updated.ok) {
            const reason = failure(updated);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope, seen);
        }
        const completion = await syncCompletion(dependencies, projectId, task, task.status === 'done' || carriedCompletion);
        if (!completion.ok) {
            const reason = failure(completion);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope, seen);
        }
        supportsSubtasks = completion.supportsSubtasks;
    }

    const steps = await syncSteps(dependencies, projectId, task, supportsSubtasks);
    if (!steps.ok) {
        const reason = failure(steps);
        return rememberFailure(dependencies, snapshot, reason.message, reason.scope, seen);
    }

    return rememberOk(dependencies, snapshot, task.basecampTodoId ?? '', seen);
}
