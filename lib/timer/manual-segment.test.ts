import test from 'node:test';
import assert from 'node:assert/strict';
import {
    attachWorkedWindow,
    manualWorkedWindow,
    recordManualTimeLog,
    saveTimeLogEdit,
    timeLogInsertRow,
    workedWindowForEdit,
    zonedWallTimeToUtc,
    type ManualLogStore,
    type WorkedWindowStore,
} from './manual-segment.ts';

const LA = 'America/Los_Angeles';
const AFTER = new Date('2026-12-01T00:00:00.000Z');

test('a Los Angeles afternoon becomes the matching UTC instants and 0.82 hours', () => {
    const window = manualWorkedWindow({
        date: '2026-07-15',
        startTime: '12:42',
        finishTime: '13:31',
        timeZone: LA,
        now: AFTER,
    });
    assert.ok(window);
    assert.equal(window.startedAt, '2026-07-15T19:42:00.000Z');
    assert.equal(window.endedAt, '2026-07-15T20:31:00.000Z');
    assert.equal(window.hours, 0.82);
    assert.equal(Math.round((49 / 60) * 100) / 100, 0.82);
});

test('the same clock in winter is Pacific Standard Time, eight hours behind UTC', () => {
    const window = manualWorkedWindow({
        date: '2026-01-15',
        startTime: '12:42',
        finishTime: '13:31',
        timeZone: LA,
        now: AFTER,
    });
    assert.deepEqual(window, {
        startedAt: '2026-01-15T20:42:00.000Z',
        endedAt: '2026-01-15T21:31:00.000Z',
        hours: 0.82,
    });
});

test('a spring-forward window counts the hour the clock skips', () => {
    // 2026-03-08: 02:00 PST becomes 03:00 PDT. 01:30 to 03:30 is one real hour.
    const window = manualWorkedWindow({
        date: '2026-03-08',
        startTime: '01:30',
        finishTime: '03:30',
        timeZone: LA,
        now: AFTER,
    });
    assert.deepEqual(window, {
        startedAt: '2026-03-08T09:30:00.000Z',
        endedAt: '2026-03-08T10:30:00.000Z',
        hours: 1,
    });
});

test('a time inside the spring-forward gap is rejected', () => {
    assert.equal(zonedWallTimeToUtc('2026-03-08', '02:30', LA), null);
    assert.equal(manualWorkedWindow({
        date: '2026-03-08',
        startTime: '02:15',
        finishTime: '02:45',
        timeZone: LA,
        now: AFTER,
    }), null);
});

test('a fall-back window counts the repeated hour', () => {
    // 2026-11-01: 02:00 PDT falls back to 01:00 PST. 00:30 to 03:00 is 3.5 hours.
    const window = manualWorkedWindow({
        date: '2026-11-01',
        startTime: '00:30',
        finishTime: '03:00',
        timeZone: LA,
        now: AFTER,
    });
    assert.deepEqual(window, {
        startedAt: '2026-11-01T07:30:00.000Z',
        endedAt: '2026-11-01T11:00:00.000Z',
        hours: 3.5,
    });
});

test('an ambiguous fall-back clock reading uses the earlier offset', () => {
    const instant = zonedWallTimeToUtc('2026-11-01', '01:30', LA);
    assert.equal(instant?.toISOString(), '2026-11-01T08:30:00.000Z');
});

test('blank clocks, a finish that is not later, a midnight crossing, and a future finish are null', () => {
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '', finishTime: '', timeZone: LA, now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '12:42', finishTime: '', timeZone: LA, now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '13:31', finishTime: '12:42', timeZone: LA, now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '12:42', finishTime: '12:42', timeZone: LA, now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '23:00', finishTime: '00:30', timeZone: LA, now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-07-15',
        startTime: '12:42',
        finishTime: '13:31',
        timeZone: LA,
        now: new Date('2026-07-15T20:00:00.000Z'),
    }), null);
});

test('a finish at the current instant is allowed and an invalid zone is not', () => {
    const now = new Date('2026-07-15T20:31:00.000Z');
    const window = manualWorkedWindow({
        date: '2026-07-15', startTime: '12:42', finishTime: '13:31', timeZone: LA, now,
    });
    assert.equal(window?.endedAt, now.toISOString());
    assert.equal(manualWorkedWindow({
        date: '2026-07-15', startTime: '12:42', finishTime: '13:31', timeZone: 'Not/AZone', now: AFTER,
    }), null);
    assert.equal(manualWorkedWindow({
        date: '2026-02-31', startTime: '12:42', finishTime: '13:31', timeZone: LA, now: AFTER,
    }), null);
});

test('one filled clock is an error and a log that already has segments is left alone', () => {
    assert.equal(workedWindowForEdit({
        segmentCount: 0, date: '2026-07-15', startTime: '12:42', finishTime: '', timeZone: LA, now: AFTER,
    }).error, 'Enter both a start and a finish, or leave both blank.');
    const placed = workedWindowForEdit({
        segmentCount: 2, date: '2026-07-15', startTime: '12:42', finishTime: '13:31', timeZone: LA, now: AFTER,
    });
    assert.equal(placed.window, null);
    assert.equal(placed.error, null);
});

test('the ledger row carries hours and does not carry the worked window', () => {
    const row = timeLogInsertRow({
        organizationId: 'org-1',
        clientId: 'client-1',
        userId: 'user-1',
        date: '2026-07-15',
        hours: 0.82,
        description: 'Outline',
        billable: true,
    });
    assert.equal(row.hours, 0.82);
    assert.equal(row.status, 'logged');
    assert.equal(row.planned_starts_at, null);
    assert.equal('started_at' in row, false);
    assert.equal('ended_at' in row, false);
    assert.equal('worked_window' in row, false);
});

function recordingStore(segmentError?: string): { store: ManualLogStore; order: string[] } {
    const order: string[] = [];
    const store: ManualLogStore = {
        async insertLog(row) {
            order.push('log');
            return {
                data: {
                    id: 'log-1',
                    organization_id: 'org-1',
                    user_id: 'user-1',
                    hours: row.hours,
                },
                error: null,
            };
        },
        async insertSegment() {
            order.push('segment');
            return { error: segmentError ? { message: segmentError } : null };
        },
        pushBasecamp(_id, createIfMissing) {
            order.push(`push:${createIfMissing}`);
            return Promise.resolve({ success: true });
        },
    };
    return { store, order };
}

const window = {
    startedAt: '2026-07-15T19:42:00.000Z',
    endedAt: '2026-07-15T20:31:00.000Z',
};

test('the segment is inserted after the log and before the Basecamp create', async () => {
    const { store, order } = recordingStore();
    const result = await recordManualTimeLog(store, { hours: 0.82 }, {
        syncToBasecamp: true,
        waitForBasecampSync: true,
        workedWindow: window,
    });
    assert.equal(result.success, true);
    assert.equal(result.segmentWarning, undefined);
    assert.deepEqual(order, ['log', 'segment', 'push:true']);
});

test('a failed segment keeps the log, warns, and still pushes Basecamp', async () => {
    const { store, order } = recordingStore('row level security');
    const result = await recordManualTimeLog(store, { hours: 0.82 }, {
        syncToBasecamp: true,
        waitForBasecampSync: true,
        workedWindow: window,
    });
    assert.equal(result.success, true);
    assert.match(result.segmentWarning ?? '', /could not place them on the calendar/);
    assert.match(result.segmentWarning ?? '', /row level security/);
    assert.deepEqual(order, ['log', 'segment', 'push:true']);
});

test('hours-only entry writes no segment', async () => {
    const { store, order } = recordingStore();
    const result = await recordManualTimeLog(store, { hours: 1.5 }, {
        syncToBasecamp: true,
        waitForBasecampSync: true,
    });
    assert.equal(result.success, true);
    assert.deepEqual(order, ['log', 'push:true']);
});

test('skipping Basecamp does not push after the segment', async () => {
    const { store, order } = recordingStore();
    await recordManualTimeLog(store, { hours: 0.82 }, { workedWindow: window });
    assert.deepEqual(order, ['log', 'segment']);
});

function windowStore(overrides: Partial<WorkedWindowStore> = {}): {
    store: WorkedWindowStore;
    pushes: { id: string; createIfMissing: boolean }[];
    inserts: number;
} {
    const pushes: { id: string; createIfMissing: boolean }[] = [];
    let inserts = 0;
    const store: WorkedWindowStore = {
        async currentUserId() { return 'user-1'; },
        async getLog() {
            return { data: { id: 'log-1', organization_id: 'org-1', user_id: 'user-1' }, error: null };
        },
        async listSegments() { return { data: [], error: null }; },
        async insertSegment() {
            inserts += 1;
            return { error: null };
        },
        pushBasecamp(id, createIfMissing) { pushes.push({ id, createIfMissing }); },
        ...overrides,
    };
    return {
        store,
        pushes,
        get inserts() { return inserts; },
    };
}

test('back-fill inserts one closed segment and never calls Basecamp', async () => {
    const { store, pushes } = windowStore();
    const result = await attachWorkedWindow(store, 'log-1', window);
    assert.deepEqual(result, { success: true });
    assert.deepEqual(pushes, []);
});

test('back-fill refuses a log that already has segments and a log owned by someone else', async () => {
    const existing = windowStore({
        async listSegments() { return { data: [{ id: 'seg-1' }], error: null }; },
    });
    const refused = await attachWorkedWindow(existing.store, 'log-1', window);
    assert.equal(refused.success, false);
    assert.match(refused.error ?? '', /already has worked time/);
    assert.equal(existing.inserts, 0);
    assert.deepEqual(existing.pushes, []);

    const foreign = windowStore({
        async getLog() {
            return { data: { id: 'log-1', organization_id: 'org-1', user_id: 'other' }, error: null };
        },
    });
    const denied = await attachWorkedWindow(foreign.store, 'log-1', window);
    assert.equal(denied.success, false);
    assert.match(denied.error ?? '', /your own entry/);
    assert.equal(foreign.inserts, 0);
});

test('editing hours to match a new window updates in place and does not create a Basecamp entry', async () => {
    const calls: string[] = [];
    const result = await saveTimeLogEdit({
        async updateLog(_id, patch) {
            calls.push(`update:${patch.hours}`);
            return { success: true };
        },
        async attachWindow() {
            calls.push('attach');
            return { success: true };
        },
    }, {
        id: 'log-1',
        patch: {
            description: 'Outline',
            hours: 1.5,
            billable: true,
            date: '2026-07-15',
            sessionNotes: [],
        },
        workedWindow: { ...window, hours: 0.82 },
    });
    assert.equal(result.success, true);
    assert.equal(result.hours, 0.82);
    assert.equal(result.basecampCreateIfMissing, false);
    assert.deepEqual(calls, ['update:0.82', 'attach']);
});

test('a failed hours update does not insert a segment, and a failed segment keeps the new hours', async () => {
    const skipped = await saveTimeLogEdit({
        async updateLog() { return { success: false, error: 'denied' }; },
        async attachWindow() { throw new Error('segment insert should not run'); },
    }, {
        id: 'log-1',
        patch: {
            description: 'Outline', hours: 1.5, billable: true, date: '2026-07-15', sessionNotes: [],
        },
        workedWindow: { ...window, hours: 0.82 },
    });
    assert.equal(skipped.success, false);
    assert.equal(skipped.basecampCreateIfMissing, false);

    let attached = false;
    const warned = await saveTimeLogEdit({
        async updateLog() { return { success: true }; },
        async attachWindow() {
            attached = true;
            return { success: false, error: 'already has worked time' };
        },
    }, {
        id: 'log-1',
        patch: {
            description: 'Outline', hours: 1.5, billable: true, date: '2026-07-15', sessionNotes: [],
        },
        workedWindow: { ...window, hours: 0.82 },
    });
    assert.equal(attached, true);
    assert.equal(warned.success, true);
    assert.equal(warned.hours, 0.82);
    assert.equal(warned.basecampCreateIfMissing, false);
    assert.match(warned.segmentWarning ?? '', /could not place them on the calendar/);
});
