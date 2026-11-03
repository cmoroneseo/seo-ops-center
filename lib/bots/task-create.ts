import { PLAN_LABELS } from '../seo-plan/plan-panel.ts';
import { taskCreateRow } from '../tasks/create-row.ts';

/**
 * Labels a new task can carry without looking at the client.
 * The SEO Plan picker writes the six plan ids. The create-task window
 * adds `reporting`. Anything else is a label the client already has,
 * usually a Basecamp list title copied in at import.
 */
export const BUILT_IN_TASK_CATEGORIES = [
    ...PLAN_LABELS.map(label => label.id),
    'reporting',
] as const;

export const TASK_CATEGORY_MAX_LENGTH = 80;

export const TASK_CATEGORY_ERROR =
    'category must be content, technical, local, links, strategy, admin, or reporting, or a label this client already uses.';

const CONTROL = /[\u0000-\u001f\u007f]/;

export function isBuiltInTaskCategory(value: string): boolean {
    return (BUILT_IN_TASK_CATEGORIES as readonly string[]).includes(value);
}

/** Shape only. Whether a custom label already exists is checked once the client is known. */
export function taskCategoryShapeError(value: string): string | null {
    if (value.length > TASK_CATEGORY_MAX_LENGTH) {
        return `category must be ${TASK_CATEGORY_MAX_LENGTH} characters or fewer.`;
    }
    if (CONTROL.test(value)) return 'category must be one line.';
    return null;
}

export function taskCategoryAllowed(category: string, existingLabels: readonly string[]): boolean {
    return isBuiltInTaskCategory(category) || existingLabels.includes(category);
}

export interface BotCreatedTaskInput {
    organizationId: string;
    clientId: string;
    title: string;
    category?: string;
    dueDate?: string;
    actorUserId: string;
    botKeyId: string;
    botOperationId: string;
    now: string;
}

/**
 * The create-task row, with the bot actor filled in as the assignee.
 *
 * `taskCreateRow` is what the create window and the SEO Plan add bar insert.
 * Those screens write `assignee_ids` and leave the older `assignee_id` column
 * empty. The plan list, the task drawer, and the Basecamp push all read
 * `assignee_ids`. This row also sets `assignee_id` to the same user so the
 * legacy column is not left null.
 *
 * Category stays off the row when the request omits it. A chosen label is
 * stored only in `category`. `tags` stays empty, which is what a new task
 * gets. The plan panel copies a label into both columns later, when someone
 * edits labels. Stage and position stay off the row so the database defaults
 * (backlog, 0) remain, the same as the create window.
 */
export function botCreatedTaskRow(input: BotCreatedTaskInput): Record<string, unknown> {
    const row: Record<string, unknown> = {
        ...taskCreateRow({
            organizationId: input.organizationId,
            clientId: input.clientId,
            title: input.title,
            ...(input.category ? { category: input.category } : {}),
            ...(input.dueDate ? { dueDate: input.dueDate } : {}),
            assigneeIds: [input.actorUserId],
            createdBy: input.actorUserId,
            status: 'todo',
            priority: 'medium',
        }),
        assignee_id: input.actorUserId,
        status_history: [{ status: 'todo', at: input.now, by: input.actorUserId }],
        bot_key_id: input.botKeyId,
        bot_operation_id: input.botOperationId,
    };
    for (const key of Object.keys(row)) {
        if (row[key] === undefined) delete row[key];
    }
    return row;
}
