import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { handleBotRequest, type BotDeps, type BotOperationRecord } from './handle.ts';
import { liveBotDeps, withStretchRow } from './live.ts';
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

class FakeDb {
    timeLogs: Row[] = [];
    segments: Row[] = [];

    from(table: string) {
        return new FakeQuery(this, table);
    }

    withEmbeds(row: Row, columns: string): Row {
        if (!columns.includes('time_log_segments')) return { ...row };
        return {
            ...row,
            tasks: { title: 'Technical audit' },
            time_log_segments: this.segments
                .filter(segment => segment.time_log_id === row.id)
                .map(segment => ({ started_at: segment.started_at, ended_at: segment.ended_at, note: segment.note })),
        };
    }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
    private filters: Array<(row: Row) => boolean> = [];
    private action: 'select' | 'insert' | 'update' = 'select';
    private payload: Row = {};
    private columns = '*';
    private limitTo: number | null = null;

    constructor(private db: FakeDb, private table: string) {}

    select(columns = '*') { this.columns = columns; return this; }
    insert(row: Row) { this.action = 'insert'; this.payload = row; return this; }
    update(patch: Row) { this.action = 'update'; this.payload = patch; return this; }
    eq(column: string, value: unknown) { this.filters.push(row => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push(row => values.includes(row[column])); return this; }
    not(column: string) { this.filters.push(row => row[column] != null); return this; }
    order() { return this; }
    limit(count: number) { this.limitTo = count; return this; }

    private rows(): Row[] {
        if (this.table === 'time_logs') return this.db.timeLogs;
        if (this.table === 'time_log_segments') return this.db.segments;
        throw new Error(`unexpected table ${this.table}`);
    }

    private run(): { data: Row[]; error: unknown } {
        const rows = this.rows();
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
                row.timer_started_at = pgTime(row.timer_started_at);
            }
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

function world(startedAt: string) {
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
    });
    const clock = { now: new Date(startedAt) };
    const operations: BotOperationRecord[] = [];
    const live = liveBotDeps({ admin: () => db as never });
    const deps: BotDeps = {
        ...live,
        now: () => clock.now,
        async authenticate() {
            return { id: KEY, organizationId: ORG, name: 'technical-seo', revokedAt: null };
        },
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
        async syncTimesheet() {
            return { status: 'skipped', reason: 'test' };
        },
        async completeTodo() {
            return { status: 'skipped', reason: 'test' };
        },
    };
    return { db, clock, deps };
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
