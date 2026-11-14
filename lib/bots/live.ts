import { createAdminClient } from '../supabase/admin.ts';
import { createLiveBasecampPushPost } from '../basecamp/push-live.ts';
import { createLiveBasecampTimesheetPost } from '../basecamp/timesheet-live.ts';
import { BOT_ACTOR_EMAIL, hashBotKey } from './keys.ts';
import { botCreatedTaskRow } from './task-create.ts';
import { matchBotTask } from './task-lookup.ts';
import { botStretchSegmentId } from './timer.ts';
import {
    basecampStepFromResponse,
    BotTimerLookupError,
    type BasecampStep,
    type BotActor,
    type BotClientRecord,
    type BotDeps,
    type BotKeyRecord,
    type BotOperationRecord,
    type BotTaskRecord,
    type BotTimerStretch,
    type FinalizedBotLog,
    type RunningBotTimer,
} from './handle.ts';

type Role = 'owner' | 'admin' | 'member' | 'viewer';

const TASK_COLUMNS = 'id, organization_id, client_id, project_id, title, status, completed_at, status_history, basecamp_todo_id, basecamp_project_id, parent_task_id, category, due_date, bot_operation_id';

function admin() {
    return createAdminClient();
}

function taskRecord(row: Record<string, unknown>): BotTaskRecord {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        projectId: typeof row.project_id === 'string' ? row.project_id : null,
        title: String(row.title),
        status: typeof row.status === 'string' ? row.status : 'todo',
        completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
        statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
        basecampTodoId: row.basecamp_todo_id == null ? null : String(row.basecamp_todo_id),
        basecampProjectId: row.basecamp_project_id == null ? null : String(row.basecamp_project_id),
        parentTaskId: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
        category: typeof row.category === 'string' ? row.category : null,
        dueDate: typeof row.due_date === 'string' ? row.due_date.slice(0, 10) : null,
        botOperationId: typeof row.bot_operation_id === 'string' ? row.bot_operation_id : null,
    };
}

function logRecord(row: Record<string, unknown>): FinalizedBotLog {
    const hours = Number(row.hours);
    return {
        id: String(row.id),
        taskId: String(row.task_id),
        date: String(row.date).slice(0, 10),
        hours,
        minutes: Math.round(hours * 60),
        description: typeof row.description === 'string' ? row.description : null,
        countsTowardBudget: row.counts_toward_budget !== false,
        billable: row.billable !== false,
        status: row.status === 'needs_review' ? 'needs_review' : 'logged',
        basecampEntryId: row.basecamp_entry_id == null ? null : String(row.basecamp_entry_id),
    };
}

function stretchRows(value: unknown): BotTimerStretch[] {
    const rows = Array.isArray(value) ? value : [];
    return rows.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const startedAt = typeof row.started_at === 'string' ? row.started_at : null;
        const endedAt = typeof row.ended_at === 'string' ? row.ended_at : null;
        if (!startedAt || !endedAt) return [];
        return [{
            startedAt,
            endedAt,
            note: typeof row.note === 'string' && row.note.trim() ? row.note : null,
        }];
    }).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

function timerBase(row: Record<string, unknown>, stretches: BotTimerStretch[]): Omit<RunningBotTimer, 'startedAt' | 'openNote' | 'pausedAt'> | null {
    const taskId = typeof row.task_id === 'string' ? row.task_id : null;
    const botKeyId = typeof row.bot_key_id === 'string' ? row.bot_key_id : null;
    if (!taskId || !botKeyId) return null;
    const task = row.tasks && typeof row.tasks === 'object' ? row.tasks as Record<string, unknown> : null;
    const title = typeof task?.title === 'string'
        ? task.title
        : (typeof row.description === 'string' && row.description.trim() ? row.description : 'Task');
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        taskId,
        taskTitle: title,
        userId: String(row.user_id),
        botKeyId,
        description: typeof row.description === 'string' ? row.description : null,
        countsTowardBudget: row.counts_toward_budget !== false,
        billable: row.billable !== false,
        projectId: typeof row.project_id === 'string' ? row.project_id : null,
        stretches,
    };
}

function runningRecord(row: Record<string, unknown>): RunningBotTimer | null {
    const startedAt = typeof row.timer_started_at === 'string' ? row.timer_started_at : null;
    if (!startedAt) return null;
    const base = timerBase(row, stretchRows(row.time_log_segments));
    if (!base) return null;
    return {
        ...base,
        startedAt,
        openNote: typeof row.description === 'string' && row.description.trim() ? row.description : null,
        pausedAt: null,
    };
}

function pausedRecord(row: Record<string, unknown>): RunningBotTimer | null {
    const stretches = stretchRows(row.time_log_segments);
    const base = timerBase(row, stretches);
    if (!base) return null;
    const pausedAt = stretches[stretches.length - 1]?.endedAt ?? null;
    if (!pausedAt) return null;
    return {
        ...base,
        startedAt: null,
        openNote: null,
        pausedAt,
    };
}

function operationRecord(row: Record<string, unknown>): BotOperationRecord {
    return {
        id: String(row.id),
        botKeyId: String(row.bot_key_id),
        idempotencyKey: String(row.idempotency_key),
        requestHash: String(row.request_hash),
        status: row.status === 'completed' ? 'completed' : 'pending',
        lockedAt: String(row.locked_at),
        taskId: typeof row.task_id === 'string' ? row.task_id : null,
        timeLogId: typeof row.time_log_id === 'string' ? row.time_log_id : null,
        httpStatus: typeof row.http_status === 'number' ? row.http_status : null,
        response: row.response ?? null,
    };
}

// time_log_segments has two foreign keys to time_logs, so PostgREST rejects an
// unqualified embed. Name the time_log_id relationship. The columns stay the
// same: started_at, ended_at, note.
const TIMER_COLUMNS = 'id, organization_id, client_id, project_id, task_id, user_id, bot_key_id, status, timer_started_at, description, counts_toward_budget, billable, tasks(title), time_log_segments!time_log_segments_time_log_id_fkey(started_at, ended_at, note)';

function raiseTimerLookupError(error: { code?: string | null }): never {
    throw new BotTimerLookupError(typeof error.code === 'string' ? error.code : undefined);
}

async function authorizeTask(actor: BotActor, taskId: unknown) {
    if (typeof taskId !== 'string' || taskId.trim().length === 0) {
        return { ok: false as const, status: 400, error: 'Missing taskId' };
    }
    const { data: task, error } = await admin()
        .from('tasks')
        .select('id, organization_id, client_id')
        .eq('id', taskId)
        .maybeSingle();
    if (error) return { ok: false as const, status: 500, error: 'Unable to verify task access' };
    if (!task?.client_id || task.organization_id !== actor.organizationId) {
        return { ok: false as const, status: 403, error: 'Forbidden' };
    }
    const { data: member, error: memberError } = await admin()
        .from('organization_members')
        .select('role')
        .eq('organization_id', task.organization_id)
        .eq('user_id', actor.userId)
        .maybeSingle();
    if (memberError) return { ok: false as const, status: 500, error: 'Unable to verify organization access' };
    if (!member) return { ok: false as const, status: 403, error: 'Forbidden' };
    const role = member.role as Role;
    return {
        ok: true as const,
        userId: actor.userId,
        actorName: actor.name,
        organizationId: task.organization_id,
        clientId: task.client_id,
        taskId: task.id,
        role,
        canManageIntegrations: role === 'owner' || role === 'admin',
    };
}

async function authorizeTimeLog(actor: BotActor, timeLogId: unknown) {
    if (typeof timeLogId !== 'string' || timeLogId.trim().length === 0) {
        return { ok: false as const, status: 400, error: 'Missing timeLogId' };
    }
    const { data: log, error } = await admin()
        .from('time_logs')
        .select('id, organization_id, client_id, user_id')
        .eq('id', timeLogId)
        .maybeSingle();
    if (error) return { ok: false as const, status: 500, error: 'Unable to verify time log access' };
    if (!log?.client_id || log.organization_id !== actor.organizationId || log.user_id !== actor.userId) {
        return { ok: false as const, status: 403, error: 'Forbidden' };
    }
    const { data: member, error: memberError } = await admin()
        .from('organization_members')
        .select('role')
        .eq('organization_id', log.organization_id)
        .eq('user_id', actor.userId)
        .maybeSingle();
    if (memberError) return { ok: false as const, status: 500, error: 'Unable to verify organization access' };
    if (!member) return { ok: false as const, status: 403, error: 'Forbidden' };
    const role = member.role as Role;
    const { data: organization } = await admin()
        .from('organizations')
        .select('is_internal')
        .eq('id', log.organization_id)
        .maybeSingle();
    return {
        ok: true as const,
        userId: actor.userId,
        actorName: actor.name,
        organizationId: log.organization_id,
        clientId: log.client_id,
        timeLogId: log.id,
        organizationIsInternal: organization?.is_internal === true,
        role,
        canManageIntegrations: role === 'owner' || role === 'admin',
    };
}

async function push(actor: BotActor, taskId: string, action: 'create_todo' | 'complete_todo'): Promise<BasecampStep> {
    const post = createLiveBasecampPushPost(candidate => authorizeTask(actor, candidate));
    const response = await post(new Request('https://seo-ops.internal/api/integrations/basecamp/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, taskId }),
    }));
    return basecampStepFromResponse(response);
}

export function liveBotDeps(): BotDeps & {
    getBotKey(id: string): Promise<BotKeyRecord | null>;
} {
    return {
        now: () => new Date(),
        async authenticate(token) {
            const { data, error } = await admin()
                .from('bot_api_keys')
                .select('id, organization_id, name, revoked_at, key_hash')
                .eq('key_hash', hashBotKey(token))
                .maybeSingle();
            if (error || !data || data.revoked_at) return null;
            await admin().from('bot_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
            return {
                id: data.id,
                organizationId: data.organization_id,
                name: data.name,
                revokedAt: null,
            } satisfies BotKeyRecord;
        },
        async actor(organizationId) {
            const { data: user, error } = await admin()
                .from('users')
                .select('id, email, full_name')
                .eq('email', BOT_ACTOR_EMAIL)
                .maybeSingle();
            if (error || !user) return null;
            const { data: member, error: memberError } = await admin()
                .from('organization_members')
                .select('user_id')
                .eq('organization_id', organizationId)
                .eq('user_id', user.id)
                .maybeSingle();
            if (memberError || !member) return null;
            return {
                userId: user.id,
                name: user.full_name || 'Carlos Morones',
                email: user.email,
                organizationId,
            };
        },
        async getBotKey(id) {
            const { data, error } = await admin()
                .from('bot_api_keys')
                .select('id, organization_id, name, revoked_at')
                .eq('id', id)
                .maybeSingle();
            if (error || !data) return null;
            return {
                id: String(data.id),
                organizationId: String(data.organization_id),
                name: String(data.name),
                revokedAt: typeof data.revoked_at === 'string' ? data.revoked_at : null,
            };
        },
        async findOperation(botKeyId, idempotencyKey) {
            const { data, error } = await admin()
                .from('bot_operations')
                .select('*')
                .eq('bot_key_id', botKeyId)
                .eq('idempotency_key', idempotencyKey)
                .maybeSingle();
            if (error || !data) return null;
            return operationRecord(data);
        },
        async insertOperation(input) {
            const { data, error } = await admin()
                .from('bot_operations')
                .insert({
                    organization_id: input.organizationId,
                    bot_key_id: input.botKeyId,
                    idempotency_key: input.idempotencyKey,
                    request_hash: input.requestHash,
                    status: 'pending',
                    locked_at: input.lockedAt,
                })
                .select('*')
                .single();
            if (error?.code === '23505') return 'conflict';
            if (error || !data) throw error ?? new Error('operation insert failed');
            return operationRecord(data);
        },
        async saveOperation(id, patch) {
            const row: Record<string, unknown> = {};
            if (patch.status) row.status = patch.status;
            if (patch.lockedAt) row.locked_at = patch.lockedAt;
            if (patch.taskId) row.task_id = patch.taskId;
            if (patch.timeLogId) row.time_log_id = patch.timeLogId;
            if (patch.httpStatus !== undefined) row.http_status = patch.httpStatus;
            if (patch.response !== undefined) row.response = patch.response;
            if (patch.status === 'completed') row.completed_at = new Date().toISOString();
            const { error } = await admin().from('bot_operations').update(row).eq('id', id);
            if (error) throw error;
        },
        async findClient(organizationId, command) {
            let query = admin()
                .from('clients')
                .select('id, organization_id, name')
                .eq('organization_id', organizationId)
                .limit(2);
            if (command.clientId) query = query.eq('id', command.clientId);
            else if (command.clientName) query = query.eq('name', command.clientName);
            else return null;
            const { data, error } = await query;
            if (error) throw error;
            const rows = (data ?? []).filter(row => (
                !command.clientName || row.name === command.clientName
            ));
            if (rows.length > 1) return 'ambiguous';
            const row = rows[0];
            if (!row) return null;
            const client: BotClientRecord = {
                id: row.id,
                organizationId: row.organization_id,
                name: row.name,
            };
            return client;
        },
        async clientCategories(organizationId, clientId) {
            const { data, error } = await admin()
                .from('tasks')
                .select('category')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .not('category', 'is', null);
            if (error) throw error;
            const labels = new Set<string>();
            for (const row of data ?? []) {
                if (typeof row.category === 'string' && row.category.length > 0) labels.add(row.category);
            }
            return [...labels];
        },
        async findTask(organizationId, clientId, command) {
            if (!command.taskTitle) return null;
            const scoped = () => admin()
                .from('tasks')
                .select('id, title, parent_task_id')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId);
            const refs: Array<{ id: string; title: string; parentTaskId: string | null }> = [];
            const add = (rows: Array<{ id: string; title: string; parent_task_id: string | null }> | null) => {
                for (const row of rows ?? []) {
                    refs.push({
                        id: row.id,
                        title: row.title,
                        parentTaskId: row.parent_task_id,
                    });
                }
            };
            if (!command.parentTaskId && !command.parentTitle) {
                const { data, error } = await scoped()
                    .eq('title', command.taskTitle)
                    .is('parent_task_id', null)
                    .limit(2);
                if (error) throw error;
                add(data);
            } else if (command.parentTaskId) {
                const { data: parents, error } = await scoped()
                    .eq('id', command.parentTaskId)
                    .is('parent_task_id', null)
                    .limit(1);
                if (error) throw error;
                add(parents);
                const parent = parents?.[0];
                if (parent) {
                    const { data: children, error: childError } = await scoped()
                        .eq('parent_task_id', parent.id)
                        .eq('title', command.taskTitle)
                        .limit(2);
                    if (childError) throw childError;
                    add(children);
                }
            } else {
                const { data: parents, error } = await scoped()
                    .eq('title', command.parentTitle)
                    .is('parent_task_id', null)
                    .limit(2);
                if (error) throw error;
                add(parents);
                const parent = parents?.[0];
                if ((parents ?? []).length === 1 && parent) {
                    const { data: children, error: childError } = await scoped()
                        .eq('parent_task_id', parent.id)
                        .eq('title', command.taskTitle)
                        .limit(2);
                    if (childError) throw childError;
                    add(children);
                }
            }
            const match = matchBotTask(refs, command);
            if (!match.ok) {
                const parent = refs.find(row => (
                    row.parentTaskId == null
                    && (command.parentTaskId ? row.id === command.parentTaskId : row.title === command.parentTitle)
                ));
                return {
                    ...match,
                    ...(parent && match.reason === 'missing' ? { parentId: parent.id } : {}),
                };
            }
            const { data, error } = await admin()
                .from('tasks')
                .select(TASK_COLUMNS)
                .eq('id', match.taskId)
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .maybeSingle();
            if (error) throw error;
            return data ? taskRecord(data) : null;
        },
        async getTask(taskId) {
            const { data, error } = await admin()
                .from('tasks')
                .select(TASK_COLUMNS)
                .eq('id', taskId)
                .maybeSingle();
            if (error) throw error;
            return data ? taskRecord(data) : null;
        },
        async insertTask(input) {
            const { data, error } = await admin()
                .from('tasks')
                .insert(botCreatedTaskRow({
                    organizationId: input.organizationId,
                    clientId: input.clientId,
                    title: input.title,
                    ...(input.category ? { category: input.category } : {}),
                    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
                    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
                    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
                    actorUserId: input.actor.userId,
                    botKeyId: input.botKeyId,
                    botOperationId: input.botOperationId,
                    now: input.now,
                }))
                .select(TASK_COLUMNS)
                .single();
            if (error?.code === '23505') return 'conflict';
            if (error || !data) throw error ?? new Error('task insert failed');
            return taskRecord(data);
        },
        async saveTask(taskId, patch) {
            const { data, error } = await admin()
                .from('tasks')
                .update({
                    status: patch.status,
                    completed_at: patch.completedAt,
                    status_history: patch.statusHistory,
                    ...(patch.status === 'done' ? { blocked_reason: null } : {}),
                })
                .eq('id', taskId)
                .select(TASK_COLUMNS)
                .single();
            if (error || !data) throw error ?? new Error('task update failed');
            return taskRecord(data);
        },
        async findRunningTimer(botKeyId) {
            const { data, error } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('bot_key_id', botKeyId)
                .eq('status', 'in_progress')
                .not('timer_started_at', 'is', null)
                .order('timer_started_at', { ascending: true })
                .limit(1)
                .maybeSingle();
            if (error) raiseTimerLookupError(error);
            if (!data) return null;
            return runningRecord(data);
        },
        async listPausedTimers(botKeyId) {
            const { data, error } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('bot_key_id', botKeyId)
                .eq('status', 'paused')
                .order('created_at', { ascending: true });
            if (error) raiseTimerLookupError(error);
            return (data ?? []).map(pausedRecord).filter((row): row is RunningBotTimer => row !== null);
        },
        async listAllPausedTimers() {
            const { data, error } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('status', 'paused')
                .not('bot_key_id', 'is', null);
            if (error) raiseTimerLookupError(error);
            return (data ?? []).map(pausedRecord).filter((row): row is RunningBotTimer => row !== null);
        },
        async listOverdueTimers() {
            // Every running bot timer. The caller applies BOT_TIMER_MAX_SECONDS.
            // Cumulative running time decides a configured cap. Paused rows are not here.
            const { data, error } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('status', 'in_progress')
                .not('bot_key_id', 'is', null)
                .not('timer_started_at', 'is', null);
            if (error) raiseTimerLookupError(error);
            return (data ?? []).map(runningRecord).filter((row): row is RunningBotTimer => row !== null);
        },
        async getTimer(id) {
            const { data, error } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('id', id)
                .maybeSingle();
            if (error) raiseTimerLookupError(error);
            if (!data) return null;
            if (data.status === 'paused') return pausedRecord(data);
            if (data.status === 'in_progress') return runningRecord(data);
            return null;
        },
        async insertRunningTimer(input) {
            const { data, error } = await admin()
                .from('time_logs')
                .insert({
                    organization_id: input.organizationId,
                    client_id: input.clientId,
                    project_id: input.projectId,
                    task_id: input.taskId,
                    user_id: input.actor.userId,
                    date: input.date,
                    hours: 0,
                    description: input.openNote,
                    billable: input.billable,
                    counts_toward_budget: input.countsTowardBudget,
                    status: 'in_progress',
                    timer_started_at: input.startedAt,
                    elapsed_seconds: 0,
                    category: input.category,
                    source: 'seo_pm',
                    bot_key_id: input.botKeyId,
                    bot_operation_id: input.botOperationId,
                })
                .select(TIMER_COLUMNS)
                .single();
            if (error?.code === '23505') return 'conflict';
            if (error || !data) throw error ?? new Error('timer insert failed');
            const timer = runningRecord({ ...data, tasks: { title: input.taskTitle }, description: input.openNote });
            if (!timer) throw new Error('timer insert failed');
            return timer;
        },
        async pauseTimer(input) {
            const { error: segmentError } = await admin().from('time_log_segments').insert({
                id: botStretchSegmentId(input.timer.id, input.stretch.startedAt),
                time_log_id: input.timer.id,
                organization_id: input.timer.organizationId,
                user_id: input.timer.userId,
                started_at: input.stretch.startedAt,
                ended_at: input.stretch.endedAt,
                note: input.stretch.note,
            });
            // A replay inserts the same segment id. The closed row is not an open segment.
            if (segmentError && segmentError.code !== '23505') throw segmentError;
            const { data, error } = await admin()
                .from('time_logs')
                .update({
                    status: 'paused',
                    timer_started_at: null,
                    elapsed_seconds: input.elapsedSeconds,
                    hours: input.hours,
                    description: input.description,
                })
                .eq('id', input.timer.id)
                .eq('status', 'in_progress')
                .select(TIMER_COLUMNS)
                .maybeSingle();
            if (error) raiseTimerLookupError(error);
            if (data) {
                const paused = pausedRecord({
                    ...data,
                    tasks: { title: input.timer.taskTitle },
                    time_log_segments: [...(data.time_log_segments ?? []), {
                        started_at: input.stretch.startedAt,
                        ended_at: input.stretch.endedAt,
                        note: input.stretch.note,
                    }],
                });
                if (paused) return paused;
            }
            const { data: existing, error: readError } = await admin()
                .from('time_logs')
                .select(TIMER_COLUMNS)
                .eq('id', input.timer.id)
                .maybeSingle();
            if (readError) raiseTimerLookupError(readError);
            if (!existing) return null;
            return pausedRecord({ ...existing, tasks: { title: input.timer.taskTitle } });
        },
        async resumeTimer(input) {
            const { data, error } = await admin()
                .from('time_logs')
                .update({
                    status: 'in_progress',
                    timer_started_at: input.startedAt,
                    description: input.openNote,
                })
                .eq('id', input.timer.id)
                .eq('status', 'paused')
                .select(TIMER_COLUMNS)
                .maybeSingle();
            if (error?.code === '23505') return 'conflict';
            if (error) raiseTimerLookupError(error);
            if (!data) return null;
            const timer = runningRecord({
                ...data,
                description: input.openNote,
                tasks: { title: input.timer.taskTitle },
                time_log_segments: input.timer.stretches.map(stretch => ({
                    started_at: stretch.startedAt,
                    ended_at: stretch.endedAt,
                    note: stretch.note,
                })),
            });
            return timer;
        },
        async finalizeTimer(input) {
            const first = input.slices[0];
            if (!first) return null;
            for (const stretch of input.stretches) {
                const { error: segmentError } = await admin().from('time_log_segments').insert({
                    id: botStretchSegmentId(input.timer.id, stretch.startedAt),
                    time_log_id: input.timer.id,
                    organization_id: input.timer.organizationId,
                    user_id: input.timer.userId,
                    started_at: stretch.startedAt,
                    ended_at: stretch.endedAt,
                    note: stretch.note,
                });
                if (segmentError && segmentError.code !== '23505') throw segmentError;
            }
            const status = input.capped ? 'needs_review' : 'logged';
            const patch: Record<string, unknown> = {
                date: first.date,
                hours: first.hours,
                description: input.description,
                billable: input.billable,
                counts_toward_budget: input.countsTowardBudget,
                status,
                timer_started_at: null,
                elapsed_seconds: first.seconds,
                operation_id: input.operationId,
            };
            if (input.botOperationId) patch.bot_operation_id = input.botOperationId;
            if (input.note) {
                patch.session_notes = [{
                    id: input.operationId,
                    text: input.note,
                    createdAt: input.stoppedAt,
                }];
            }
            const { data, error } = await admin()
                .from('time_logs')
                .update(patch)
                .eq('id', input.timer.id)
                .in('status', ['in_progress', 'paused'])
                .select('id, task_id, date, hours, description, counts_toward_budget, billable, status, basecamp_entry_id')
                .maybeSingle();
            if (error) throw error;
            if (!data) {
                const { data: existing, error: readError } = await admin()
                    .from('time_logs')
                    .select('id, task_id, date, hours, description, counts_toward_budget, billable, status, basecamp_entry_id')
                    .eq('id', input.timer.id)
                    .maybeSingle();
                if (readError || !existing || existing.status === 'in_progress' || existing.status === 'paused') return null;
                return { logs: [logRecord(existing)], transitioned: false };
            }
            const logs = [logRecord(data)];
            for (const slice of input.slices.slice(1)) {
                const { data: extra, error: extraError } = await admin()
                    .from('time_logs')
                    .insert({
                        organization_id: input.timer.organizationId,
                        client_id: input.timer.clientId,
                        project_id: input.timer.projectId,
                        task_id: input.timer.taskId,
                        user_id: input.timer.userId,
                        date: slice.date,
                        hours: slice.hours,
                        description: input.description,
                        billable: input.billable,
                        counts_toward_budget: input.countsTowardBudget,
                        status,
                        elapsed_seconds: slice.seconds,
                        operation_id: input.operationId,
                        category: null,
                        source: 'seo_pm',
                        bot_key_id: input.timer.botKeyId,
                    })
                    .select('id, task_id, date, hours, description, counts_toward_budget, billable, status, basecamp_entry_id')
                    .single();
                if (extraError || !extra) throw extraError ?? new Error('split day insert failed');
                logs.push(logRecord(extra));
            }
            return { logs, transitioned: true };
        },
        pushTodo: (taskId, actor) => push(actor, taskId, 'create_todo'),
        completeTodo: (taskId, actor) => push(actor, taskId, 'complete_todo'),
        async syncTimesheet(timeLogId, actor) {
            const post = createLiveBasecampTimesheetPost(candidate => authorizeTimeLog(actor, candidate));
            const response = await post(new Request('https://seo-ops.internal/api/integrations/basecamp/timesheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync', timeLogId, createIfMissing: true }),
            }));
            return basecampStepFromResponse(response);
        },
    };
}
