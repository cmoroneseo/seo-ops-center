/**
 * Basecamp calls for one SEO Plan push.
 * Existing task push stays on its own route. This one returns the status and
 * the raw error instead of swallowing them. An update sends content,
 * description, due date, assignees, and completion subscribers together.
 * Basecamp clears any of those fields that the call leaves out, and it
 * rejects a call that has no content.
 */

import {
    basecampRecordingPath,
    basecampSubtaskCompletionPath,
    basecampSubtaskCreatePath,
    basecampSubtaskPositionPath,
    basecampSubtaskSupport,
    basecampTodoUpdateBody,
    basecampTrashPath,
    basecampWriteJson,
} from './api';
import { recordingFromRead, type ListedRecording, type NestScope } from '../seo-plan/basecamp-nest';
import { basecampStepPageItems, mergeBasecampTodoSteps } from './todo-steps';
import {
    classifyBasecampHttpFailure,
    formatBasecampHttpFailure,
    type BasecampHttpOperation,
} from '../seo-plan/basecamp-push';
import type { PlanProviderResult, PlanPushProvider } from '../seo-plan/basecamp-push-run';

function numeric(value: string): string | null {
    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function fromWrite(
    result: Awaited<ReturnType<typeof basecampWriteJson>>,
    operation: BasecampHttpOperation,
    hint?: { listName?: string | null; projectName?: string | null },
): PlanProviderResult {
    if (!result.ok) {
        return {
            ok: false,
            status: result.status,
            scope: classifyBasecampHttpFailure(result.status, operation),
            message: formatBasecampHttpFailure(result.status, result.detail, { operation, ...hint }),
        };
    }
    const body = asRecord(result.body);
    const id = body && (typeof body.id === 'number' || typeof body.id === 'string') ? String(body.id) : undefined;
    return {
        ok: true,
        ...(id ? { todoId: id } : {}),
        ...(typeof body?.completed === 'boolean' ? { completed: body.completed } : {}),
        ...(body ? { supportsSubtasks: basecampSubtaskSupport(body) } : {}),
    };
}

export function createPlanBasecampProvider(hint: {
    listName?: string | null;
    projectName?: string | null;
} = {}): PlanPushProvider {
    const names = () => ({ listName: hint.listName, projectName: hint.projectName });
    return {
        async createTodo(input) {
            const projectId = numeric(input.projectId);
            const todolistId = numeric(input.todolistId);
            if (!projectId || !todolistId) {
                return fromWrite({ ok: false, status: 404, detail: '' }, 'todolist', names());
            }
            const body: Record<string, unknown> = { content: input.title };
            if (input.dueDate) body.due_on = input.dueDate;
            if (input.description) body.description = input.description;
            if (input.assigneePersonIds.length > 0) body.assignee_ids = input.assigneePersonIds;
            if (input.completionSubscriberPersonIds.length > 0) {
                body.completion_subscriber_ids = input.completionSubscriberPersonIds;
            }
            const result = await basecampWriteJson(
                `/buckets/${projectId}/todolists/${todolistId}/todos.json`,
                'POST',
                body,
            );
            return fromWrite(result, result.ok ? 'todo' : 'todolist', names());
        },
        async updateTodo(input) {
            const projectId = numeric(input.projectId);
            const todoId = numeric(input.todoId);
            if (!projectId || !todoId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(
                `/buckets/${projectId}/todos/${todoId}.json`,
                'PATCH',
                basecampTodoUpdateBody({
                    content: input.title,
                    description: input.description,
                    dueOn: input.dueDate,
                    assigneePersonIds: input.assigneePersonIds,
                    completionSubscriberPersonIds: input.completionSubscriberPersonIds,
                }),
            );
            return fromWrite(result, 'todo', names());
        },
        async getTodo(input) {
            const projectId = numeric(input.projectId);
            const todoId = numeric(input.todoId);
            if (!projectId || !todoId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(`/buckets/${projectId}/todos/${todoId}.json`, 'GET');
            return fromWrite(result, 'todo', names());
        },
        async completeTodo(input) {
            const projectId = numeric(input.projectId);
            const todoId = numeric(input.todoId);
            if (!projectId || !todoId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(`/buckets/${projectId}/todos/${todoId}/completion.json`, 'POST');
            return fromWrite(result, 'todo', names());
        },
        async reopenTodo(input) {
            const projectId = numeric(input.projectId);
            const todoId = numeric(input.todoId);
            if (!projectId || !todoId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(`/buckets/${projectId}/todos/${todoId}/completion.json`, 'DELETE');
            return fromWrite(result, 'todo', names());
        },
        async createStep(input) {
            const projectId = numeric(input.projectId);
            const parentTodoId = numeric(input.parentTodoId);
            if (!projectId || !parentTodoId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(basecampSubtaskCreatePath(parentTodoId), 'POST', {
                title: input.title,
            });
            return fromWrite(result, 'todo', names());
        },
        async repositionStep(input) {
            const projectId = numeric(input.projectId);
            const stepId = numeric(input.stepId);
            if (!projectId || !stepId || !Number.isSafeInteger(input.position) || input.position < 1) {
                return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            }
            const result = await basecampWriteJson(basecampSubtaskPositionPath(stepId), 'PUT', {
                position: input.position,
            });
            return fromWrite(result, 'todo', names());
        },
        async inspectRecording(input) {
            const projectId = numeric(input.projectId);
            const recordingId = numeric(input.recordingId);
            if (!projectId || !recordingId) return nestFailure(404, 'todo', names());
            const result = await basecampWriteJson(basecampRecordingPath(projectId, recordingId), 'GET');
            if (!result.ok && result.status === 404) return { ok: true as const, recording: { kind: 'missing' as const } };
            if (!result.ok) return nestFailure(result.status, 'todo', names(), result.detail);
            return { ok: true as const, recording: recordingFromRead(200, result.body) };
        },
        async listSteps(input) {
            const projectId = numeric(input.projectId);
            const parentTodoId = numeric(input.parentTodoId);
            if (!projectId || !parentTodoId) return nestFailure(404, 'todo', names());
            const pages = await readPages(basecampSubtaskCreatePath(parentTodoId), names());
            if (!pages.ok) return pages;
            const steps = mergeBasecampTodoSteps(pages.bodies.map(body => basecampStepPageItems(body)))
                .map(step => ({ id: String(step.id), title: step.title, completed: step.completed }));
            return { ok: true as const, steps };
        },
        async completeStep(input) {
            const stepId = numeric(input.stepId);
            if (!stepId) return fromWrite({ ok: false, status: 404, detail: '' }, 'todo', names());
            const result = await basecampWriteJson(basecampSubtaskCompletionPath(stepId), 'POST');
            return fromWrite(result, 'todo', names());
        },
        async listTodos(input) {
            const projectId = numeric(input.projectId);
            const todolistId = numeric(input.todolistId);
            if (!projectId || !todolistId) return nestFailure(404, 'todolist', names());
            const pages = await readPages(`/buckets/${projectId}/todolists/${todolistId}/todos.json`, names());
            if (!pages.ok) return pages;
            const todos: ListedRecording[] = [];
            for (const body of pages.bodies) {
                if (!Array.isArray(body)) {
                    return nestFailure(502, 'todolist', names(), 'Basecamp to-do list was not a list.');
                }
                for (const value of body) {
                    const listed = listedTodo(value);
                    if (listed) todos.push(listed);
                }
            }
            return { ok: true as const, todos };
        },
        async trashRecording(input) {
            const projectId = numeric(input.projectId);
            const recordingId = numeric(input.recordingId);
            if (!projectId || !recordingId) return nestFailure(404, 'todo', names());
            const result = await basecampWriteJson(basecampTrashPath(projectId, recordingId), 'PUT');
            if (!result.ok && (result.status === 404 || result.status === 410)) {
                return { ok: true as const, alreadyGone: true };
            }
            if (!result.ok) return nestFailure(result.status, 'todo', names(), result.detail);
            return { ok: true as const, alreadyGone: false };
        },
    };
}

function listedTodo(value: unknown): ListedRecording | null {
    const row = asRecord(value);
    if (!row || row.status === 'trashed') return null;
    const id = typeof row.id === 'number' || typeof row.id === 'string' ? numeric(String(row.id)) : null;
    const title = typeof row.title === 'string' && row.title.trim()
        ? row.title.trim()
        : (typeof row.content === 'string' ? row.content.trim() : '');
    if (!id || !title) return null;
    return { id, title, completed: row.completed === true };
}

function nestFailure(
    status: number,
    operation: BasecampHttpOperation,
    hint: { listName?: string | null; projectName?: string | null },
    detail = '',
): { ok: false; status: number; message: string; scope: NestScope } {
    return {
        ok: false,
        status,
        scope: classifyBasecampHttpFailure(status, operation),
        message: formatBasecampHttpFailure(status, detail, { operation, ...hint }),
    };
}

/** Follow Basecamp's Link header. A failed page fails the read so a retry does not create a duplicate. */
async function readPages(
    startPath: string,
    hint: { listName?: string | null; projectName?: string | null },
): Promise<{ ok: true; bodies: unknown[] } | { ok: false; status: number; message: string; scope: NestScope }> {
    const bodies: unknown[] = [];
    let path: string | null = startPath;
    const seen = new Set<string>();
    while (path && !seen.has(path)) {
        seen.add(path);
        const result = await basecampWriteJson(path, 'GET');
        if (!result.ok) return nestFailure(result.status, 'todo', hint, result.detail);
        bodies.push(result.body);
        path = result.nextPath && !seen.has(result.nextPath) ? result.nextPath : null;
    }
    return { ok: true, bodies };
}
