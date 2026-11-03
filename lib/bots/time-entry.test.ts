import assert from 'node:assert/strict';
import test from 'node:test';

import { createBasecampPushPost } from '../basecamp/push-route.ts';
import { resolveBasecampTimesheetRecording, createBasecampTimesheetPost } from '../basecamp/timesheet-post-route.ts';
import { createTimesheetPerformer } from '../basecamp/timesheet-perform.ts';
import { resolveCompletionInstant } from '../tasks/completion-date.ts';
import { hashBotKey } from './keys.ts';
import { handleBotTimeRequest, type BotActor, type BotTaskRecord, type BotTimeDeps, type BotTimeLogRecord } from './time-entry.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CARLOS = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'seo_bot_testtokenvalue';
const NOW = new Date('2026-11-03T18:00:00.000Z');
const ZONE = 'America/Los_Angeles';

interface MemClient {
    id: string;
    organizationId: string;
    name: string;
    syncEnabled: boolean;
    timesheetEnabled: boolean;
    projectId: string | null;
    todolistId: string | null;
}

interface Mem {
    clients: MemClient[];
    tasks: BotTaskRecord[];
    logs: Array<BotTimeLogRecord & {
        organizationId: string;
        clientId: string;
        botOperationId: string;
        description: string | null;
    }>;
    operations: Array<{
        id: string;
        organizationId: string;
        botKeyId: string;
        idempotencyKey: string;
        requestHash: string;
        status: 'pending' | 'completed';
        lockedAt: string;
        taskId: string | null;
        timeLogId: string | null;
        httpStatus: number | null;
        response: unknown;
    }>;
    categories: string[];
    inserts: Array<{ category?: string; actorUserId: string }>;
    revoked: boolean;
}

function client(patch: Partial<MemClient> = {}): MemClient {
    return {
        id: CLIENT,
        organizationId: ORG,
        name: 'Ecoworkz',
        syncEnabled: true,
        timesheetEnabled: true,
        projectId: '202',
        todolistId: '44',
        ...patch,
    };
}

function world(patch: Partial<MemClient> = {}): { mem: Mem; calls: Calls } {
    const mem: Mem = {
        clients: [client(patch)],
        tasks: [],
        logs: [],
        operations: [],
        categories: [],
        inserts: [],
        revoked: false,
    };
    return { mem, calls: emptyCalls() };
}

interface Calls {
    createTodo: Array<{ projectId: string; todolistId: string; content: string; dueOn?: string }>;
    completeTodo: string[];
    createEntry: Array<{ recordingId: number; date: string; hours: number; description?: string }>;
    todos: Set<string>;
}

function emptyCalls(): Calls {
    return { createTodo: [], completeTodo: [], createEntry: [], todos: new Set() };
}

const actor: BotActor = {
    userId: CARLOS,
    name: 'Carlos Morones',
    email: 'cmorones@marketingempiregroup.com',
    organizationId: ORG,
};

function deps(mem: Mem, calls: Calls): BotTimeDeps {
    const push = createBasecampPushPost({
        async authorizeTask(taskId) {
            const task = mem.tasks.find(item => item.id === taskId);
            if (!task || task.organizationId !== ORG) return { ok: false, status: 403, error: 'Forbidden' };
            return {
                ok: true,
                userId: CARLOS,
                actorName: actor.name,
                organizationId: ORG,
                clientId: task.clientId,
                taskId: task.id,
                role: 'owner',
                canManageIntegrations: true,
            };
        },
        createStore: () => ({
            async getTask(taskId) {
                const task = mem.tasks.find(item => item.id === taskId);
                const owner = mem.clients.find(item => item.id === task?.clientId);
                if (!task || !owner) return null;
                return {
                    id: task.id,
                    organizationId: task.organizationId,
                    clientId: task.clientId,
                    title: task.title,
                    description: null,
                    dueDate: task.dueDate,
                    status: task.status,
                    basecampTodoId: task.basecampTodoId,
                    basecampProjectId: task.basecampProjectId,
                    configuredProjectId: owner.projectId,
                    configuredTodolistId: owner.todolistId,
                    syncEnabled: owner.syncEnabled,
                    assigneePersonIds: [],
                    completionSubscriberPersonIds: [],
                };
            },
            async listSubtasks() {
                return [];
            },
            async updateTaskLink(taskId, organizationId, clientId, projectId, todoId) {
                const task = mem.tasks.find(item => item.id === taskId && item.organizationId === organizationId && item.clientId === clientId);
                if (!task) return 'missing';
                task.basecampTodoId = todoId;
                task.basecampProjectId = projectId;
                calls.todos.add(todoId);
                return null;
            },
            async markTaskSynced() {
                return null;
            },
        }),
        createAccessSource: () => ({
            async findMembership() {
                return { organizationIsInternal: false };
            },
            async listConfiguredProjectIds() {
                return ['202'];
            },
        }),
        provider: {
            isConfigured: () => true,
            async getTodo(_projectId, todoId) {
                return calls.todos.has(todoId) ? { id: todoId, supportsSubtasks: true } : null;
            },
            async listTodolists() {
                return [{ id: '44' }];
            },
            async createTodo(projectId, todolistId, params) {
                calls.createTodo.push({
                    projectId,
                    todolistId,
                    content: params.content,
                    ...(params.dueOn ? { dueOn: params.dueOn } : {}),
                });
                calls.todos.add('77');
                return { id: 77, appUrl: 'https://3.basecamp.test/77', supportsSubtasks: true };
            },
            async completeTodo(_projectId, todoId) {
                calls.completeTodo.push(todoId);
                return true;
            },
            async reopenTodo() {
                return false;
            },
            async createComment() {
                return 1;
            },
            async updateTodoDueDate() {
                return true;
            },
            async updateTodoAssignees() {
                return true;
            },
        },
        now: () => NOW.toISOString(),
    });

    const timesheet = createBasecampTimesheetPost({
        async authorizeTimeLog(timeLogId) {
            const log = mem.logs.find(item => item.id === timeLogId);
            if (!log || log.organizationId !== ORG || log.userId !== CARLOS) {
                return { ok: false, status: 403, error: 'Forbidden' };
            }
            return {
                ok: true,
                userId: CARLOS,
                actorName: actor.name,
                organizationId: ORG,
                clientId: log.clientId,
                timeLogId: log.id,
                organizationIsInternal: false,
                role: 'owner',
                canManageIntegrations: true,
            };
        },
        createStore: () => ({
            async getTimeLog(timeLogId) {
                const log = mem.logs.find(item => item.id === timeLogId);
                const owner = mem.clients.find(item => item.id === log?.clientId);
                const task = mem.tasks.find(item => item.id === log?.taskId);
                if (!log || !owner || !task) return null;
                return {
                    id: log.id,
                    organizationId: log.organizationId,
                    clientId: log.clientId,
                    userId: log.userId,
                    taskId: log.taskId,
                    date: log.date,
                    hours: log.hours,
                    description: log.description,
                    status: 'logged',
                    basecampEntryId: log.basecampEntryId,
                    basecampRecordingId: null,
                    selectedBasecampProjectId: null,
                    configuredProjectId: owner.projectId,
                    syncEnabled: owner.syncEnabled,
                    timesheetEnabled: owner.timesheetEnabled,
                    cachedRecordingId: null,
                    taskBasecampTodoId: task.basecampTodoId,
                    taskBasecampProjectId: task.basecampProjectId,
                    taskTitle: task.title,
                    personId: 9,
                    basecampSyncError: null,
                    source: 'seo_pm',
                    importFingerprint: null,
                    clientCustomFields: {},
                };
            },
        }),
        createAccessSource: () => ({
            async findMembership() {
                return { organizationIsInternal: false };
            },
            async listConfiguredProjectIds() {
                return ['202'];
            },
        }),
        async verifyEntry() {
            return null;
        },
        resolveRecording: (projectId, candidate, kind) => resolveBasecampTimesheetRecording(
            projectId,
            candidate,
            kind,
            {
                async getTodo(_projectId, todoId) {
                    return calls.todos.has(todoId) ? { id: todoId } : null;
                },
                async findProjectTimesheetRecordingId() {
                    return '555';
                },
            },
        ),
        performAuthorized: createTimesheetPerformer({
            isConfigured: () => true,
            async deleteEntry() {
                return false;
            },
            async updateEntry() {
                return 'ok';
            },
            async createEntry(recordingId, fields) {
                calls.createEntry.push({ recordingId, ...fields });
                return { id: 900, appUrl: 'https://3.basecamp.test/entry/900' };
            },
            async listEntries() {
                return [];
            },
            async readEntry() {
                return 'unavailable';
            },
            async createComment() {
                return 1;
            },
            async clearProviderLink() {
                return undefined;
            },
            async recordError() {
                return undefined;
            },
            async markSynced(log, patch) {
                const row = mem.logs.find(item => item.id === log.id);
                if (!row) return;
                if (patch.entryId !== undefined) row.basecampEntryId = String(patch.entryId);
            },
            async writeFingerprint() {
                return null;
            },
            async cacheRecording() {
                return undefined;
            },
            async claimedEntryIds() {
                return [];
            },
        }),
    });

    return {
        now: () => NOW,
        async authenticate(token) {
            if (mem.revoked || hashBotKey(token) !== hashBotKey(TOKEN)) return null;
            return { id: KEY, organizationId: ORG, name: 'ecoworkz', revokedAt: null };
        },
        async actor() {
            return actor;
        },
        async findOperation(_keyId, idempotencyKey) {
            return mem.operations.find(item => item.idempotencyKey === idempotencyKey) ?? null;
        },
        async insertOperation(input) {
            if (mem.operations.some(item => item.idempotencyKey === input.idempotencyKey)) return 'conflict';
            const row = {
                id: `op-${mem.operations.length + 1}`,
                organizationId: input.organizationId,
                botKeyId: input.botKeyId,
                idempotencyKey: input.idempotencyKey,
                requestHash: input.requestHash,
                status: 'pending' as const,
                lockedAt: input.lockedAt,
                taskId: null,
                timeLogId: null,
                httpStatus: null,
                response: null,
            };
            mem.operations.push(row);
            return row;
        },
        async saveOperation(id, patch) {
            const row = mem.operations.find(item => item.id === id);
            if (!row) return;
            Object.assign(row, patch);
        },
        async findClient(organizationId, command) {
            const rows = mem.clients.filter(item => (
                item.organizationId === organizationId
                && (command.clientId ? item.id === command.clientId : item.name === command.clientName)
                && (!command.clientName || item.name === command.clientName)
            ));
            if (rows.length > 1) return 'ambiguous';
            const row = rows[0];
            return row ? { id: row.id, organizationId: row.organizationId, name: row.name } : null;
        },
        async clientCategories() {
            return mem.categories;
        },
        async findTask(organizationId, clientId, command) {
            const rows = mem.tasks.filter(item => (
                item.organizationId === organizationId
                && item.clientId === clientId
                && item.title === command.taskTitle
            ));
            if (rows.length > 1) return 'ambiguous';
            return rows[0] ?? null;
        },
        async getTask(taskId) {
            return mem.tasks.find(item => item.id === taskId) ?? null;
        },
        async insertTask(input) {
            mem.inserts.push({ category: input.category, actorUserId: input.actor.userId });
            if (mem.tasks.some(item => item.botOperationId === input.botOperationId)) return 'conflict';
            const row: BotTaskRecord = {
                id: `task-${mem.tasks.length + 1}`,
                organizationId: input.organizationId,
                clientId: input.clientId,
                title: input.title,
                status: 'todo',
                completedAt: null,
                statusHistory: [{ status: 'todo', at: input.now, by: input.actor.userId }],
                basecampTodoId: null,
                basecampProjectId: null,
                category: input.category ?? null,
                dueDate: input.dueDate ?? null,
                botOperationId: input.botOperationId,
            };
            mem.tasks.push(row);
            return row;
        },
        async saveTask(taskId, patch) {
            const row = mem.tasks.find(item => item.id === taskId);
            if (!row) return null;
            row.status = patch.status;
            row.completedAt = patch.completedAt;
            row.statusHistory = patch.statusHistory;
            return row;
        },
        async findTimeLogByOperation(operationId) {
            return mem.logs.find(item => item.botOperationId === operationId) ?? null;
        },
        async insertTimeLog(input) {
            if (mem.logs.some(item => item.botOperationId === input.botOperationId)) return 'conflict';
            const row = {
                id: `log-${mem.logs.length + 1}`,
                organizationId: input.organizationId,
                clientId: input.clientId,
                taskId: input.taskId,
                userId: input.actor.userId,
                date: input.command.date,
                hours: input.command.hours,
                minutes: input.command.minutes,
                description: input.command.description ?? null,
                countsTowardBudget: input.command.countsTowardBudget,
                billable: input.command.billable,
                basecampEntryId: null,
                botOperationId: input.botOperationId,
            };
            mem.logs.push(row);
            return row;
        },
        async getTimeLog(timeLogId) {
            return mem.logs.find(item => item.id === timeLogId) ?? null;
        },
        async pushTodo(taskId) {
            const response = await push(new Request('https://seo-ops.test/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create_todo', taskId }),
            }));
            const body = await response.json() as { success?: boolean; todoId?: unknown; error?: string; skipped?: boolean; reason?: string };
            return step(response.status, body);
        },
        async completeTodo(taskId) {
            const response = await push(new Request('https://seo-ops.test/push', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'complete_todo', taskId }),
            }));
            const body = await response.json() as { success?: boolean; error?: string; skipped?: boolean; reason?: string };
            return step(response.status, body);
        },
        async syncTimesheet(timeLogId) {
            const response = await timesheet(new Request('https://seo-ops.test/timesheet', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sync', timeLogId, createIfMissing: true }),
            }));
            const body = await response.json() as { success?: boolean; entryId?: unknown; error?: string; skipped?: boolean; reason?: string };
            return step(response.status, body);
        },
    };
}

function step(status: number, body: { success?: boolean; todoId?: unknown; entryId?: unknown; error?: string; skipped?: boolean; reason?: string }) {
    if (body.skipped) return { status: 'skipped' as const, ...(body.reason ? { reason: body.reason } : {}) };
    const providerValue = body.todoId ?? body.entryId;
    const providerId = typeof providerValue === 'string' || typeof providerValue === 'number' ? String(providerValue) : undefined;
    if (status >= 200 && status < 300 && body.success !== false) {
        return { status: 'pushed' as const, ...(providerId ? { providerId } : {}) };
    }
    if (status === 409) return { status: 'skipped' as const, ...(body.error ? { reason: body.error } : {}) };
    return { status: 'failed' as const, ...(body.error ? { reason: body.error } : {}) };
}

function request(body: unknown, token: string | null = TOKEN) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (token) headers.set('authorization', `Bearer ${token}`);
    return new Request('https://seo-ops.test/api/bots/time', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    });
}

function entry(patch: Record<string, unknown> = {}) {
    return {
        idempotencyKey: 'ecoworkz-brief-2026-11-03',
        clientId: CLIENT,
        taskTitle: 'Write the Ecoworkz brief',
        createTask: true,
        category: 'content',
        dueDate: '2026-11-04',
        date: '2026-11-03',
        minutes: 45,
        description: 'Drafted the brief',
        referenceLink: 'https://docs.google.com/document/d/brief',
        countsTowardBudget: true,
        complete: true,
        completedOn: '2026-11-02',
        timeZone: ZONE,
        ...patch,
    };
}

test('a bot creates the task, logs the time, and completes it through the Basecamp handlers', async () => {
    const { mem, calls } = world();
    const response = await handleBotTimeRequest(request(entry()), deps(mem, calls));
    const body = await response.json() as {
        task: { id: string; created: boolean; status: string; completedAt: string; basecampTodoId: string; basecamp: { status: string; providerId?: string } };
        timeLog: { hours: number; minutes: number; countsTowardBudget: boolean; userId?: string; basecampEntryId: string; basecamp: { status: string; providerId?: string } };
        actor: { email: string; userId: string };
        completion: { status: string };
    };

    assert.equal(response.status, 200);
    assert.equal(body.actor.email, 'cmorones@marketingempiregroup.com');
    assert.equal(body.actor.userId, CARLOS);
    assert.equal(body.task.created, true);
    assert.equal(body.task.status, 'done');
    assert.equal(mem.tasks.length, 1);
    assert.equal(mem.tasks[0]?.botOperationId, mem.operations[0]?.id);
    assert.deepEqual(mem.inserts, [{ category: 'content', actorUserId: CARLOS }]);
    assert.equal(mem.logs.length, 1);
    assert.equal(mem.logs[0]?.userId, CARLOS);
    assert.equal(mem.logs[0]?.hours, 0.75);
    assert.equal(mem.logs[0]?.countsTowardBudget, true);
    assert.deepEqual(calls.createTodo, [{
        projectId: '202',
        todolistId: '44',
        content: 'Write the Ecoworkz brief',
        dueOn: '2026-11-04',
    }]);
    assert.deepEqual(calls.createEntry, [{
        recordingId: 77,
        date: '2026-11-03',
        hours: 0.75,
        description: 'Drafted the brief',
        personId: 9,
    }]);
    assert.deepEqual(calls.completeTodo, ['77']);
    assert.equal(body.task.basecamp.status, 'pushed');
    assert.equal(body.task.basecampTodoId, '77');
    assert.equal(body.timeLog.basecamp.status, 'pushed');
    assert.equal(body.timeLog.basecampEntryId, '900');
    assert.equal(body.completion.status, 'pushed');
    const expected = resolveCompletionInstant({
        choice: { kind: 'day', day: '2026-11-02' },
        now: NOW,
        timeZone: ZONE,
    });
    assert.equal(expected.ok, true);
    if (expected.ok) assert.equal(body.task.completedAt, expected.completedAt);
    const done = mem.tasks[0]?.statusHistory.at(-1);
    assert.equal(done?.status, 'done');
    assert.equal(done?.by, CARLOS);

    const replay = await handleBotTimeRequest(request(entry()), deps(mem, calls));
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(calls.createTodo.length, 1);
    assert.equal(calls.createEntry.length, 1);
    assert.equal(calls.completeTodo.length, 1);
    assert.equal(mem.tasks.length, 1);
    assert.equal(mem.logs.length, 1);
    const replayBody = await replay.json() as { task: { id: string } };
    assert.equal(replayBody.task.id, body.task.id);
});

test('the same idempotency key with a different body does not write a second entry', async () => {
    const { mem, calls } = world();
    const first = await handleBotTimeRequest(request(entry()), deps(mem, calls));
    assert.equal(first.status, 200);
    const second = await handleBotTimeRequest(request(entry({ minutes: 30 })), deps(mem, calls));
    const body = await second.json() as { code: string };
    assert.equal(second.status, 409);
    assert.equal(body.code, 'idempotency_conflict');
    assert.equal(mem.logs.length, 1);
    assert.equal(calls.createEntry.length, 1);
});

test('a client with Basecamp sync off still keeps the task and the time locally', async () => {
    const { mem, calls } = world({ syncEnabled: false, timesheetEnabled: false });
    const response = await handleBotTimeRequest(request(entry({ complete: false, completedOn: undefined })), deps(mem, calls));
    const body = await response.json() as {
        task: { basecamp: { status: string } };
        timeLog: { basecamp: { status: string } };
    };
    assert.equal(response.status, 200);
    assert.equal(mem.tasks.length, 1);
    assert.equal(mem.logs.length, 1);
    assert.equal(calls.createTodo.length, 0);
    assert.equal(calls.createEntry.length, 0);
    assert.equal(calls.completeTodo.length, 0);
    assert.equal(body.task.basecamp.status, 'skipped');
    assert.equal(body.timeLog.basecamp.status, 'skipped');
    assert.equal(mem.tasks[0]?.basecampTodoId, null);
});

test('time tracking off skips the timesheet and still records Counts toward SEO hours', async () => {
    const { mem, calls } = world({ timesheetEnabled: false });
    const response = await handleBotTimeRequest(request(entry({
        complete: false,
        completedOn: undefined,
        countsTowardBudget: false,
        idempotencyKey: 'ecoworkz-hours-off',
    })), deps(mem, calls));
    const body = await response.json() as { timeLog: { countsTowardBudget: boolean; basecamp: { status: string } } };
    assert.equal(response.status, 200);
    assert.equal(calls.createTodo.length, 1);
    assert.equal(calls.createEntry.length, 0);
    assert.equal(mem.logs[0]?.countsTowardBudget, false);
    assert.equal(body.timeLog.countsTowardBudget, false);
    assert.equal(body.timeLog.basecamp.status, 'skipped');
    assert.equal(mem.tasks[0]?.basecampTodoId, '77');
});

test('a missing key is 401 and a delete is 403 before any row is written', async () => {
    const { mem, calls } = world();
    const missing = await handleBotTimeRequest(request(entry(), null), deps(mem, calls));
    assert.equal(missing.status, 401);
    const invalid = await handleBotTimeRequest(request(entry(), 'seo_bot_wrong'), deps(mem, calls));
    assert.equal(invalid.status, 401);
    const forbidden = await handleBotTimeRequest(request({ ...entry(), delete: true }), deps(mem, calls));
    const body = await forbidden.json() as { code: string };
    assert.equal(forbidden.status, 403);
    assert.equal(body.code, 'forbidden');
    assert.equal(mem.tasks.length, 0);
    assert.equal(mem.logs.length, 0);
    assert.equal(calls.createTodo.length, 0);
});

test('a future completion date is refused and does not log time', async () => {
    const { mem, calls } = world();
    const response = await handleBotTimeRequest(request(entry({ completedOn: '2026-11-04' })), deps(mem, calls));
    const body = await response.json() as { code: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, 'completion_date');
    assert.equal(mem.tasks.length, 0);
    assert.equal(mem.logs.length, 0);
    assert.equal(calls.createTodo.length, 0);
});

test('an existing task is reused by exact title and is not created again', async () => {
    const { mem, calls } = world();
    mem.tasks.push({
        id: 'task-existing',
        organizationId: ORG,
        clientId: CLIENT,
        title: 'Write the Ecoworkz brief',
        status: 'todo',
        completedAt: null,
        statusHistory: [],
        basecampTodoId: null,
        basecampProjectId: null,
        category: 'content',
        dueDate: null,
        botOperationId: null,
    });
    const response = await handleBotTimeRequest(request(entry({ createTask: false })), deps(mem, calls));
    const body = await response.json() as { task: { id: string; created: boolean } };
    assert.equal(response.status, 200);
    assert.equal(body.task.id, 'task-existing');
    assert.equal(body.task.created, false);
    assert.equal(mem.tasks.length, 1);
    assert.equal(calls.createTodo.length, 1);
});

test('a new task can use a label the client already has, and stays unlabeled when category is omitted', async () => {
    const labeled = world();
    labeled.mem.categories = ['SEO', 'Set up SEO campaign'];
    const created = await handleBotTimeRequest(request(entry({
        idempotencyKey: 'ecoworkz-seo-label',
        category: 'SEO',
        complete: false,
        completedOn: undefined,
    })), deps(labeled.mem, labeled.calls));
    assert.equal(created.status, 200);
    assert.equal(labeled.mem.tasks[0]?.category, 'SEO');
    assert.deepEqual(labeled.mem.inserts, [{ category: 'SEO', actorUserId: CARLOS }]);

    const plain = world();
    const unlabeled = await handleBotTimeRequest(request(entry({
        idempotencyKey: 'ecoworkz-no-label',
        category: undefined,
        complete: false,
        completedOn: undefined,
    })), deps(plain.mem, plain.calls));
    assert.equal(unlabeled.status, 200);
    assert.equal(plain.mem.tasks[0]?.category, null);
    assert.deepEqual(plain.mem.inserts, [{ category: undefined, actorUserId: CARLOS }]);
});

test('a category the client has never used is rejected and does not create a task', async () => {
    const { mem, calls } = world();
    const response = await handleBotTimeRequest(request(entry({
        idempotencyKey: 'ecoworkz-new-label',
        category: 'Brand new group',
        complete: false,
        completedOn: undefined,
    })), deps(mem, calls));
    const body = await response.json() as { code: string; error: string };
    assert.equal(response.status, 400);
    assert.equal(body.code, 'invalid_request');
    assert.match(body.error, /label this client already uses/);
    assert.equal(mem.tasks.length, 0);
    assert.equal(mem.inserts.length, 0);
    assert.equal(calls.createTodo.length, 0);

    mem.tasks.push({
        id: 'task-existing',
        organizationId: ORG,
        clientId: CLIENT,
        title: 'Write the Ecoworkz brief',
        status: 'todo',
        completedAt: null,
        statusHistory: [],
        basecampTodoId: null,
        basecampProjectId: null,
        category: 'SEO',
        dueDate: null,
        botOperationId: null,
    });
    const reused = await handleBotTimeRequest(request(entry({
        idempotencyKey: 'ecoworkz-reuse-label',
        category: 'Brand new group',
        createTask: false,
        complete: false,
        completedOn: undefined,
    })), deps(mem, calls));
    assert.equal(reused.status, 200);
    assert.equal(mem.inserts.length, 0);
});
