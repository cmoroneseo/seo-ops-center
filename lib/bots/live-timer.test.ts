import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { handleBotRequest, type BotDeps, type BotOperationRecord } from './handle.ts';
import { liveBotDeps, withStretchRow } from './live.ts';
import { listLedgerLogs } from '../supabase/timesheet-ledger-source.ts';
import { createPausedTrimPatch } from '../timesheets/paused-trim-route.ts';
import { loadPausedTrim, savePausedTrim } from '../timesheets/paused-trim-store.ts';
import { BOT_TIMER_PAUSE_PATH, BOT_TIMER_RESUME_PATH, BOT_TIMER_STOP_PATH } from './scope.ts';

// Drives the real liveBotDeps timer writes against an in-memory stand-in for
// the Supabase client, so the response is built the way production builds it.

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const CARLOS = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';
const LOG = '77777777-7777-4777-8777-777777777777';
const TOKEN = 'seo_bot_testtokenvalue';

type Row = Record<string, unknown>;

/** Postgres renders timestamptz as `+00:00`, not the `.000Z` the handler builds. */
function pgTime(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return value;
    return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, (_m, frac: string) => (frac === '000' ? '' : `.${frac}`) + '+00:00');
}

const AUDIT = /\b(?:trimmed_\w+|paused_trim_source)\b/;

function field(row: Row, name: string) {
    const [column, key] = name.split('->>');
    return key ? (row[column] as Row | undefined)?.[key] : row[column];
}

class FakeDb {
    tasks: Row[] = [];
    timeLogs: Row[] = [];
    segments: Row[] = [];
    auditReferences = 0;
    missingAuditCode: string | null = null;
    beforeWrite?: (table: string, action: string, patch: Row) => { code: string } | void;

    from(table: string) {
        return new FakeQuery(this, table);
    }

    withEmbeds(row: Row, columns: string): Row {
        const selected = Object.fromEntries(Object.entries(row)
            .filter(([key]) => !AUDIT.test(key) || columns.includes(key)));
        if (columns.includes('paused_at:')) selected.paused_at = field(row, 'paused_trim_source->>pausedAt');
        if (!columns.includes('time_log_segments')) return selected;
        return {
            ...selected,
            tasks: { title: 'Technical audit' },
            time_log_segments: this.segments
                .filter(segment => segment.time_log_id === row.id)
                .map(segment => ({ ...segment })),
        };
    }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: Array<(row: Row) => boolean> = [];
    private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    private payload: Row = {};
    private filterColumns: string[] = [];
    private additions: Row[] = [];
    private columns = '*';
    private limitTo: number | null = null;

    constructor(private db: FakeDb, private table: string) {}

    select(columns = '*') { this.columns = columns; return this; }
    insert(row: Row) { this.action = 'insert'; this.payload = row; return this; }
    update(patch: Row) { this.action = 'update'; this.payload = patch; return this; }
    delete() { this.action = 'delete'; return this; }
    upsert(rows: Row[]) { this.action = 'upsert'; this.additions = rows; return this; }
    eq(column: string, value: unknown) {
        this.filterColumns.push(column);
        this.filters.push(row => field(row, column) === value);
        return this;
    }
    is(column: string, value: null) {
        this.filterColumns.push(column);
        this.filters.push(row => (field(row, column) ?? null) === value);
        return this;
    }
    gte(column: string, value: string) { this.filters.push(row => String(row[column]) >= value); return this; }
    lte(column: string, value: string) { this.filters.push(row => String(row[column]) <= value); return this; }
    or(expression: string) {
        assert.equal(expression, 'status.eq.todo,status.is.null');
        this.filters.push(row => row.status === 'todo' || row.status == null);
        return this;
    }
    in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this; }
    not(column: string) { this.filters.push(row => row[column] != null); return this; }
    order() { return this; }
    limit(count: number) { this.limitTo = count; return this; }

    private rows(): Row[] {
        if (this.table === 'tasks') return this.db.tasks;
        if (this.table === 'time_logs') return this.db.timeLogs;
        if (this.table === 'time_log_segments') return this.db.segments;
        throw new Error(`unexpected table ${this.table}`);
    }

    private run(): { data: Row[]; error: unknown } {
        if ([this.columns, ...this.filterColumns, ...Object.keys(this.payload)].some(value => AUDIT.test(value))) {
            this.db.auditReferences++;
            if (this.db.missingAuditCode) return { data: [], error: { code: this.db.missingAuditCode } };
        }
        if (this.action !== 'select') {
            const error = this.db.beforeWrite?.(this.table, this.action, this.payload);
            if (error) return { data: [], error };
        }
        const rows = this.rows();
        if (this.action === 'upsert') {
            for (const row of this.additions) {
                if (!rows.some(existing => existing.id === row.id)) {
                    rows.push({ ...row, started_at: pgTime(row.started_at), ended_at: pgTime(row.ended_at) });
                }
            }
            return { data: [], error: null };
        }
        if (this.action === 'insert') {
            const row: Row = { id: randomUUID(), ...this.payload };
            for (const key of ['started_at', 'ended_at', 'timer_started_at']) row[key] = pgTime(row[key]);
            if (rows.some(existing => existing.id === row.id)) return { data: [], error: { code: '23505' } };
            rows.push(row);
            return { data: [this.db.withEmbeds(row, this.columns)], error: null };
        }
        let matched = rows.filter(row => this.filters.every(filter => filter(row)));
        if (this.limitTo != null) matched = matched.slice(0, this.limitTo);
        if (this.action === 'update') {
            for (const row of matched) {
                Object.assign(row, this.payload);
                for (const key of ['started_at', 'ended_at', 'timer_started_at']) {
                    if (key in row) row[key] = pgTime(row[key]);
                }
            }
        }
        if (this.action === 'delete') {
            for (const row of matched) rows.splice(rows.indexOf(row), 1);
        }
        return { data: matched.map(row => this.db.withEmbeds(row, this.columns)), error: null };
    }

    async maybeSingle() {
        const { data, error } = this.run();
        return { data: data[0] ?? null, error };
    }

    async single() {
        const { data, error } = this.run();
        return { data: data[0] ?? null, error: error ?? (data[0] ? null : { code: 'PGRST116' }) };
    }

    then<T1 = { data: unknown; error: unknown }, T2 = never>(
        onFulfilled?: ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>) | null,
        onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
        return Promise.resolve(this.run()).then(onFulfilled, onRejected);
    }
}

test('live completion reads open timers across bot keys but within the task and organization', async () => {
    const db = new FakeDb();
    const deps = liveBotDeps({ admin: () => db as never });
    db.timeLogs.push(
        { id: 'logged', organization_id: ORG, task_id: TASK, status: 'logged' },
        { id: 'other-task', organization_id: ORG, task_id: 'other', status: 'paused' },
        { id: 'other-org', organization_id: 'other', task_id: TASK, status: 'in_progress' },
    );
    assert.equal(await deps.hasOpenTaskTimer(ORG, TASK), false);
    db.timeLogs.push({ id: 'another-bot', organization_id: ORG, task_id: TASK, status: 'paused', bot_key_id: 'other' });
    assert.equal(await deps.hasOpenTaskTimer(ORG, TASK), true);
    db.timeLogs[3] = { id: 'human-timer', organization_id: ORG, task_id: TASK, status: 'in_progress', bot_key_id: null };
    assert.equal(await deps.hasOpenTaskTimer(ORG, TASK), true);
});

test('live task completion scopes the write and lets only one transition win', async () => {
    const db = new FakeDb();
    db.tasks.push({ id: TASK, organization_id: ORG, client_id: CLIENT, initiative_id: 'project-a', title: 'Audit', status: null });
    const deps = liveBotDeps({ admin: () => db as never });
    assert.equal(await deps.getTask(TASK, 'other-org'), null);
    const task = await deps.getTask(TASK, ORG);
    assert.ok(task);
    assert.equal(task.initiativeId, 'project-a');
    const completedAt = '2026-11-03T18:00:00.000Z';
    const patch = { status: 'done', completedAt, statusHistory: [{ status: 'done', at: completedAt }] };
    assert.equal(await deps.saveTask({ ...task, organizationId: 'other-org' }, patch), null);
    const results = await Promise.all([deps.saveTask(task, patch), deps.saveTask(task, patch)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual(db.tasks[0].status_history, patch.statusHistory);
});

function world(startedAt: string, row: Row = {}) {
    const db = new FakeDb();
    db.timeLogs.push({
        id: LOG,
        organization_id: ORG,
        client_id: CLIENT,
        project_id: null,
        task_id: TASK,
        user_id: CARLOS,
        bot_key_id: KEY,
        status: 'in_progress',
        timer_started_at: pgTime(startedAt),
        description: 'Crawl the site',
        counts_toward_budget: true,
        billable: true,
        elapsed_seconds: 0,
        hours: 0,
        date: startedAt.slice(0, 10),
        created_at: pgTime(startedAt),
        ...row,
    });
    const synced: string[] = [];
    const clock = { now: new Date(startedAt) };
    const operations: BotOperationRecord[] = [];
    const live = liveBotDeps({ admin: () => db as never });
    const deps: BotDeps = {
        ...live,
        now: () => clock.now,
        async authenticate() {
            return { id: KEY, organizationId: ORG, name: 'technical-seo', revokedAt: null };
        },
        async recordKeyUse() {},
        async actor() {
            return { userId: CARLOS, name: 'Carlos Morones', email: 'carlos@example.test', organizationId: ORG };
        },
        async findOperation(_keyId, idempotencyKey) {
            return operations.find(item => item.idempotencyKey === idempotencyKey) ?? null;
        },
        async insertOperation(input) {
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
            operations.push(operation);
            return operation;
        },
        async saveOperation(id, patch) {
            const operation = operations.find(item => item.id === id);
            if (operation) Object.assign(operation, patch);
        },
        async getTask() {
            return null;
        },
        async pushTodo() {
            return { status: 'skipped', reason: 'test' };
        },
        async syncTimesheet(timeLogId) {
            synced.push(timeLogId);
            return { status: 'skipped', reason: 'test' };
        },
        async completeTodo() {
            return { status: 'skipped', reason: 'test' };
        },
    };
    return { db, clock, deps, synced };
}

function request(pathname: string, body: Record<string, unknown>) {
    return new Request(`https://seo-ops.test${pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
    });
}

interface PausedResponse {
    timer: {
        status: string;
        elapsedSeconds: number;
        hours: number;
        stretches: Array<{ startedAt: string; endedAt: string; note: string | null }>;
    };
}

test('live pause returns the one stored stretch and the stored elapsed seconds', async () => {
    // The Nov 17 repro: one stretch 18:14:37 to 19:18:06 UTC, stored as 3810 s.
    const { db, clock, deps } = world('2026-11-17T18:14:37.400Z');
    clock.now = new Date('2026-11-17T19:18:06.900Z');

    const response = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-once',
        description: 'Crawl done',
    }), deps);
    assert.equal(response.status, 200);
    const body = await response.json() as PausedResponse;

    assert.equal(db.segments.length, 1);
    const stored = db.timeLogs[0];
    assert.equal(stored.status, 'paused');
    assert.equal(stored.elapsed_seconds, 3810);
    assert.equal(stored.hours, 1.06);

    assert.equal(body.timer.status, 'paused');
    assert.equal(body.timer.stretches.length, 1);
    assert.equal(Date.parse(body.timer.stretches[0].startedAt), Date.parse('2026-11-17T18:14:37.400Z'));
    assert.equal(Date.parse(body.timer.stretches[0].endedAt), Date.parse('2026-11-17T19:18:06.900Z'));
    assert.equal(body.timer.elapsedSeconds, stored.elapsed_seconds);
    assert.equal(body.timer.hours, stored.hours);
});

test('live pause replay with the same key still returns one stretch', async () => {
    const { db, clock, deps } = world('2026-11-17T18:00:00.000Z');
    clock.now = new Date('2026-11-17T18:30:00.000Z');
    const first = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-replay' }), deps);
    assert.equal(first.status, 200);
    const replay = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-replay' }), deps);
    assert.equal(replay.status, 200);
    const body = await replay.json() as PausedResponse;
    assert.equal(db.segments.length, 1);
    assert.equal(body.timer.stretches.length, 1);
    assert.equal(body.timer.elapsedSeconds, 1800);
});

test('live pause, resume, pause, stop list each stored stretch once', async () => {
    const { db, clock, deps } = world('2026-11-17T18:00:00.000Z');

    clock.now = new Date('2026-11-17T18:30:00.000Z');
    const firstPause = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-first' }), deps);
    assert.equal(firstPause.status, 200);
    assert.equal((await firstPause.json() as PausedResponse).timer.stretches.length, 1);

    clock.now = new Date('2026-11-17T18:40:00.000Z');
    const resumed = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-first', taskId: TASK }), deps);
    assert.equal(resumed.status, 200);
    const resumedBody = await resumed.json() as { timer: { status: string; stretches: unknown[] } };
    assert.equal(resumedBody.timer.status, 'running');
    assert.equal(resumedBody.timer.stretches.length, 1);

    clock.now = new Date('2026-11-17T19:00:00.000Z');
    const secondPause = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-second' }), deps);
    assert.equal(secondPause.status, 200);
    const secondBody = await secondPause.json() as PausedResponse;
    assert.equal(db.segments.length, 2);
    assert.equal(secondBody.timer.stretches.length, 2);
    assert.equal(secondBody.timer.elapsedSeconds, 50 * 60);
    assert.equal(secondBody.timer.elapsedSeconds, db.timeLogs[0].elapsed_seconds);

    const stopped = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-first',
        taskId: TASK,
        timeZone: 'America/Los_Angeles',
    }), deps);
    assert.equal(stopped.status, 200);
    const stopBody = await stopped.json() as { timeLog: { minutes: number; hours: number; stretches: unknown[] } };
    assert.equal(db.segments.length, 2);
    assert.equal(stopBody.timeLog.stretches.length, 2);
    assert.equal(stopBody.timeLog.hours, 0.83);
});

test('withStretchRow matches the stored stretch by instant, not by string', () => {
    const stretch = { startedAt: '2026-11-17T18:14:37.000Z', endedAt: '2026-11-17T19:18:06.000Z', note: null };
    const stored = [{ started_at: '2026-11-17T18:14:37+00:00', ended_at: '2026-11-17T19:18:06+00:00', note: null }];
    assert.deepEqual(withStretchRow(stored, stretch), stored);
    assert.deepEqual(withStretchRow([], stretch), [{ started_at: stretch.startedAt, ended_at: stretch.endedAt, note: null }]);
    assert.deepEqual(withStretchRow(null, stretch).length, 1);
});

// f8dd9d2c's shape: paused before bot segments existed, so its time lives only
// on elapsed_seconds. No segments and no timer_started_at.
const LEGACY_ROW: Row = {
    status: 'paused',
    timer_started_at: null,
    elapsed_seconds: 4192,
    hours: 0,
    date: '2026-11-13',
    created_at: '2026-11-14T00:52:05.580056+00:00',
};

interface StopResponse {
    capped: boolean;
    review: boolean;
    timeLog: { id: string; date: string; hours: number; minutes: number; status: string; stretches: unknown[] };
    additionalTimeLogIds?: string[];
}

function stopRequest(idempotencyKey: string) {
    return request(BOT_TIMER_STOP_PATH, { idempotencyKey, taskId: TASK, timeZone: 'America/Los_Angeles' });
}

test('stop on a legacy paused row with no segments logs elapsed_seconds and syncs Basecamp', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T20:00:00.000Z', LEGACY_ROW);
    clock.now = new Date('2026-11-17T20:30:00.000Z');

    const response = await handleBotRequest(stopRequest('stop-legacy'), deps);
    assert.equal(response.status, 200);
    const body = await response.json() as StopResponse;

    assert.equal(body.capped, false);
    assert.equal(body.timeLog.id, LOG);
    assert.equal(body.timeLog.date, '2026-11-13');
    assert.equal(body.timeLog.hours, 1.16);
    assert.equal(body.timeLog.status, 'logged');
    assert.equal(body.additionalTimeLogIds, undefined);
    assert.deepEqual(synced, [LOG]);

    const stored = db.timeLogs[0];
    assert.equal(stored.status, 'logged');
    assert.equal(stored.hours, 1.16);
    assert.equal(stored.elapsed_seconds, 4192);
    assert.equal(db.timeLogs.length, 1);
    // No segment is invented for the legacy time.
    assert.equal(db.segments.length, 0);
});

test('a legacy paused row with no segments can be paused-listed, resumed, and stopped without losing its time', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z', LEGACY_ROW);

    const paused = await deps.listPausedTimers(KEY);
    assert.equal(paused.length, 1);
    assert.equal(paused[0].id, LOG);
    assert.equal(paused[0].pausedAt, LEGACY_ROW.created_at);

    const resumed = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-legacy', taskId: TASK }), deps);
    assert.equal(resumed.status, 200);
    const resumedBody = await resumed.json() as { timer: { status: string; stretches: unknown[] } };
    assert.equal(resumedBody.timer.status, 'running');
    assert.equal(resumedBody.timer.stretches.length, 0);

    clock.now = new Date('2026-11-17T18:30:00.000Z');
    const pausedAgain = await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-legacy' }), deps);
    assert.equal(pausedAgain.status, 200);
    const pausedBody = await pausedAgain.json() as PausedResponse;
    assert.equal(pausedBody.timer.stretches.length, 1);
    assert.equal(pausedBody.timer.elapsedSeconds, 4192 + 1800);
    assert.equal(db.timeLogs[0].elapsed_seconds, 4192 + 1800);
    assert.equal(db.segments.length, 1);

    clock.now = new Date('2026-11-17T18:40:00.000Z');
    const resumedAgain = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-legacy-2', taskId: TASK }), deps);
    assert.equal(resumedAgain.status, 200);

    clock.now = new Date('2026-11-17T19:00:00.000Z');
    const stopped = await handleBotRequest(stopRequest('stop-legacy-resumed'), deps);
    assert.equal(stopped.status, 200);
    const stopBody = await stopped.json() as StopResponse;

    // Legacy time stays on its own day; the new stretches land on Nov 17.
    assert.equal(stopBody.timeLog.date, '2026-11-13');
    assert.equal(stopBody.timeLog.hours, 1.16);
    assert.equal(stopBody.additionalTimeLogIds?.length, 1);
    const extra = db.timeLogs.find(row => row.id === stopBody.additionalTimeLogIds?.[0]);
    assert.equal(extra?.date, '2026-11-17');
    assert.equal(extra?.elapsed_seconds, 3000);
    assert.equal(extra?.hours, 0.83);
    const total = db.timeLogs.reduce((sum, row) => sum + Number(row.elapsed_seconds), 0);
    assert.equal(total, 4192 + 1800 + 1200);
    assert.equal(db.segments.length, 2);
    assert.deepEqual(synced, [LOG, extra?.id]);
});

test('segments that already cover elapsed_seconds are not counted twice', async () => {
    // A row paused by the current code: one 30-minute segment, elapsed_seconds 1800.
    const { db, deps } = world('2026-11-17T18:00:00.000Z', {
        status: 'paused',
        timer_started_at: null,
        elapsed_seconds: 1800,
    });
    db.segments.push({
        id: randomUUID(),
        time_log_id: LOG,
        started_at: '2026-11-17T18:00:00+00:00',
        ended_at: '2026-11-17T18:30:00+00:00',
        note: null,
    });
    const paused = await deps.listPausedTimers(KEY);
    assert.equal(paused[0].carriedSeconds, 0);
    assert.equal(paused[0].pausedAt, '2026-11-17T18:30:00+00:00');

    const stopped = await handleBotRequest(stopRequest('stop-covered'), deps);
    assert.equal(stopped.status, 200);
    const body = await stopped.json() as StopResponse;
    assert.equal(body.timeLog.hours, 0.5);
    assert.equal(db.timeLogs[0].elapsed_seconds, 1800);
});

test('a row with both segments and uncovered legacy seconds counts each once', async () => {
    const { db, deps } = world('2026-11-17T18:00:00.000Z', {
        status: 'paused',
        timer_started_at: null,
        elapsed_seconds: 4192 + 1800,
        date: '2026-11-17',
    });
    db.segments.push({
        id: randomUUID(),
        time_log_id: LOG,
        started_at: '2026-11-17T18:00:00+00:00',
        ended_at: '2026-11-17T18:30:00+00:00',
        note: null,
    });
    const paused = await deps.listPausedTimers(KEY);
    assert.equal(paused[0].carriedSeconds, 4192);

    const stopped = await handleBotRequest(stopRequest('stop-mixed'), deps);
    assert.equal(stopped.status, 200);
    const body = await stopped.json() as StopResponse;
    assert.equal(body.timeLog.date, '2026-11-17');
    assert.equal(body.timeLog.minutes, Math.round((4192 + 1800) / 60));
    assert.equal(db.timeLogs[0].elapsed_seconds, 4192 + 1800);
    assert.equal(body.timeLog.hours, 1.66);
});

test('a configured cap counts legacy seconds: resume is refused and stop goes to review', async () => {
    const previous = process.env.BOT_TIMER_MAX_SECONDS;
    process.env.BOT_TIMER_MAX_SECONDS = '3600';
    try {
        const { db, clock, deps, synced } = world('2026-11-17T20:00:00.000Z', LEGACY_ROW);
        const resumed = await handleBotRequest(request(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-capped', taskId: TASK }), deps);
        assert.equal(resumed.status, 409);
        assert.equal((await resumed.json() as { code: string }).code, 'timer_cap_reached');
        assert.equal(db.timeLogs[0].status, 'paused');

        clock.now = new Date('2026-11-17T20:30:00.000Z');
        const stopped = await handleBotRequest(stopRequest('stop-capped'), deps);
        assert.equal(stopped.status, 200);
        const body = await stopped.json() as StopResponse;
        assert.equal(body.capped, true);
        assert.equal(body.review, true);
        assert.equal(db.timeLogs[0].status, 'needs_review');
        assert.deepEqual(synced, []);
    } finally {
        if (previous === undefined) delete process.env.BOT_TIMER_MAX_SECONDS;
        else process.env.BOT_TIMER_MAX_SECONDS = previous;
    }
});

test('SEO stop trims the open stretch, syncs the corrected hours, and replays by hours', async () => {
    const { db, clock, deps } = world('2026-11-17T18:00:00.000Z');
    clock.now = new Date('2026-11-17T19:00:00.000Z');
    const syncedHours: unknown[] = [];
    deps.syncTimesheet = async id => {
        syncedHours.push(db.timeLogs.find(row => row.id === id)?.hours);
        return { status: 'pushed', providerId: '123' };
    };
    const stop = (hours: number) => handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-corrected', hours,
    }), deps);

    const response = await stop(0.25);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.timeLog.hours, 0.25);
    assert.equal(body.timeLog.basecampEntryId, '123');
    assert.deepEqual(syncedHours, [0.25]);
    assert.equal(db.timeLogs[0].elapsed_seconds, 900);
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 3600);
    assert.equal(db.timeLogs[0].trimmed_at, clock.now.toISOString());
    assert.equal(db.timeLogs[0].trimmed_by, null);
    assert.equal(db.timeLogs[0].trimmed_by_bot_key_id, KEY);
    assert.equal(db.segments[0].ended_at, '2026-11-17T18:15:00+00:00');
    assert.equal(db.segments[0].note, 'Crawl the site');

    const replay = await stop(0.25);
    assert.equal(replay.headers.get('Idempotent-Replayed'), 'true');
    assert.deepEqual(await replay.json(), body);
    assert.equal((await stop(0.5)).status, 409);
    assert.deepEqual(syncedHours, [0.25]);
});

test('non-SEO stop rejects a supplied hours field and still stops without it', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z');
    clock.now = new Date('2026-11-17T19:00:00.000Z');
    deps.authenticate = async () => ({ id: KEY, organizationId: ORG, name: 'operations-bot', revokedAt: null });

    const rejected = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-outside-allowlist', hours: null,
    }), deps);
    assert.equal(rejected.status, 403);
    assert.equal((await rejected.json()).code, 'forbidden');
    assert.equal(db.timeLogs[0].status, 'in_progress');
    assert.deepEqual(synced, []);

    assert.equal((await handleBotRequest(stopRequest('stop-outside-allowlist'), deps)).status, 200);
    assert.equal(db.timeLogs[0].hours, 1);
    assert.deepEqual(synced, [LOG]);
});

test('a stop over the true running time leaves the timer and Basecamp untouched', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z');
    clock.now = new Date('2026-11-17T19:00:00.000Z');
    const initial = structuredClone(db.timeLogs);
    const rejected = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-too-many-hours', hours: 1.01,
    }), deps);
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).code, 'hours_exceeds_running');
    assert.deepEqual(db.timeLogs, initial);
    assert.deepEqual(db.segments, []);
    assert.deepEqual(synced, []);
});

test('trim removes the newest local-day time and records the whole-timer audit on each day', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T07:00:00.000Z');
    clock.now = new Date('2026-11-17T10:00:00.000Z');
    const response = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-across-midnight', hours: 1.5, timeZone: 'America/Los_Angeles',
    }), deps);
    assert.equal(response.status, 200);
    assert.deepEqual(db.timeLogs.map(row => [
        row.date, row.hours, row.elapsed_seconds, row.trimmed_from_seconds, row.trimmed_by_bot_key_id,
    ]), [
        ['2026-11-16', 1, 3600, 10800, KEY],
        ['2026-11-17', 0.5, 1800, 10800, KEY],
    ]);
    assert.equal(db.segments[0].ended_at, '2026-11-17T08:30:00+00:00');
    assert.deepEqual(synced, db.timeLogs.map(row => row.id));
});

test('stop without hours uses the stored app trim and keeps its description and audit', async () => {
    const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z', {
        status: 'paused', timer_started_at: null, elapsed_seconds: 1800, hours: 0.5,
        description: 'Corrected description', trimmed_from_seconds: 7200,
        trimmed_at: '2026-11-17T20:05:00.000Z', trimmed_by: CARLOS,
    });
    db.segments.push({
        id: 'retained-segment', time_log_id: LOG, started_at: '2026-11-17T18:00:00+00:00',
        ended_at: '2026-11-17T18:30:00+00:00', note: 'Original stretch note',
    });
    clock.now = new Date('2026-11-17T20:10:00.000Z');
    const response = await handleBotRequest(stopRequest('stop-app-trim'), deps);
    assert.equal(response.status, 200);
    assert.equal(db.timeLogs[0].hours, 0.5);
    assert.equal(db.timeLogs[0].description, 'Corrected description');
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 7200);
    assert.equal(db.timeLogs[0].trimmed_by, CARLOS);
    assert.equal(db.segments[0].id, 'retained-segment');
    assert.equal(db.segments[0].note, 'Original stretch note');
    assert.equal(db.auditReferences, 0);
    assert.deepEqual(synced, [LOG]);
});

test('configured cap bounds requested hours and an overdue trimmed stop still goes to review', async t => {
    const previous = process.env.BOT_TIMER_MAX_SECONDS;
    process.env.BOT_TIMER_MAX_SECONDS = '7200';
    t.after(() => {
        if (previous === undefined) delete process.env.BOT_TIMER_MAX_SECONDS;
        else process.env.BOT_TIMER_MAX_SECONDS = previous;
    });
    const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z');
    clock.now = new Date('2026-11-17T21:00:00.000Z');
    const stop = (idempotencyKey: string, hours: number) =>
        handleBotRequest(request(BOT_TIMER_STOP_PATH, { idempotencyKey, hours }), deps);
    assert.equal((await stop('over-the-cap', 2.5)).status, 422);
    assert.equal(db.timeLogs[0].status, 'in_progress');
    const accepted = await stop('under-the-cap', 1);
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).timeLog.basecamp.status, 'not_sent');
    assert.equal(db.timeLogs[0].status, 'needs_review');
    assert.equal(db.timeLogs[0].hours, 1);
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 10800);
    assert.deepEqual(synced, []);
});

function pausedTrimWorld() {
    const fixture = world('2026-11-17T18:00:00.000Z', {
        status: 'paused', timer_started_at: null, elapsed_seconds: 7200, hours: 2,
        description: 'First\nLast',
    });
    const { db, clock } = fixture;
    db.segments.push(
        { id: 'first', time_log_id: LOG, started_at: '2026-11-17T18:00:00+00:00', ended_at: '2026-11-17T19:00:00+00:00', note: 'First' },
        { id: 'second', time_log_id: LOG, started_at: '2026-11-17T20:00:00+00:00', ended_at: '2026-11-17T21:00:00+00:00', note: 'Last' },
    );
    clock.now = new Date('2026-11-17T22:00:00.000Z');
    const pausedTrim = createPausedTrimPatch({
        authenticate: async () => ({ id: CARLOS }),
        async findLog() {
            const row = db.timeLogs[0];
            return {
                id: LOG, organizationId: ORG, botKeyId: KEY, userId: CARLOS,
                status: String(row.status), startedAt: row.timer_started_at as string | null,
                elapsedSeconds: Number(row.elapsed_seconds), description: row.description as string | null,
                createdAt: String(row.created_at),
            };
        },
        membership: async () => 'owner',
        loadTime: log => loadPausedTrim(db as never, log, log.createdAt),
        save: (log, input) => savePausedTrim(db as never, log, input),
        now: () => clock.now,
    });
    return {
        ...fixture,
        patch: (hours: number) => pausedTrim(new Request('http://localhost/trim', {
            method: 'PATCH', body: JSON.stringify({ hours, description: 'Corrected description' }),
        }), LOG),
    };
}

test('the real paused trim writes audit, restores original stretches, and syncs only on stop', async () => {
    const { db, deps, patch, synced } = pausedTrimWorld();
    assert.equal((await patch(0.75)).status, 200);
    assert.equal(db.timeLogs[0].status, 'paused');
    assert.equal(db.timeLogs[0].elapsed_seconds, 2700);
    assert.equal(db.timeLogs[0].description, 'Corrected description');
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 7200);
    assert.equal(db.timeLogs[0].trimmed_by, CARLOS);
    assert.equal(db.timeLogs[0].trimmed_by_bot_key_id, null);
    assert.deepEqual(db.segments.map(row => [row.id, row.ended_at]), [['first', '2026-11-17T18:45:00+00:00']]);
    assert.deepEqual(synced, []);
    const [entry] = await listLedgerLogs({
        organizationId: ORG, from: '2026-11-17', to: '2026-11-17',
    }, db as never);
    assert.equal(entry.trimmedFromSeconds, 7200);
    assert.equal(entry.pausedRunningSeconds, 2700);
    assert.equal(entry.pausedAt, '2026-11-17T21:00:00+00:00');

    assert.equal((await patch(2.01)).status, 422);
    assert.equal((await patch(1.5)).status, 200);
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 7200);
    assert.deepEqual(db.segments.map(row => [row.id, row.note, row.ended_at]), [
        ['first', 'First', '2026-11-17T19:00:00+00:00'], ['second', 'Last', '2026-11-17T20:30:00+00:00'],
    ]);
    const auditReferences = db.auditReferences;
    const response = await handleBotRequest(stopRequest('stop-after-retrim'), deps);
    assert.equal(response.status, 200);
    assert.equal(db.timeLogs[0].hours, 1.5);
    assert.equal(db.timeLogs[0].description, 'Corrected description');
    assert.equal(db.auditReferences, auditReferences);
    assert.deepEqual(synced, [LOG]);
});

test('a paused trim loses its conditional write when the timer resumes', async () => {
    const { db, patch, synced } = pausedTrimWorld();
    db.beforeWrite = (table, _action, changes) => {
        if (table === 'time_logs' && 'trimmed_at' in changes) {
            db.timeLogs[0].status = 'in_progress';
            db.timeLogs[0].timer_started_at = '2026-11-17T22:00:00+00:00';
        }
    };
    const response = await patch(0.75);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /changed while you were editing/);
    assert.equal(db.timeLogs[0].status, 'in_progress');
    assert.equal(db.timeLogs[0].elapsed_seconds, 7200);
    assert.equal(db.timeLogs[0].trimmed_at, undefined);
    assert.deepEqual(synced, []);
});

test('a failed restoration cannot grow segments before the corrected total is accepted', async () => {
    const { db, patch } = pausedTrimWorld();
    assert.equal((await patch(0.75)).status, 200);
    db.beforeWrite = (table, _action, changes) => {
        if (table === 'time_logs' && 'trimmed_at' in changes) return { code: 'XX000' };
    };
    assert.equal((await patch(1.5)).status, 500);
    assert.equal(db.timeLogs[0].elapsed_seconds, 2700);
    assert.deepEqual(db.segments.map(row => row.ended_at), ['2026-11-17T18:45:00+00:00']);
    db.beforeWrite = undefined;
    assert.equal((await patch(1.5)).status, 200);
    assert.equal(db.timeLogs[0].elapsed_seconds, 5400);
});

test('normal timer saves and ledger reads work before the trim migration', async () => {
    for (const code of ['42703', 'PGRST204']) {
        const { db, clock, deps, synced } = world('2026-11-17T18:00:00.000Z');
        db.missingAuditCode = code;
        clock.now = new Date('2026-11-17T18:30:00.000Z');
        const explicitStop = await handleBotRequest(request(BOT_TIMER_STOP_PATH, {
            idempotencyKey: 'trim-unavailable', hours: 0.25,
        }), deps);
        assert.equal(explicitStop.status, 503);
        assert.equal((await explicitStop.json()).error, 'Trim needs a database update.');
        assert.equal(db.timeLogs[0].status, 'in_progress');
        assert.deepEqual(db.segments, []);
        assert.deepEqual(synced, []);

        db.auditReferences = 0;
        assert.equal((await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, { idempotencyKey: 'pause-no-audit' }), deps)).status, 200);
        const entries = await listLedgerLogs({
            organizationId: ORG, from: '2026-11-17', to: '2026-11-17', userId: CARLOS,
        }, db as never);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].pausedRunningSeconds, 1800);
        assert.equal(entries[0].trimmedFromSeconds, undefined);
        assert.equal(db.auditReferences, 1);
        assert.equal((await handleBotRequest(request(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-no-audit', taskId: TASK }), deps)).status, 200);
        clock.now = new Date('2026-11-17T19:00:00.000Z');
        assert.equal((await handleBotRequest(stopRequest('stop-no-audit'), deps)).status, 200);
        assert.equal(db.timeLogs[0].hours, 1);
        assert.deepEqual(synced, [LOG]);
        assert.equal(db.auditReferences, 1);
    }
});

test('a new pause after resuming uses the corrected duration plus the new stretch as its bound', async () => {
    const { db, deps, patch, clock } = pausedTrimWorld();
    assert.equal((await patch(0.75)).status, 200);
    assert.equal((await handleBotRequest(request(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-after-trim', taskId: TASK,
    }), deps)).status, 200);
    clock.now = new Date('2026-11-17T22:30:00.000Z');
    assert.equal((await handleBotRequest(request(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'new-pause-after-trim',
    }), deps)).status, 200);
    assert.equal(db.timeLogs[0].elapsed_seconds, 4500);
    assert.equal((await patch(1.26)).status, 422);
    assert.equal((await patch(1.25)).status, 200);
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 4500);
});

test('two simultaneous paused trims share one reservation', async () => {
    const { db, patch } = pausedTrimWorld();
    const results = await Promise.all([patch(0.75), patch(1.25)]);
    assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
    assert.equal(db.timeLogs[0].trimmed_from_seconds, 7200);
    assert.ok([2700, 4500].includes(Number(db.timeLogs[0].elapsed_seconds)));
    assert.equal(field(db.timeLogs[0], 'paused_trim_source->>editId'), undefined);
});
