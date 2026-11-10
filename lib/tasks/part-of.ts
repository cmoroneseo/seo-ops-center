/**
 * A work-plan task can belong to one roadmap row for the same client.
 * The screen calls that link "Part of". Do not label it initiative or pillar.
 */

export const PART_OF_TERM = 'Part of';

export const PART_OF_MAIN_TASK_ERROR = 'Part of applies to the main task.';
export const PART_OF_OTHER_CLIENT_ERROR = 'That work is for a different client.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PartOfChoice {
    id: string;
    title: string;
}

export interface PartOfTask {
    id: string;
    title: string;
    status: string;
    parentTaskId: string | null;
    initiativeId: string | null;
}

export interface PartOfProgress {
    done: number;
    total: number;
    label: string;
    tasks: { id: string; title: string; status: string; done: boolean }[];
}

export function partOfLine(title: string | null, linked: boolean): string {
    if (title) return `${PART_OF_TERM}: ${title}`;
    if (linked) return `${PART_OF_TERM}: Unavailable`;
    return `${PART_OF_TERM}: None`;
}

export function partOfWrite(
    task: { parentTaskId: string | null; clientId: string | null; organizationId: string | null },
    initiative: { id: string; clientId: string; organizationId: string } | null,
    nextId: string | null,
): { ok: true; initiativeId: string | null } | { ok: false; error: string } {
    if (nextId == null || nextId === '') return { ok: true, initiativeId: null };
    const id = nextId.trim();
    if (!UUID.test(id)) return { ok: false, error: PART_OF_OTHER_CLIENT_ERROR };
    if (task.parentTaskId) return { ok: false, error: PART_OF_MAIN_TASK_ERROR };
    if (!task.clientId || !task.organizationId || !initiative) return { ok: false, error: PART_OF_OTHER_CLIENT_ERROR };
    if (initiative.id !== id || initiative.clientId !== task.clientId || initiative.organizationId !== task.organizationId) {
        return { ok: false, error: PART_OF_OTHER_CLIENT_ERROR };
    }
    return { ok: true, initiativeId: id };
}

/** Top-level tasks linked to one roadmap row. None linked returns null so the row stays as it was. */
export function linkedTaskProgress(initiativeId: string, tasks: readonly PartOfTask[]): PartOfProgress | null {
    const linked = tasks.filter(task => task.initiativeId === initiativeId && !task.parentTaskId && task.id);
    if (linked.length === 0) return null;
    const rows = linked.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        done: task.status === 'done',
    }));
    const done = rows.filter(row => row.done).length;
    return {
        done,
        total: rows.length,
        label: `${done} of ${rows.length} tasks done`,
        tasks: rows,
    };
}

/** Keep a matching main task and the tasks nested under it. */
export function tasksPartOf<T extends { id: string; parentTaskId: string | null; initiativeId?: string | null }>(
    tasks: readonly T[],
    initiativeId: string | null,
): T[] {
    if (!initiativeId) return [...tasks];
    const parents = new Set(
        tasks.filter(task => !task.parentTaskId && task.initiativeId === initiativeId).map(task => task.id),
    );
    return tasks.filter(task => (task.parentTaskId ? parents.has(task.parentTaskId) : parents.has(task.id)));
}
