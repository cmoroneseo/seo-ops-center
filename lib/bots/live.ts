import { createAdminClient } from '../supabase/admin.ts';
import { createLiveBasecampPushPost } from '../basecamp/push-live.ts';
import { createLiveBasecampTimesheetPost } from '../basecamp/timesheet-live.ts';
import { BOT_ACTOR_EMAIL, hashBotKey } from './keys.ts';
import { botCreatedTaskRow } from './task-create.ts';
import {
    basecampStepFromResponse,
    type BasecampStep,
    type BotActor,
    type BotClientRecord,
    type BotKeyRecord,
    type BotOperationRecord,
    type BotTaskRecord,
    type BotTimeDeps,
    type BotTimeLogRecord,
} from './time-entry.ts';

type Role = 'owner' | 'admin' | 'member' | 'viewer';

function admin() {
    return createAdminClient();
}

function taskRecord(row: Record<string, unknown>): BotTaskRecord {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        title: String(row.title),
        status: typeof row.status === 'string' ? row.status : 'todo',
        completedAt: typeof row.completed_at === 'string' ? row.completed_at : null,
        statusHistory: Array.isArray(row.status_history) ? row.status_history : [],
        basecampTodoId: row.basecamp_todo_id == null ? null : String(row.basecamp_todo_id),
        basecampProjectId: row.basecamp_project_id == null ? null : String(row.basecamp_project_id),
        category: typeof row.category === 'string' ? row.category : null,
        dueDate: typeof row.due_date === 'string' ? row.due_date.slice(0, 10) : null,
        botOperationId: typeof row.bot_operation_id === 'string' ? row.bot_operation_id : null,
    };
}

function logRecord(row: Record<string, unknown>): BotTimeLogRecord {
    const hours = Number(row.hours);
    return {
        id: String(row.id),
        taskId: String(row.task_id),
        userId: String(row.user_id),
        date: String(row.date).slice(0, 10),
        hours,
        minutes: Math.round(hours * 60),
        description: typeof row.description === 'string' ? row.description : null,
        countsTowardBudget: row.counts_toward_budget !== false,
        billable: row.billable !== false,
        basecampEntryId: row.basecamp_entry_id == null ? null : String(row.basecamp_entry_id),
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

export function liveBotTimeDeps(): BotTimeDeps {
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
            const key: BotKeyRecord = {
                id: data.id,
                organizationId: data.organization_id,
                name: data.name,
                revokedAt: null,
            };
            return key;
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
            const { data, error } = await admin()
                .from('tasks')
                .select('id, organization_id, client_id, title, status, completed_at, status_history, basecamp_todo_id, basecamp_project_id, category, due_date, bot_operation_id')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .eq('title', command.taskTitle)
                .is('parent_task_id', null)
                .limit(2);
            if (error) throw error;
            if ((data ?? []).length > 1) return 'ambiguous';
            const row = data?.[0];
            return row ? taskRecord(row) : null;
        },
        async getTask(taskId) {
            const { data, error } = await admin()
                .from('tasks')
                .select('id, organization_id, client_id, title, status, completed_at, status_history, basecamp_todo_id, basecamp_project_id, category, due_date, bot_operation_id')
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
                    actorUserId: input.actor.userId,
                    botKeyId: input.botKeyId,
                    botOperationId: input.botOperationId,
                    now: input.now,
                }))
                .select('id, organization_id, client_id, title, status, completed_at, status_history, basecamp_todo_id, basecamp_project_id, category, due_date, bot_operation_id')
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
                .select('id, organization_id, client_id, title, status, completed_at, status_history, basecamp_todo_id, basecamp_project_id, category, due_date, bot_operation_id')
                .single();
            if (error || !data) throw error ?? new Error('task update failed');
            return taskRecord(data);
        },
        async findTimeLogByOperation(operationId) {
            const { data, error } = await admin()
                .from('time_logs')
                .select('id, task_id, user_id, date, hours, description, counts_toward_budget, billable, basecamp_entry_id')
                .eq('bot_operation_id', operationId)
                .maybeSingle();
            if (error) throw error;
            return data ? logRecord(data) : null;
        },
        async insertTimeLog(input) {
            const { data, error } = await admin()
                .from('time_logs')
                .insert({
                    organization_id: input.organizationId,
                    client_id: input.clientId,
                    task_id: input.taskId,
                    user_id: input.actor.userId,
                    date: input.command.date,
                    hours: input.command.hours,
                    description: input.command.description ?? null,
                    billable: input.command.billable,
                    counts_toward_budget: input.command.countsTowardBudget,
                    status: 'logged',
                    source: 'seo_pm',
                    reference_links: input.command.referenceLink ? [input.command.referenceLink] : [],
                    bot_key_id: input.botKeyId,
                    bot_operation_id: input.botOperationId,
                })
                .select('id, task_id, user_id, date, hours, description, counts_toward_budget, billable, basecamp_entry_id')
                .single();
            if (error?.code === '23505') return 'conflict';
            if (error || !data) throw error ?? new Error('time log insert failed');
            return logRecord(data);
        },
        async getTimeLog(timeLogId) {
            const { data, error } = await admin()
                .from('time_logs')
                .select('id, task_id, user_id, date, hours, description, counts_toward_budget, billable, basecamp_entry_id')
                .eq('id', timeLogId)
                .maybeSingle();
            if (error) throw error;
            return data ? logRecord(data) : null;
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
