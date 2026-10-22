import assert from 'node:assert/strict';
import test from 'node:test';

import {
    attachRecordedCompletions,
    finishedOnAnnotation,
    type CompletionActivityEvent,
    type TaskCompletionRecord,
} from './completion-annotation.ts';

const ZONE = 'America/Los_Angeles';
/** Oct 21, 2026, 9:02 PM Pacific — the evening the feed row was written. */
const LOGGED = '2026-10-22T04:02:00.000Z';
/** Sep 30, 2026, noon Pacific — the day the person said the work was finished. */
const SEPTEMBER = '2026-09-30T19:00:00.000Z';
const NOW = new Date('2026-10-22T04:02:00.000Z');

function event(overrides: Partial<CompletionActivityEvent> = {}): CompletionActivityEvent {
    return {
        id: 'event-1',
        eventType: 'task.completed',
        occurredAt: LOGGED,
        metadata: { taskId: 'task-1', title: 'September SEO Content' },
        ...overrides,
    };
}

function record(overrides: Partial<TaskCompletionRecord> = {}): TaskCompletionRecord {
    return {
        status: 'done',
        completedAt: SEPTEMBER,
        statusHistory: [{ status: 'done', at: SEPTEMBER }],
        ...overrides,
    };
}

test('a completion logged on the finish day is not annotated', () => {
    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: '2026-10-22T01:15:00.000Z',
        timeZone: ZONE,
        now: NOW,
    }), null);

    // 11:30 PM Pacific on Oct 21 is already Oct 22 in UTC. Both instants are
    // still Oct 21 in the overview's Pacific day, so the row stays plain.
    assert.equal(finishedOnAnnotation({
        occurredAt: '2026-10-22T06:30:00.000Z',
        completedAt: '2026-10-21T20:00:00.000Z',
        timeZone: ZONE,
        now: NOW,
    }), null);

    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: null,
        timeZone: ZONE,
        now: NOW,
    }), null);
});

test('a backdated completion names the finish day without moving the feed row', () => {
    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: SEPTEMBER,
        timeZone: ZONE,
        now: NOW,
    }), 'finished Sep 30');
});

test('a finish in another year includes the year', () => {
    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: '2025-12-15T20:00:00.000Z',
        timeZone: ZONE,
        now: NOW,
    }), 'finished Dec 15, 2025');

    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: SEPTEMBER,
        timeZone: ZONE,
        now: new Date('2027-01-04T20:00:00.000Z'),
    }), 'finished Sep 30, 2026');
});

test('a reopened task keeps the finish day from status history', () => {
    const events = [event()];
    const reopened: TaskCompletionRecord = {
        status: 'todo',
        completedAt: null,
        statusHistory: [
            { status: 'in_progress', at: '2026-09-20T17:00:00.000Z' },
            { status: 'done', at: SEPTEMBER },
            { status: 'todo', at: '2026-10-22T16:00:00.000Z' },
        ],
    };
    const [attached] = attachRecordedCompletions(events, new Map([['task-1', reopened]]));
    assert.equal(attached.metadata.completedAt, SEPTEMBER);
    assert.equal(finishedOnAnnotation({
        occurredAt: attached.occurredAt,
        completedAt: String(attached.metadata.completedAt),
        timeZone: ZONE,
        now: NOW,
    }), 'finished Sep 30');

    // Completing it again must not relabel the earlier feed row.
    const again = '2026-10-05T19:00:00.000Z';
    const first = event({ id: 'first' });
    const second = event({ id: 'second', occurredAt: '2026-10-23T17:00:00.000Z' });
    const redone = record({
        status: 'done',
        completedAt: again,
        statusHistory: [
            { status: 'done', at: SEPTEMBER },
            { status: 'todo', at: '2026-10-22T16:00:00.000Z' },
            { status: 'done', at: again },
        ],
    });
    const stamped = attachRecordedCompletions([second, first], new Map([['task-1', redone]]));
    const byId = new Map(stamped.map(item => [item.id, item.metadata.completedAt]));
    assert.equal(byId.get('first'), SEPTEMBER);
    assert.equal(byId.get('second'), again);
    assert.equal(finishedOnAnnotation({
        occurredAt: first.occurredAt,
        completedAt: String(byId.get('first')),
        timeZone: ZONE,
        now: NOW,
    }), 'finished Sep 30');
});

test('an event that already carries the finish instant is left on that instant', () => {
    const carried = event({ metadata: { taskId: 'task-1', completedAt: SEPTEMBER } });
    const [attached] = attachRecordedCompletions(
        [carried],
        new Map([['task-1', record({ completedAt: '2026-10-05T19:00:00.000Z', statusHistory: [] })]]),
    );
    assert.equal(attached, carried);
    assert.equal(attached.metadata.completedAt, SEPTEMBER);
});

test('a still-done task uses completed_at when the feed event has no finish instant', () => {
    const [attached] = attachRecordedCompletions(
        [event({ metadata: { taskId: 'task-1', title: 'September SEO Content' } })],
        new Map([['task-1', record()]]),
    );
    assert.equal(attached.metadata.completedAt, SEPTEMBER);
    assert.equal(finishedOnAnnotation({
        occurredAt: LOGGED,
        completedAt: String(attached.metadata.completedAt),
        timeZone: ZONE,
        now: NOW,
    }), 'finished Sep 30');
});
