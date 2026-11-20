import { draftsForSteps, linkImportedSteps, type ProviderTodo } from './import-tasks-route.ts';
import { groupByStepTitle, mergeBasecampTodoSteps, normalizeStepTitle, stepsForTodo, type BasecampTodoStep } from './todo-steps.ts';

export interface BasecampLinkedTask {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    stage?: string | null;
    category: string | null;
    priority?: string | null;
    parentTaskId: string | null;
    basecampTodoId: string | null;
    basecampProjectId: string | null;
}

type Todo = ProviderTodo & { supportsSubtasks?: boolean };

export interface BasecampTodoReader {
    recordingKind(projectId: string, id: string): Promise<'todo' | 'step' | null>;
    getTodo(projectId: string, id: string): Promise<Todo | null>;
    listSteps(projectId: string, todoId: string): Promise<BasecampTodoStep[]>;
}

export interface BasecampLinkStore<T extends BasecampLinkedTask> {
    findRecordings(ids: string[]): Promise<T[]>;
    listChildren(parent: T): Promise<T[]>;
    updateTaskLink(task: T, projectId: string, id: string, syncedAt: string): Promise<T | null>;
    insertImportedTasks(rows: Record<string, unknown>[]): Promise<T[]>;
}

export async function readBasecampTodo(reader: BasecampTodoReader, projectId: string, todoId: string) {
    const kind = await reader.recordingKind(projectId, todoId);
    if (kind === 'step') return { kind } as const;
    const todo = kind === 'todo' ? await reader.getTodo(projectId, todoId) : null;
    if (!todo || String(todo.id) !== todoId || !todo.title?.trim()) return { kind: 'missing' } as const;
    return { kind: 'todo', todo } as const;
}

export async function readBasecampTodoSteps(
    reader: BasecampTodoReader, projectId: string, todoId: string, todo: Todo,
): Promise<BasecampTodoStep[]> {
    const listed = todo.supportsSubtasks === false ? [] : await reader.listSteps(projectId, todoId);
    const embedded = Array.isArray(todo.steps) ? todo.steps : [];
    return stepsForTodo(mergeBasecampTodoSteps([listed, embedded]), todoId)
        .filter(step => String(step.id) !== todoId);
}

export async function importBasecampTodoSteps<T extends BasecampLinkedTask>(input: {
    store: BasecampLinkStore<T>;
    root: T;
    steps: BasecampTodoStep[];
    projectId: string;
    todoId: string;
    userId: string;
    now: string;
    matchExistingTitles: boolean;
    resolveAssignees?: (personIds: number[]) => Promise<Map<number, string>>;
}) {
    const { store, root, steps, projectId, todoId, userId, now } = input;
    const known = steps.length > 0 ? await store.findRecordings(steps.map(step => String(step.id))) : [];
    const claimCounts = new Map<string, number>();
    for (const child of known) {
        if (child.basecampTodoId) claimCounts.set(child.basecampTodoId, (claimCounts.get(child.basecampTodoId) ?? 0) + 1);
    }
    const claimedIds = new Set([...claimCounts.keys()].map(Number));
    const stepsByTitle = groupByStepTitle(steps);
    const childrenByStepId = new Map<string, T>();
    let linked = 0;

    if (input.matchExistingTitles && steps.length > 0) {
        const local = await store.listChildren(root);
        const localByTitle = groupByStepTitle(local);
        for (const task of local) {
            if (task.basecampTodoId && claimCounts.get(task.basecampTodoId) === 1
                && (!task.basecampProjectId || task.basecampProjectId === projectId)) {
                childrenByStepId.set(task.basecampTodoId, task);
            }
        }
        // Preserve a local child only when its title identifies one provider step.
        for (const step of steps) {
            if (claimedIds.has(step.id)) continue;
            const title = normalizeStepTitle(step.title);
            const candidates = localByTitle.get(title);
            const child = candidates?.[0];
            if (stepsByTitle.get(title)?.length !== 1 || candidates?.length !== 1 || !child || child.basecampTodoId) continue;
            const saved = await store.updateTaskLink(child, projectId, String(step.id), now);
            if (!saved) throw new Error('Basecamp step link changed during import');
            linked += 1;
            claimedIds.add(step.id);
            childrenByStepId.set(String(step.id), saved);
        }
    }

    const drafts = await draftsForSteps({
        steps, parentBasecampTodoId: Number(todoId), organizationId: root.organizationId,
        clientId: root.clientId, userId, projectId, category: root.category, priority: root.priority,
        now, mirrorCompletion: true, resolveAssignees: input.resolveAssignees,
    });
    const rows = linkImportedSteps({
        drafts,
        parents: [{ basecampTodoId: Number(todoId), taskId: root.id, stage: root.stage ?? null }],
        alreadyImportedStepIds: claimedIds,
    });
    const imported = rows.length > 0 ? await store.insertImportedTasks(rows) : [];
    for (const child of imported) {
        if (child.basecampTodoId) childrenByStepId.set(child.basecampTodoId, child);
    }
    return { linked, imported, childrenByStepId, stepsByTitle };
}
