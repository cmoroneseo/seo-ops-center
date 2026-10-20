/**
 * When an SEO Plan task is allowed to push to Basecamp.
 *
 * A backlog task with no due date never pushes. A due date qualifies it,
 * and so does leaving Backlog (stage becomes onboarding, or a drag into
 * This month writes a due date). Clients with no Basecamp project are a
 * no-op decided by the caller; this predicate is only about the task.
 */

export const PLAN_BASECAMP_PUSH_DEBOUNCE_MS = 2000;

export const PLAN_BASECAMP_CLIENT_BANNER =
    'Basecamp isn\'t accepting pushes for this client. New changes stay in SEO Ops.';

export const PLAN_BASECAMP_FAILURE_TITLE = 'Didn\'t reach Basecamp';

export const PLAN_BASECAMP_FAILURE_BODY =
    'The last change to this task wasn\'t pushed. SEO Ops has it, so nothing is lost. Basecamp stays behind until a push succeeds.';

export type PlanBasecampSyncValue = 'ok' | 'failed';

export type PlanBasecampFailureScope = 'client' | 'task';

export interface PlanBasecampSyncState {
    state: PlanBasecampSyncValue;
    error: string | null;
    attemptedAt: string | null;
}

export interface PlanTaskPushInput {
    stage: string | null;
    dueDate: string | null;
}

/** Onboarding, or any task that has a due date. Undated backlog stays local. */
export function planTaskQualifiesForBasecampPush(task: PlanTaskPushInput): boolean {
    if (typeof task.dueDate === 'string' && task.dueDate.trim().length > 0) return true;
    return task.stage === 'onboarding';
}

/**
 * Stage is only onboarding or backlog, and migration 103 stores one of those
 * on every task. Stage by itself does not mean "this row belongs to the plan
 * push."
 */
export function isSeoPlanTask(stage: string | null | undefined): boolean {
    return stage === 'onboarding' || stage === 'backlog';
}

/**
 * Basecamp reopen is ignored only for a row this silent push has recorded.
 * Every task has a stage, so stage alone would also stop the Tasks page,
 * planner, and the older Send to Basecamp control from reopening.
 */
export function planTaskIgnoresBasecampReopen(
    stage: string | null | undefined,
    syncState: string | null | undefined,
): boolean {
    return isSeoPlanTask(stage) && (syncState === 'ok' || syncState === 'failed');
}

export interface PlanBasecampBannerInput {
    syncEnabled: boolean;
    projectId: string | null;
    syncState: string | null;
    syncError: string | null;
}

export interface PlanBasecampBanner {
    /** False when this client has no project to push to. The list stays quiet. */
    connected: boolean;
    /** Set only for a client-wide failure. The list then hides per-row dots. */
    failure: string | null;
}

export function parsePlanBasecampBanner(value: unknown): PlanBasecampBanner | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.connected !== 'boolean') return null;
    const failure = typeof record.failure === 'string' && record.failure.trim() ? record.failure : null;
    return { connected: record.connected, failure: record.connected ? failure : null };
}

export function planBasecampBanner(input: PlanBasecampBannerInput): PlanBasecampBanner {
    if (!input.syncEnabled || !input.projectId) return { connected: false, failure: null };
    if (input.syncState === 'failed') {
        const failure = input.syncError?.trim() || 'Basecamp isn\'t accepting pushes for this client.';
        return { connected: true, failure };
    }
    return { connected: true, failure: null };
}

export type BasecampHttpOperation = 'project' | 'todolist' | 'todo' | 'auth' | 'other';

/** Client-wide failures replace per-row dots. A missing to-do list stays on the row. */
export function classifyBasecampHttpFailure(
    status: number,
    operation: BasecampHttpOperation,
): PlanBasecampFailureScope {
    if (operation === 'auth' || operation === 'project') return 'client';
    if (status === 401 || status === 403 || status === 429) return 'client';
    return 'task';
}

export function formatBasecampHttpFailure(
    status: number,
    detail: string,
    hint?: { operation: BasecampHttpOperation; listName?: string | null; projectName?: string | null },
): string {
    const listName = hint?.listName?.trim();
    const projectName = hint?.projectName?.trim();
    if (status === 404 && hint?.operation === 'todolist') {
        const list = listName ? ` "${listName}"` : '';
        const project = projectName ? ` in project "${projectName}"` : '';
        return `Basecamp returned 404: the to-do list${list} no longer exists${project}.`;
    }
    if (status === 404 && hint?.operation === 'project') {
        const project = projectName ? ` "${projectName}"` : '';
        return `Basecamp returned 404: project${project} is missing or archived.`;
    }
    if (status === 401 || hint?.operation === 'auth') {
        return 'Basecamp returned 401: the connection is no longer authorized.';
    }
    if (status === 429) return 'Basecamp returned 429: rate limited.';
    const extra = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
    return extra ? `Basecamp returned ${status}: ${extra}` : `Basecamp returned ${status}.`;
}

export interface NightlyRetryRow {
    id: string;
    state: string | null;
    stage: string | null;
    dueDate: string | null;
    /** The client still has a Basecamp project and sync turned on. */
    hasProject: boolean;
}

/** Failed plan tasks that would still push. Undated backlog and unbound clients wait. */
export function nightlyBasecampRetryIds(rows: readonly NightlyRetryRow[]): string[] {
    const ids: string[] = [];
    for (const row of rows) {
        if (row.state !== 'failed' || !row.hasProject) continue;
        if (!planTaskQualifiesForBasecampPush({ stage: row.stage, dueDate: row.dueDate })) continue;
        ids.push(row.id);
    }
    return ids;
}

/** "Last try 2:14 PM". The auto-retry count is gone: there is one attempt. */
export function formatPlanSyncAttempt(iso: string | null, timeZone = 'UTC'): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const time = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone,
    }).format(date);
    return `Last try ${time}`;
}

export interface PlanBasecampReadout {
    taskId: string;
    qualifies: boolean;
    state: PlanBasecampSyncValue | null;
    error: string | null;
    attemptedAt: string | null;
    basecampTodoId: string | null;
    clientFailure: string | null;
    connected: boolean;
}

/** Read-only shape the plan side panel can show. It does not push. */
export function planBasecampReadout(input: {
    taskId: string;
    stage: string | null;
    dueDate: string | null;
    sync: PlanBasecampSyncState | null;
    basecampTodoId: string | null;
    banner: PlanBasecampBanner;
}): PlanBasecampReadout {
    return {
        taskId: input.taskId,
        qualifies: planTaskQualifiesForBasecampPush({ stage: input.stage, dueDate: input.dueDate }),
        state: input.sync?.state ?? null,
        error: input.sync?.error ?? null,
        attemptedAt: input.sync?.attemptedAt ?? null,
        basecampTodoId: input.basecampTodoId,
        clientFailure: input.banner.failure,
        connected: input.banner.connected,
    };
}
