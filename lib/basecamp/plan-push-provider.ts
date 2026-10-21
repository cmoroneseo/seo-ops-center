/**
 * Basecamp calls for one SEO Plan push.
 * Existing task push stays on its own route. This one returns the status and
 * the raw error instead of swallowing them. An update sends content,
 * description, due date, assignees, and completion subscribers together.
 * Basecamp clears any of those fields that the call leaves out, and it
 * rejects a call that has no content.
 */

import { basecampSubtaskCreatePath, basecampSubtaskSupport, basecampTodoUpdateBody, basecampWriteJson } from './api';
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
    };
}
