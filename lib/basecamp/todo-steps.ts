/**
 * Basecamp to-do steps (the checklist under a to-do).
 *
 * They are `Kanban::Step` recordings. The to-do payload includes them, and
 * `GET /recordings/{todoId}/subtasks.json` lists the same records. A step id
 * is a recording id, distinct from the parent to-do id.
 */

export interface BasecampTodoStep {
    id: number;
    title: string;
    due_on: string | null;
    completed: boolean;
    completion: { created_at: string } | null;
    completed_at: string | null;
    assignees: Array<{ id: number }>;
    /** Basecamp's 1-based checklist order, when the payload has one. */
    position: number | null;
    /** Parent to-do id when the payload names one. */
    parentTodoId: number | null;
}

function positiveInt(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) return null;
    const numeric = Number(normalized);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

/** One step object from a to-do payload or a subtasks page. Trashed steps are dropped. */
export function normalizeBasecampTodoStep(value: unknown): BasecampTodoStep | null {
    const step = record(value);
    if (!step) return null;
    if (step.status === 'trashed') return null;

    const id = positiveInt(step.id);
    const title = text(step.title);
    if (id == null || !title) return null;

    const completionRecord = record(step.completion);
    const completedAt = text(completionRecord?.created_at);
    const parent = record(step.parent);
    const position = typeof step.position === 'number' && Number.isFinite(step.position)
        ? step.position
        : null;

    const assignees: Array<{ id: number }> = [];
    if (Array.isArray(step.assignees)) {
        for (const assignee of step.assignees) {
            const personId = positiveInt(record(assignee)?.id);
            if (personId != null) assignees.push({ id: personId });
        }
    }

    return {
        id,
        title,
        due_on: text(step.due_on),
        completed: step.completed === true,
        completion: completedAt ? { created_at: completedAt } : null,
        completed_at: text(step.completed_at),
        assignees,
        position,
        parentTodoId: positiveInt(parent?.id) ?? positiveInt(step.parentTodoId),
    };
}

/** Items from a subtasks.json page: a bare array, or `{ steps: [...] }`. */
export function basecampStepPageItems(body: unknown): unknown[] {
    if (Array.isArray(body)) return body;
    const wrapped = record(body);
    return Array.isArray(wrapped?.steps) ? wrapped.steps : [];
}

/**
 * One step per recording id. Earlier groups win, so a dedicated list can be
 * followed by the steps embedded on the to-do without duplicating either.
 * Order follows Basecamp's position, then id.
 */
export function mergeBasecampTodoSteps(groups: readonly unknown[][]): BasecampTodoStep[] {
    const byId = new Map<number, BasecampTodoStep>();
    for (const value of groups.flat()) {
        const step = normalizeBasecampTodoStep(value);
        if (!step || byId.has(step.id)) continue;
        byId.set(step.id, step);
    }
    return [...byId.values()].sort((left, right) => {
        const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
        const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
        return left.id - right.id;
    });
}

/** Keep steps that belong to this to-do. A step that names no parent stays. */
export function stepsForTodo(steps: readonly BasecampTodoStep[], todoId: string): BasecampTodoStep[] {
    const id = positiveInt(todoId);
    if (id == null) return [];
    return steps.filter(step => step.parentTodoId == null || step.parentTodoId === id);
}
