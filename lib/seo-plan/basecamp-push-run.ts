/**
 * One SEO Plan push.
 *
 * The first time a task qualifies, this creates its to-do. Later calls update
 * that same to-do (title, due, assignees, description, complete or reopen,
 * and child steps). A task that already has basecamp_todo_id is never created
 * again. There is one attempt: a failure is stored and left for Retry or the
 * nightly pass. Nothing here talks to Basecamp; the provider is injected.
 */

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
    assigneePersonIds: number[];
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
    }): Promise<PlanProviderResult>;
    updateTodo(input: {
        projectId: string;
        todoId: string;
        title: string;
        description: string | null;
        dueDate: string | null;
    }): Promise<PlanProviderResult>;
    setAssignees(input: {
        projectId: string;
        todoId: string;
        assigneePersonIds: number[];
    }): Promise<PlanProviderResult>;
    getTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    completeTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    reopenTodo(input: { projectId: string; todoId: string }): Promise<PlanProviderResult>;
    createStep(input: { projectId: string; parentTodoId: string; title: string }): Promise<PlanProviderResult>;
}

export interface PlanPushStore {
    load(taskId: string): Promise<PlanPushSnapshot | null>;
    linkTodo(taskId: string, projectId: string, todoId: string, at: string): Promise<void>;
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

async function rememberFailure(
    dependencies: PlanPushDependencies,
    snapshot: PlanPushSnapshot,
    error: string,
    scope: PlanBasecampFailureScope,
): Promise<PlanPushOutcome> {
    const sync: PlanBasecampSyncState = {
        state: 'failed',
        error,
        attemptedAt: dependencies.now(),
    };
    await dependencies.store.recordTask(snapshot.task.id, sync);
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
): Promise<PlanPushOutcome> {
    const sync: PlanBasecampSyncState = {
        state: 'ok',
        error: null,
        attemptedAt: dependencies.now(),
    };
    await dependencies.store.recordTask(snapshot.task.id, sync);
    await dependencies.store.recordClient(snapshot.client.id, { state: 'ok', error: null });
    return {
        status: 'ok',
        sync,
        todoId,
        banner: bannerFor(snapshot.client, { state: 'ok', error: null }),
    };
}

async function syncSteps(
    dependencies: PlanPushDependencies,
    projectId: string,
    parent: PlanPushTask,
    supportsSubtasks: boolean | undefined,
): Promise<PlanProviderResult> {
    const unlinked = parent.children.filter(child => !child.basecampTodoId);
    if (unlinked.length === 0) return { ok: true };
    if (supportsSubtasks === false) return { ok: true };
    const todoId = parent.basecampTodoId;
    if (!todoId) return { ok: true };
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

async function syncCompletion(
    dependencies: PlanPushDependencies,
    projectId: string,
    task: PlanPushTask,
): Promise<PlanProviderResult> {
    const todoId = task.basecampTodoId;
    if (!todoId) return { ok: true };
    const remote = await dependencies.provider.getTodo({ projectId, todoId });
    if (!remote.ok) return remote;
    const remoteDone = remote.completed === true;
    if (task.status === 'done' && !remoteDone) {
        return dependencies.provider.completeTodo({ projectId, todoId });
    }
    if (task.status !== 'done' && remoteDone) {
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

    if (!planTaskQualifiesForBasecampPush({
        stage: snapshot.task.stage,
        dueDate: snapshot.task.dueDate,
    })) {
        return { status: 'skipped', reason: 'not-qualified' };
    }

    const task = snapshot.task;
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
            );
        }
        const created = await dependencies.provider.createTodo({
            projectId,
            todolistId,
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
            assigneePersonIds: task.assigneePersonIds,
        });
        if (!created.ok) {
            const reason = failure(created);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
        }
        if (!created.todoId) {
            return rememberFailure(dependencies, snapshot, 'Basecamp returned 502.', 'task');
        }
        task.basecampTodoId = created.todoId;
        supportsSubtasks = created.supportsSubtasks;
        await dependencies.store.linkTodo(task.id, projectId, created.todoId, dependencies.now());
        if (task.status === 'done') {
            const completed = await dependencies.provider.completeTodo({ projectId, todoId: created.todoId });
            if (!completed.ok) {
                const reason = failure(completed);
                return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
            }
        }
    } else {
        const updated = await dependencies.provider.updateTodo({
            projectId,
            todoId: task.basecampTodoId,
            title: task.title,
            description: task.description,
            dueDate: task.dueDate,
        });
        if (!updated.ok) {
            const reason = failure(updated);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
        }
        const assignees = await dependencies.provider.setAssignees({
            projectId,
            todoId: task.basecampTodoId,
            assigneePersonIds: task.assigneePersonIds,
        });
        if (!assignees.ok) {
            const reason = failure(assignees);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
        }
        const completion = await syncCompletion(dependencies, projectId, task);
        if (!completion.ok) {
            const reason = failure(completion);
            return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
        }
        supportsSubtasks = completion.supportsSubtasks;
    }

    const steps = await syncSteps(dependencies, projectId, task, supportsSubtasks);
    if (!steps.ok) {
        const reason = failure(steps);
        return rememberFailure(dependencies, snapshot, reason.message, reason.scope);
    }

    return rememberOk(dependencies, snapshot, task.basecampTodoId ?? '');
}
