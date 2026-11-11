import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { createBasecampTimesheetPost, resolveBasecampTimesheetRecording } from '../basecamp/timesheet-post-route.ts';
import { createTimesheetPerformer } from '../basecamp/timesheet-perform.ts';
import { hashBotKey } from './keys.ts';
import { matchBotTask } from './task-lookup.ts';
import { botCreatedTaskRow } from './task-create.ts';
import {
    BotTimerLookupError,
    capOverdueBotTimers,
    handleBotRequest,
    type BotActor,
    type BotDeps,
    type BotOperationRecord,
    type BotTaskRecord,
    type FinalizedBotLog,
    type RunningBotTimer,
} from './handle.ts';
import { BOT_TASKS_PATH, BOT_TIMER_PAUSE_PATH, BOT_TIMER_RESUME_PATH, BOT_TIMER_START_PATH, BOT_TIMER_STOP_PATH } from './scope.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CARLOS = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'seo_bot_testtokenvalue';
const NOW = new Date('2026-11-03T18:00:00.000Z');

const actor: BotActor = {
    userId: CARLOS,
    name: 'Carlos Morones',
    email: 'cmorones@marketingempiregroup.com',
    organizationId: ORG,
};

interface Mem {
    keyName: string;
    revoked: boolean;
    tasks: BotTaskRecord[];
    rows: Array<Record<string, unknown>>;
    timers: RunningBotTimer[];
    /** Closed segments already written. A replay must not push a second copy. */
    segments: Array<{ timeLogId: string; startedAt: string; endedAt: string; note: string | null }>;
    logs: FinalizedBotLog[];
    operations: BotOperationRecord[];
    categories: string[];
    synced: string[];
    pushed: string[];
    completed: string[];
    now: Date;
}

function task(patch: Partial<BotTaskRecord> & Pick<BotTaskRecord, 'id' | 'title'>): BotTaskRecord {
    return {
        organizationId: ORG,
        clientId: CLIENT,
        projectId: null,
        status: 'todo',
        completedAt: null,
        statusHistory: [],
        basecampTodoId: null,
        basecampProjectId: null,
        parentTaskId: null,
        category: null,
        dueDate: null,
        botOperationId: null,
        ...patch,
    };
}

function world(patch: Partial<Mem> = {}): { mem: Mem; deps: BotDeps } {
    const mem: Mem = {
        keyName: 'seo-manager',
        revoked: false,
        tasks: [],
        rows: [],
        timers: [],
        segments: [],
        logs: [],
        operations: [],
        categories: [],
        synced: [],
        pushed: [],
        completed: [],
        now: new Date(NOW),
        ...patch,
    };
    const deps: BotDeps = {
        now: () => mem.now,
        async authenticate(token) {
            if (mem.revoked || hashBotKey(token) !== hashBotKey(TOKEN)) return null;
            return { id: KEY, organizationId: ORG, name: mem.keyName, revokedAt: null };
        },
        async actor() {
            return actor;
        },
        async findOperation(_keyId, idempotencyKey) {
            return mem.operations.find(item => item.idempotencyKey === idempotencyKey) ?? null;
        },
        async insertOperation(input) {
            if (mem.operations.some(item => item.idempotencyKey === input.idempotencyKey)) return 'conflict';
            const operation: BotOperationRecord = {
                id: randomUUID(),
                botKeyId: input.botKeyId,
                idempotencyKey: input.idempotencyKey,
                requestHash: input.requestHash,
                status: 'pending',
                lockedAt: input.lockedAt,
                taskId: null,
                timeLogId: null,
                httpStatus: null,
                response: null,
            };
            mem.operations.push(operation);
            return operation;
        },
        async saveOperation(id, patch) {
            const operation = mem.operations.find(item => item.id === id);
            if (!operation) return;
            Object.assign(operation, patch);
        },
        async findClient() {
            return { id: CLIENT, organizationId: ORG, name: 'Ecoworkz' };
        },
        async clientCategories() {
            return mem.categories;
        },
        async findTask(_org, _client, command) {
            const refs = mem.tasks.map(item => ({
                id: item.id,
                title: item.title,
                parentTaskId: item.parentTaskId,
            }));
            const match = matchBotTask(refs, command);
            if (!match.ok) {
                const parent = refs.find(row => (
                    row.parentTaskId == null
                    && (command.parentTaskId ? row.id === command.parentTaskId : row.title === command.parentTitle)
                ));
                return { ...match, ...(parent && match.reason === 'missing' ? { parentId: parent.id } : {}) };
            }
            return mem.tasks.find(item => item.id === match.taskId) ?? null;
        },
        async getTask(taskId) {
            return mem.tasks.find(item => item.id === taskId) ?? null;
        },
        async insertTask(input) {
            const row = botCreatedTaskRow({
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
            });
            if (input.botOperationId && mem.rows.some(item => item.bot_operation_id === input.botOperationId)) {
                return 'conflict';
            }
            mem.rows.push(row);
            const created = task({
                id: randomUUID(),
                title: input.title,
                ...(input.category ? { category: input.category } : {}),
                ...(input.dueDate ? { dueDate: input.dueDate } : {}),
                parentTaskId: input.parentTaskId ?? null,
                botOperationId: input.botOperationId,
            });
            mem.tasks.push(created);
            return created;
        },
        async saveTask(taskId, patch) {
            const item = mem.tasks.find(row => row.id === taskId);
            if (!item) return null;
            item.status = patch.status;
            item.completedAt = patch.completedAt;
            item.statusHistory = patch.statusHistory;
            return item;
        },
        async findRunningTimer(botKeyId) {
            return mem.timers.find(item => item.botKeyId === botKeyId && item.pausedAt == null && item.startedAt != null) ?? null;
        },
        async listPausedTimers(botKeyId) {
            return mem.timers.filter(item => item.botKeyId === botKeyId && item.pausedAt != null);
        },
        async listAllPausedTimers() {
            return mem.timers.filter(item => item.pausedAt != null);
        },
        async listOverdueTimers() {
            return mem.timers.filter(item => item.pausedAt == null && item.startedAt != null);
        },
        async getTimer(id) {
            return mem.timers.find(item => item.id === id) ?? null;
        },
        async insertRunningTimer(input) {
            if (mem.timers.some(item => item.botKeyId === input.botKeyId && item.pausedAt == null && item.startedAt != null)) {
                return 'conflict';
            }
            const timer: RunningBotTimer = {
                id: randomUUID(),
                organizationId: input.organizationId,
                clientId: input.clientId,
                taskId: input.taskId,
                taskTitle: input.taskTitle,
                userId: input.actor.userId,
                botKeyId: input.botKeyId,
                startedAt: input.startedAt,
                description: input.description,
                countsTowardBudget: input.countsTowardBudget,
                billable: input.billable,
                projectId: input.projectId,
                stretches: [],
                openNote: input.openNote,
                pausedAt: null,
            };
            mem.timers.push(timer);
            return timer;
        },
        async pauseTimer(input) {
            const timer = mem.timers.find(item => item.id === input.timer.id);
            if (!timer) return null;
            if (!timer.stretches.some(stretch => stretch.startedAt === input.stretch.startedAt)) {
                timer.stretches.push(input.stretch);
                mem.segments.push({ timeLogId: timer.id, ...input.stretch });
            }
            timer.pausedAt = input.stretch.endedAt;
            timer.startedAt = null;
            timer.openNote = null;
            timer.description = input.description;
            return timer;
        },
        async resumeTimer(input) {
            if (mem.timers.some(item => item.botKeyId === input.timer.botKeyId && item.id !== input.timer.id && item.pausedAt == null && item.startedAt != null)) {
                return 'conflict';
            }
            const timer = mem.timers.find(item => item.id === input.timer.id);
            if (!timer || timer.pausedAt == null) return null;
            timer.startedAt = input.startedAt;
            timer.pausedAt = null;
            timer.openNote = input.openNote;
            timer.description = input.openNote ?? timer.description;
            return timer;
        },
        async finalizeTimer(input) {
            const index = mem.timers.findIndex(item => item.id === input.timer.id);
            if (index === -1) return null;
            for (const stretch of input.stretches) {
                if (!mem.segments.some(segment => segment.timeLogId === input.timer.id && segment.startedAt === stretch.startedAt)) {
                    mem.segments.push({ timeLogId: input.timer.id, ...stretch });
                }
            }
            mem.timers.splice(index, 1);
            const logs = input.slices.map((slice, sliceIndex) => {
                const log: FinalizedBotLog = {
                    id: sliceIndex === 0 ? input.timer.id : randomUUID(),
                    taskId: input.timer.taskId,
                    date: slice.date,
                    hours: slice.hours,
                    minutes: Math.round(slice.hours * 60),
                    description: input.description,
                    countsTowardBudget: input.countsTowardBudget,
                    billable: input.billable,
                    status: input.capped ? 'needs_review' : 'logged',
                    basecampEntryId: null,
                };
                mem.logs.push(log);
                return log;
            });
            return logs;
        },
        async pushTodo(taskId) {
            mem.pushed.push(taskId);
            const item = mem.tasks.find(row => row.id === taskId);
            if (item && !item.basecampTodoId) item.basecampTodoId = '77';
            return { status: 'pushed', providerId: '77' };
        },
        async syncTimesheet(timeLogId) {
            mem.synced.push(timeLogId);
            const log = mem.logs.find(item => item.id === timeLogId);
            if (log) log.basecampEntryId = '900';
            return { status: 'pushed', providerId: '900' };
        },
        async completeTodo(taskId) {
            mem.completed.push(taskId);
            return { status: 'pushed', providerId: '77' };
        },
    };
    return { mem, deps };
}

function request(pathname: string, body: Record<string, unknown>, token: string | null = TOKEN) {
    return new Request(`https://seo-ops.test${pathname}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
    });
}

test('only the seo-manager key can create a task, and it is assigned to the owner', async () => {
    const denied = world({ keyName: 'technical-seo' });
    const response = await handleBotRequest(request(BOT_TASKS_PATH, {
        idempotencyKey: 'create-brief',
        clientName: 'Ecoworkz',
        taskTitle: 'Write the brief',
        category: 'content',
    }), denied.deps);
    assert.equal(response.status, 403);
    assert.equal(denied.mem.tasks.length, 0);

    const allowed = world();
    const created = await handleBotRequest(request(BOT_TASKS_PATH, {
        idempotencyKey: 'create-brief',
        clientName: 'Ecoworkz',
        taskTitle: 'August blogs',
        category: 'content',
        subtasks: [{ title: 'Brief' }, { title: 'Draft', category: 'content' }],
    }), allowed.deps);
    assert.equal(created.status, 200);
    const body = await created.json() as {
        task: { created: boolean; title: string };
        subtasks: Array<{ title: string; created: boolean; parentTaskId: string }>;
    };
    assert.equal(body.task.created, true);
    assert.equal(body.subtasks.length, 2);
    assert.equal(allowed.mem.rows.length, 3);
    for (const row of allowed.mem.rows) {
        assert.equal(row.assignee_id, CARLOS);
        assert.deepEqual(row.assignee_ids, [CARLOS]);
        assert.equal(row.created_by, CARLOS);
    }
    const stamped = allowed.mem.rows.filter(row => row.bot_operation_id);
    assert.equal(stamped.length, 1);
    assert.equal(allowed.mem.tasks.filter(item => item.parentTaskId).length, 2);
    assert.equal(allowed.mem.pushed.length, 1);
});

test('a subtask can be created under an existing parent', async () => {
    const parent = task({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'August blogs' });
    const { mem, deps } = world({ tasks: [parent] });
    const response = await handleBotRequest(request(BOT_TASKS_PATH, {
        idempotencyKey: 'create-child',
        clientId: CLIENT,
        parentTitle: 'August blogs',
        taskTitle: 'Brief',
        category: 'technical',
    }), deps);
    assert.equal(response.status, 200);
    const child = mem.tasks.find(item => item.title === 'Brief');
    assert.equal(child?.parentTaskId, parent.id);
    assert.equal(mem.rows[0]?.category, 'technical');
    assert.deepEqual(mem.pushed, [parent.id]);
});

test('a timer starts only on an existing task and a second start on that task is the same timer', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const { mem, deps } = world({ keyName: 'technical-seo', tasks: [existing] });
    const missing = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-missing',
        clientId: CLIENT,
        taskTitle: 'Does not exist',
    }), deps);
    assert.equal(missing.status, 404);
    assert.equal(mem.timers.length, 0);
    assert.equal(mem.rows.length, 0);

    const started = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskTitle: 'Brief',
    }), deps);
    assert.equal(started.status, 200);
    const first = await started.json() as { timer: { id: string; alreadyRunning: boolean } };
    assert.equal(first.timer.alreadyRunning, false);
    assert.equal(mem.timers.length, 1);
    assert.equal(mem.timers[0].userId, CARLOS);

    const again = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief-again',
        clientId: CLIENT,
        taskTitle: 'Brief',
    }), deps);
    assert.equal(again.status, 200);
    const second = await again.json() as { timer: { id: string; alreadyRunning: boolean } };
    assert.equal(second.timer.alreadyRunning, true);
    assert.equal(second.timer.id, first.timer.id);
    assert.equal(mem.timers.length, 1);

    const replay = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskTitle: 'Brief',
    }), deps);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(mem.timers.length, 1);
});

test('a start on a different task is rejected while a timer is running', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const draft = task({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Draft' });
    const { deps } = world({ tasks: [brief, draft] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    const blocked = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-draft',
        clientId: CLIENT,
        taskId: draft.id,
    }), deps);
    assert.equal(blocked.status, 409);
    const body = await blocked.json() as { code: string; timer: { taskId: string } };
    assert.equal(body.code, 'timer_already_running');
    assert.equal(body.timer.taskId, brief.id);
});

test('stopping a timer logs the elapsed time and sends it to Basecamp', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief', basecampTodoId: '77' });
    const { mem, deps } = world({ tasks: [existing] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: existing.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 30 * 60 * 1000);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        description: 'Drafted the brief',
    }), deps);
    assert.equal(stopped.status, 200);
    const body = await stopped.json() as {
        capped: boolean;
        timeLog: { hours: number; minutes: number; status: string; basecampEntryId: string; description: string };
    };
    assert.equal(body.capped, false);
    assert.equal(body.timeLog.hours, 0.5);
    assert.equal(body.timeLog.minutes, 30);
    assert.equal(body.timeLog.status, 'logged');
    assert.equal(body.timeLog.description, 'Drafted the brief');
    assert.equal(body.timeLog.basecampEntryId, '900');
    assert.deepEqual(mem.synced, [mem.logs[0].id]);
    assert.equal(mem.timers.length, 0);

    const replay = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        description: 'Drafted the brief',
    }), deps);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(mem.synced.length, 1);
});

test('a timer longer than two hours stops at the cap, is flagged, and is not sent to Basecamp', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const { mem, deps } = world({ tasks: [existing] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: existing.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + (2 * 60 + 15) * 60 * 1000);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
    }), deps);
    const body = await stopped.json() as {
        capped: boolean;
        review: boolean;
        timeLog: { hours: number; status: string; basecamp: { status: string } };
    };
    assert.equal(body.capped, true);
    assert.equal(body.review, true);
    assert.equal(body.timeLog.hours, 2);
    assert.equal(body.timeLog.status, 'needs_review');
    assert.equal(body.timeLog.basecamp.status, 'not_sent');
    assert.equal(mem.synced.length, 0);
});

test('the next start caps an overdue timer before starting the new one', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const draft = task({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Draft' });
    const { mem, deps } = world({ tasks: [brief, draft] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    const started = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-draft',
        clientId: CLIENT,
        taskId: draft.id,
    }), deps);
    assert.equal(started.status, 200);
    const body = await started.json() as {
        timer: { taskId: string };
        cappedTimer: { hours: number; status: string; review: boolean };
    };
    assert.equal(body.timer.taskId, draft.id);
    assert.equal(body.cappedTimer.hours, 2);
    assert.equal(body.cappedTimer.status, 'needs_review');
    assert.equal(body.cappedTimer.review, true);
    assert.equal(mem.synced.length, 0);
    assert.equal(mem.logs[0].taskId, brief.id);
    assert.equal(mem.timers[0].taskId, draft.id);
});

test('the sweep stops a forgotten timer at two hours without a bot calling back', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const { mem, deps } = world({ tasks: [existing] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: existing.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 5 * 60 * 60 * 1000);
    const result = await capOverdueBotTimers(deps);
    assert.deepEqual(result, { checked: 1, capped: 1, stalePaused: [] });
    assert.equal(mem.timers.length, 0);
    assert.equal(mem.logs[0].hours, 2);
    assert.equal(mem.logs[0].status, 'needs_review');
    assert.equal(mem.synced.length, 0);
    const again = await capOverdueBotTimers(deps);
    assert.deepEqual(again, { checked: 0, capped: 0, stalePaused: [] });
});

test('time on a subtask is posted to the parent to-do', async () => {
    const parent = task({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: 'August blogs',
        basecampTodoId: '77',
        basecampProjectId: '202',
    });
    const child = task({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: 'Brief',
        parentTaskId: parent.id,
        basecampTodoId: '88',
        basecampProjectId: '202',
    });
    const calls: Array<{ recordingId: number; hours: number }> = [];
    const { mem, deps } = world({ tasks: [parent, child] });
    deps.syncTimesheet = async (timeLogId) => {
        const post = createBasecampTimesheetPost({
            async authorizeTimeLog() {
                return {
                    ok: true,
                    userId: CARLOS,
                    actorName: actor.name,
                    organizationId: ORG,
                    clientId: CLIENT,
                    timeLogId,
                    organizationIsInternal: false,
                    role: 'owner',
                    canManageIntegrations: true,
                };
            },
            createStore: () => ({
                async getTimeLog(id) {
                    const log = mem.logs.find(item => item.id === id);
                    const item = mem.tasks.find(row => row.id === log?.taskId);
                    const owner = item?.parentTaskId
                        ? mem.tasks.find(row => row.id === item.parentTaskId) ?? null
                        : null;
                    if (!log || !item) return null;
                    return {
                        id: log.id,
                        organizationId: ORG,
                        clientId: CLIENT,
                        userId: CARLOS,
                        taskId: item.id,
                        date: log.date,
                        hours: log.hours,
                        description: log.description,
                        status: log.status,
                        basecampEntryId: log.basecampEntryId,
                        basecampRecordingId: null,
                        selectedBasecampProjectId: null,
                        configuredProjectId: '202',
                        syncEnabled: true,
                        timesheetEnabled: true,
                        cachedRecordingId: null,
                        taskBasecampTodoId: item.basecampTodoId,
                        taskBasecampProjectId: item.basecampProjectId,
                        parentTaskId: item.parentTaskId,
                        parentBasecampTodoId: owner?.basecampTodoId ?? null,
                        parentBasecampProjectId: owner?.basecampProjectId ?? null,
                        taskTitle: item.title,
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
                        return todoId === '77' ? { id: todoId } : null;
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
                    calls.push({ recordingId, hours: fields.hours });
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
                    if (row && patch.entryId !== undefined) row.basecampEntryId = String(patch.entryId);
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
        const response = await post(new Request('https://seo-ops.test/api/integrations/basecamp/timesheet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'sync', timeLogId, createIfMissing: true }),
        }));
        const payload = await response.json() as { success?: boolean; entryId?: number };
        return payload.success
            ? { status: 'pushed' as const, providerId: String(payload.entryId) }
            : { status: 'failed' as const };
    };

    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        parentTitle: 'August blogs',
        taskTitle: 'Brief',
    }), deps);
    mem.now = new Date(NOW.getTime() + 45 * 60 * 1000);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
    }), deps);
    assert.equal(stopped.status, 200);
    assert.equal(mem.logs[0].taskId, child.id);
    assert.equal(mem.logs[0].hours, 0.75);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].recordingId, 77);
    assert.equal(calls[0].hours, 0.75);
});

test('pause keeps the same entry, resume continues it, and stop sends one Basecamp note without the clock', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief', basecampTodoId: '77' });
    const { mem, deps } = world({ tasks: [existing] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: existing.id,
        description: 'Mapped the keyword set',
    }), deps);
    mem.now = new Date(NOW.getTime() + 30 * 60 * 1000);
    const paused = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-brief',
        description: 'Checked the top ten',
    }), deps);
    assert.equal(paused.status, 200);
    const pausedBody = await paused.json() as {
        timer: { id: string; status: string; hours: number; stretches: Array<{ note: string }> };
    };
    assert.equal(pausedBody.timer.status, 'paused');
    assert.equal(pausedBody.timer.hours, 0.5);
    assert.equal(pausedBody.timer.stretches.length, 1);
    assert.equal(pausedBody.timer.stretches[0].note, 'Mapped the keyword set\nChecked the top ten');
    assert.equal(mem.segments.length, 1);
    assert.equal(mem.synced.length, 0);
    assert.equal(mem.timers.filter(item => item.pausedAt == null).length, 0);

    const replay = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-brief',
        description: 'Checked the top ten',
    }), deps);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(mem.segments.length, 1);

    const again = mem.operations.find(item => item.idempotencyKey === 'pause-brief');
    if (again) {
        again.status = 'pending';
        again.lockedAt = new Date(0).toISOString();
    }
    const retried = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-brief',
        description: 'Checked the top ten',
    }), deps);
    assert.equal(retried.status, 200);
    assert.equal(mem.segments.length, 1);

    mem.now = new Date(NOW.getTime() + 90 * 60 * 1000);
    const resumed = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: existing.id,
        description: 'Drafted the brief',
    }), deps);
    assert.equal(resumed.status, 200);
    const resumedBody = await resumed.json() as { timer: { id: string; status: string; startedAt: string } };
    assert.equal(resumedBody.timer.status, 'running');
    assert.equal(resumedBody.timer.id, pausedBody.timer.id);
    assert.equal(mem.segments.length, 1);
    assert.equal(mem.synced.length, 0);

    const resumeAgain = mem.operations.find(item => item.idempotencyKey === 'resume-brief');
    if (resumeAgain) {
        resumeAgain.status = 'pending';
        resumeAgain.lockedAt = new Date(0).toISOString();
    }
    mem.now = new Date(NOW.getTime() + 100 * 60 * 1000);
    const resumeRetry = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: existing.id,
        description: 'Drafted the brief',
    }), deps);
    assert.equal(resumeRetry.status, 200);
    const retryBody = await resumeRetry.json() as { timer: { startedAt: string } };
    assert.equal(retryBody.timer.startedAt, resumedBody.timer.startedAt);
    assert.equal(mem.segments.length, 1);

    mem.now = new Date(NOW.getTime() + 120 * 60 * 1000);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        description: 'Ready for review',
        complete: true,
    }), deps);
    assert.equal(stopped.status, 200);
    const stoppedBody = await stopped.json() as {
        capped: boolean;
        timeLog: { hours: number; description: string; status: string; basecamp: { status: string } };
        task: { status: string };
    };
    assert.equal(stoppedBody.capped, false);
    assert.equal(stoppedBody.timeLog.hours, 1);
    assert.equal(stoppedBody.timeLog.status, 'logged');
    assert.equal(stoppedBody.timeLog.description, [
        'Mapped the keyword set',
        'Checked the top ten',
        'Drafted the brief',
        'Ready for review',
    ].join('\n'));
    assert.equal(stoppedBody.timeLog.description.includes('1'), false);
    assert.equal(/\b(hour|hours|minute|minutes)\b/i.test(stoppedBody.timeLog.description), false);
    assert.equal(stoppedBody.timeLog.basecamp.status, 'pushed');
    assert.equal(mem.synced.length, 1);
    assert.equal(mem.segments.length, 2);
    assert.equal(stoppedBody.task.status, 'done');

    const stopReplay = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        description: 'Ready for review',
        complete: true,
    }), deps);
    assert.equal(stopReplay.headers.get('Idempotent-Replayed'), 'true');
    assert.equal(mem.synced.length, 1);
    assert.equal(mem.segments.length, 2);
});

test('a paused timer does not block another task, and resume while running is a conflict', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const draft = task({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Draft' });
    const { mem, deps } = world({ tasks: [brief, draft] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 10 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-brief' }), deps);
    const started = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-draft',
        clientId: CLIENT,
        taskId: draft.id,
    }), deps);
    assert.equal(started.status, 200);
    const blocked = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: brief.id,
    }), deps);
    assert.equal(blocked.status, 409);
    const body = await blocked.json() as { code: string };
    assert.equal(body.code, 'timer_already_running');
    assert.equal(mem.timers.filter(item => item.pausedAt != null).length, 1);
    assert.equal(mem.synced.length, 0);

    const same = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief-again',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    assert.equal(same.status, 409);
    const sameBody = await same.json() as { code: string };
    assert.equal(sameBody.code, 'timer_already_running');
});

test('stop finishes a paused timer, and two paused timers need a task id', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const draft = task({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Draft' });
    const { mem, deps } = world({ tasks: [brief, draft] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
        description: 'Mapped the keyword set',
    }), deps);
    mem.now = new Date(NOW.getTime() + 15 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-brief' }), deps);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        description: 'Ready for review',
    }), deps);
    assert.equal(stopped.status, 200);
    const body = await stopped.json() as { timeLog: { hours: number; description: string; basecamp: { status: string } } };
    assert.equal(body.timeLog.hours, 0.25);
    assert.equal(body.timeLog.description, 'Mapped the keyword set\nReady for review');
    assert.equal(body.timeLog.basecamp.status, 'pushed');
    assert.equal(mem.segments.length, 1);

    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-draft',
        clientId: CLIENT,
        taskId: draft.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 25 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-draft' }), deps);
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief-2',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 35 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-brief-2' }), deps);
    const ambiguous = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-whichever',
    }), deps);
    assert.equal(ambiguous.status, 409);
    const ambiguousBody = await ambiguous.json() as { code: string };
    assert.equal(ambiguousBody.code, 'timer_ambiguous');
    assert.equal(mem.synced.length, 1);
});

test('the cap counts every stretch, and the sweep leaves a paused timer alone', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const { mem, deps } = world({ tasks: [brief] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 90 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-brief' }), deps);
    mem.now = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    const ignored = await capOverdueBotTimers(deps);
    assert.equal(ignored.capped, 0);
    assert.equal(ignored.stalePaused.length, 0);
    assert.equal(mem.logs.length, 0);
    assert.equal(mem.timers[0].pausedAt != null, true);

    mem.now = new Date(NOW.getTime() + 90 * 60 * 1000 + 8 * 24 * 60 * 60 * 1000);
    const stale = await capOverdueBotTimers(deps);
    assert.equal(stale.capped, 0);
    assert.equal(stale.stalePaused.length, 1);
    assert.equal(stale.stalePaused[0].taskId, brief.id);
    assert.equal(mem.timers[0].pausedAt != null, true);
    assert.equal(mem.synced.length, 0);
    mem.now = new Date(NOW.getTime() + 91 * 60 * 1000);

    const resumed = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: brief.id,
    }), deps);
    assert.equal(resumed.status, 200);
    mem.now = new Date(NOW.getTime() + 140 * 60 * 1000);
    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, { idempotencyKey: 'stop-brief' }), deps);
    const body = await stopped.json() as { capped: boolean; timeLog: { hours: number; status: string; basecamp: { status: string } } };
    assert.equal(body.capped, true);
    assert.equal(body.timeLog.hours, 2);
    assert.equal(body.timeLog.status, 'needs_review');
    assert.equal(body.timeLog.basecamp.status, 'not_sent');
    assert.equal(mem.synced.length, 0);
});

test('resume at two hours is rejected, and two bots can run at the same time', async () => {
    const brief = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const draft = task({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Draft' });
    const { mem, deps } = world({ tasks: [brief, draft] });
    await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    mem.now = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-brief' }), deps);
    const blocked = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: brief.id,
    }), deps);
    assert.equal(blocked.status, 409);
    const blockedBody = await blocked.json() as { code: string };
    assert.equal(blockedBody.code, 'timer_cap_reached');
    assert.equal(mem.timers[0].pausedAt != null, true);
    const restart = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-brief-paused',
        clientId: CLIENT,
        taskId: brief.id,
    }), deps);
    assert.equal(restart.status, 409);
    const restartBody = await restart.json() as { code: string };
    assert.equal(restartBody.code, 'timer_paused');

    const otherToken = 'seo_bot_secondtokenvalue';
    const otherKey = '77777777-7777-4777-8777-777777777777';
    const authenticate = deps.authenticate;
    deps.authenticate = async token => {
        if (hashBotKey(token) === hashBotKey(otherToken)) {
            return { id: otherKey, organizationId: ORG, name: 'technical-seo', revokedAt: null };
        }
        return authenticate(token);
    };
    const other = await handleBotRequest(request(BOT_TIMER_START_PATH, {
        idempotencyKey: 'start-draft',
        clientId: CLIENT,
        taskId: draft.id,
    }, otherToken), deps);
    assert.equal(other.status, 200);
    assert.equal(mem.timers.filter(item => item.pausedAt == null).length, 1);
    assert.equal(mem.timers.filter(item => item.pausedAt != null).length, 1);
});

async function withErrorLog(run: (logs: unknown[][]) => Promise<void>) {
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
        logs.push(args);
    };
    try {
        await run(logs);
    } finally {
        console.error = original;
    }
}

test('a missing running timer stays 404 timer_not_running', async () => {
    const { mem, deps } = world();
    await withErrorLog(async logs => {
        const response = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
            idempotencyKey: 'pause-none',
        }), deps);
        assert.equal(response.status, 404);
        const body = await response.json() as { code: string };
        assert.equal(body.code, 'timer_not_running');
        assert.equal(logs.length, 0);
        assert.equal(mem.timers.length, 0);
    });
});

test('a timer lookup error is 500 timer_lookup_failed, not 404', async () => {
    const { mem, deps } = world();
    deps.findRunningTimer = async () => {
        throw new BotTimerLookupError('PGRST201');
    };
    await withErrorLog(async logs => {
        const response = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
            idempotencyKey: 'pause-lookup-failed',
        }), deps);
        assert.equal(response.status, 500);
        const body = await response.json() as { code: string; error: string };
        assert.equal(body.code, 'timer_lookup_failed');
        assert.equal(body.error, 'The timer could not be looked up.');
        const encoded = JSON.stringify(body);
        assert.equal(encoded.includes('PGRST201'), false);
        assert.equal(encoded.includes('time_log_segments'), false);
        assert.equal(encoded.includes(TOKEN), false);
        assert.deepEqual(logs, [['bot timer lookup failed', { code: 'PGRST201' }]]);
        assert.equal(JSON.stringify(logs).includes(TOKEN), false);
        const operation = mem.operations.find(item => item.idempotencyKey === 'pause-lookup-failed');
        assert.equal(operation?.status, 'pending');
        assert.equal(operation?.httpStatus, null);
        assert.equal(mem.segments.length, 0);
    });
});

test('a paused-timer lookup error on stop is 500, not timer_not_running', async () => {
    const { deps } = world();
    deps.listPausedTimers = async () => {
        throw new BotTimerLookupError('Bearer seo_bot_testtokenvalue could not embed');
    };
    await withErrorLog(async logs => {
        const response = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
            idempotencyKey: 'stop-lookup-failed',
        }), deps);
        assert.equal(response.status, 500);
        const body = await response.json() as { code: string };
        assert.equal(body.code, 'timer_lookup_failed');
        assert.deepEqual(logs, [['bot timer lookup failed', { code: 'unknown' }]]);
        assert.equal(JSON.stringify(logs).includes(TOKEN), false);
        assert.equal(JSON.stringify(logs).includes('could not embed'), false);
    });
});

test('getTimer lookup error on pause is 500, not a missing timer', async () => {
    const { mem, deps } = world();
    mem.operations.push({
        id: '88888888-8888-4888-8888-888888888888',
        botKeyId: KEY,
        idempotencyKey: 'pause-get-timer',
        requestHash: 'ignored-while-pending',
        status: 'pending',
        lockedAt: new Date(0).toISOString(),
        taskId: null,
        timeLogId: '99999999-9999-4999-8999-999999999999',
        httpStatus: null,
        response: null,
    });
    deps.getTimer = async () => {
        throw new BotTimerLookupError('PGRST201');
    };
    await withErrorLog(async logs => {
        const response = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
            idempotencyKey: 'pause-get-timer',
        }), deps);
        assert.equal(response.status, 500);
        const body = await response.json() as { code: string };
        assert.equal(body.code, 'timer_lookup_failed');
        assert.deepEqual(logs, [['bot timer lookup failed', { code: 'PGRST201' }]]);
    });
});

test('start does not treat a timer lookup error as no running timer', async () => {
    const existing = task({ id: '11111111-1111-4111-8111-111111111111', title: 'Brief' });
    const { mem, deps } = world({ tasks: [existing] });
    deps.findRunningTimer = async () => {
        throw new BotTimerLookupError('PGRST201');
    };
    await withErrorLog(async logs => {
        const response = await handleBotRequest(request(BOT_TIMER_START_PATH, {
            idempotencyKey: 'start-lookup-failed',
            clientId: CLIENT,
            taskId: existing.id,
        }), deps);
        assert.equal(response.status, 500);
        const body = await response.json() as { code: string };
        assert.equal(body.code, 'timer_lookup_failed');
        assert.equal(mem.timers.length, 0);
        assert.equal(mem.operations.length, 0);
        assert.deepEqual(logs, [['bot timer lookup failed', { code: 'PGRST201' }]]);
    });
});
