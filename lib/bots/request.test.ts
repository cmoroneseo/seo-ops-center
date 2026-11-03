import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBotRequest } from './request.ts';
import { BOT_TASKS_PATH, BOT_TIMER_START_PATH, BOT_TIMER_STOP_PATH } from './scope.ts';

const NOW = new Date('2026-11-03T18:00:00.000Z');
const CLIENT = '33333333-3333-4333-8333-333333333333';
const PARENT = '66666666-6666-4666-8666-666666666666';

function parse(pathname: string, body: Record<string, unknown>) {
    return parseBotRequest(pathname, body, NOW);
}

test('task create accepts a parent with subtasks and rejects minute logging', () => {
    const parsed = parse(BOT_TASKS_PATH, {
        idempotencyKey: 'plan-august-blogs',
        clientName: 'Ecoworkz',
        taskTitle: 'August blogs',
        category: 'content',
        subtasks: [
            { title: 'Brief', category: 'content' },
            { title: 'Draft' },
        ],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.command.kind !== 'create') return;
    assert.equal(parsed.command.subtasks.length, 2);
    assert.equal(parsed.command.category, 'content');

    const minutes = parse(BOT_TIMER_START_PATH, {
        idempotencyKey: 'plan-august-blogs',
        clientId: CLIENT,
        taskTitle: 'Brief',
        minutes: 45,
    });
    assert.equal(minutes.ok, false);
    if (!minutes.ok) assert.equal(minutes.code, 'unknown_field');
});

test('a subtask under an existing parent is a create, and a timer cannot create', () => {
    const created = parse(BOT_TASKS_PATH, {
        idempotencyKey: 'plan-brief',
        clientId: CLIENT,
        parentTaskId: PARENT,
        parentTitle: 'August blogs',
        taskTitle: 'Brief',
    });
    assert.equal(created.ok, true);
    if (!created.ok || created.command.kind !== 'create') return;
    assert.equal(created.command.parentTaskId, PARENT);

    const timer = parse(BOT_TIMER_START_PATH, {
        idempotencyKey: 'plan-brief',
        clientId: CLIENT,
        taskTitle: 'Brief',
        createTask: true,
    });
    assert.equal(timer.ok, false);
    if (!timer.ok) assert.equal(timer.code, 'unknown_field');
});

test('stop accepts completion and rejects a future day', () => {
    const parsed = parse(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        complete: true,
        completedOn: '2026-11-02',
        timeZone: 'America/Los_Angeles',
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.command.kind !== 'stop') return;
    assert.equal(parsed.command.completedAt, '2026-11-02T20:00:00.000Z');

    const future = parse(BOT_TIMER_STOP_PATH, {
        idempotencyKey: 'stop-brief',
        complete: true,
        completedOn: '2026-11-04',
    });
    assert.equal(future.ok, false);
    if (!future.ok) assert.equal(future.code, 'completion_date');
});

test('a delete field is forbidden on every bot route', () => {
    for (const pathname of [BOT_TASKS_PATH, BOT_TIMER_START_PATH, BOT_TIMER_STOP_PATH]) {
        const parsed = parse(pathname, { idempotencyKey: 'not-allowed', delete: true });
        assert.equal(parsed.ok, false);
        if (!parsed.ok) assert.equal(parsed.code, 'forbidden');
    }
});

test('category rules match the app labels', () => {
    const technical = parse(BOT_TASKS_PATH, {
        idempotencyKey: 'labels-ok-1',
        clientId: CLIENT,
        taskTitle: 'Fixes',
        category: 'technical',
    });
    assert.equal(technical.ok, true);
    const huge = parse(BOT_TASKS_PATH, {
        idempotencyKey: 'labels-ok-1',
        clientId: CLIENT,
        taskTitle: 'Fixes',
        category: 'S'.repeat(81),
    });
    assert.equal(huge.ok, false);
    const broken = parse(BOT_TASKS_PATH, {
        idempotencyKey: 'labels-ok-1',
        clientId: CLIENT,
        taskTitle: 'Fixes',
        category: 'SEO\nPlan',
    });
    assert.equal(broken.ok, false);
});
