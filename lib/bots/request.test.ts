import assert from 'node:assert/strict';
import test from 'node:test';

import { parseBotRequest } from './request.ts';
import { BOT_TASKS_COMPLETE_PATH, BOT_TASKS_PATH, BOT_TIMER_PAUSE_PATH, BOT_TIMER_RESUME_PATH, BOT_TIMER_START_PATH, BOT_TIMER_STOP_PATH } from './scope.ts';

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

test('create trims descriptions, omits empty descriptions, and hashes supplied descriptions', () => {
    const body = { idempotencyKey: 'create-described', clientId: CLIENT, taskTitle: 'Audit' };
    const described = parse(BOT_TASKS_PATH, {
        ...body, description: ' Review the URLs. ', subtasks: [{ title: 'Draft', description: ' Write up findings.\n' }],
    });
    const otherTask = parse(BOT_TASKS_PATH, {
        ...body, description: 'Review the redirects.', subtasks: [{ title: 'Draft', description: 'Write up findings.' }],
    });
    const otherChild = parse(BOT_TASKS_PATH, {
        ...body, description: 'Review the URLs.', subtasks: [{ title: 'Draft', description: 'Record findings.' }],
    });
    assert.ok(described.ok && described.command.kind === 'create' && otherTask.ok && otherChild.ok);
    assert.equal(described.command.description, 'Review the URLs.');
    assert.equal(described.command.subtasks[0].description, 'Write up findings.');
    assert.notEqual(described.command.requestHash, otherTask.command.requestHash);
    assert.notEqual(described.command.requestHash, otherChild.command.requestHash);

    const empty = parse(BOT_TASKS_PATH, {
        ...body, description: '  ', subtasks: [{ title: 'Draft', description: '' }],
    });
    const omitted = parse(BOT_TASKS_PATH, { ...body, subtasks: [{ title: 'Draft' }] });
    assert.ok(empty.ok && omitted.ok);
    assert.deepEqual(empty.command, omitted.command);
});

test('create descriptions must be text within the description limit', () => {
    const body = { idempotencyKey: 'create-described', clientId: CLIENT, taskTitle: 'Audit' };
    for (const description of [42, null, 'x'.repeat(5001)]) {
        for (const fields of [{ description }, { subtasks: [{ title: 'Draft', description }] }]) {
            const parsed = parse(BOT_TASKS_PATH, { ...body, ...fields });
            assert.ok(!parsed.ok);
            assert.equal(parsed.code, 'invalid_request');
        }
    }
    assert.ok(parse(BOT_TASKS_PATH, { ...body, description: 'x'.repeat(5000) }).ok);
});

test('standalone completion validates the task and date and hashes the request independently of the clock', () => {
    const body = { idempotencyKey: 'complete-audit', taskId: PARENT };
    const first = parse(BOT_TASKS_COMPLETE_PATH, body);
    const retry = parseBotRequest(BOT_TASKS_COMPLETE_PATH, body, new Date(NOW.getTime() + 1000));
    const dated = parse(BOT_TASKS_COMPLETE_PATH, { ...body, completedOn: '2026-11-02', timeZone: 'America/New_York' });
    assert.ok(first.ok && first.command.kind === 'complete' && retry.ok && dated.ok && dated.command.kind === 'complete');
    assert.equal(first.command.completedAt, NOW.toISOString());
    assert.equal(first.command.requestHash, retry.command.requestHash);
    assert.equal(dated.command.completedAt, '2026-11-02T17:00:00.000Z');
    assert.notEqual(first.command.requestHash, dated.command.requestHash);

    for (const [fields, code] of [
        [{ taskId: undefined }, 'invalid_request'],
        [{ taskId: 'invalid' }, 'invalid_request'],
        [{ completedOn: '2026-11-04' }, 'completion_date'],
        [{ completedOn: '2026-10-99' }, 'completion_date'],
        [{ completedOn: 2 }, 'completion_date'],
        [{ timeZone: 'Mars/Olympus' }, 'invalid_request'],
        [{ description: 'extra' }, 'unknown_field'],
    ] as const) {
        const invalid = parse(BOT_TASKS_COMPLETE_PATH, { ...body, ...fields });
        assert.ok(!invalid.ok);
        assert.equal(invalid.code, code);
    }
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

test('basecampTodoId is normalized and participates in the create request hash', () => {
    const body = { idempotencyKey: 'link-basecamp-todo', clientId: CLIENT };
    const number = parse(BOT_TASKS_PATH, { ...body, basecampTodoId: 77 });
    const string = parse(BOT_TASKS_PATH, { ...body, basecampTodoId: ' 0077 ' });
    const different = parse(BOT_TASKS_PATH, { ...body, basecampTodoId: 78 });
    assert.ok(number.ok && number.command.kind === 'create' && string.ok && different.ok);
    assert.equal(number.command.basecampTodoId, '77');
    assert.equal(number.command.taskTitle, undefined);
    assert.equal(number.command.requestHash, string.command.requestHash);
    assert.notEqual(number.command.requestHash, different.command.requestHash);

    const timer = parse(BOT_TIMER_START_PATH, { ...body, taskTitle: 'Brief', basecampTodoId: 77 });
    assert.ok(!timer.ok);
    assert.equal(timer.code, 'unknown_field');
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
    for (const pathname of [BOT_TASKS_PATH, BOT_TASKS_COMPLETE_PATH, BOT_TIMER_START_PATH, BOT_TIMER_PAUSE_PATH, BOT_TIMER_RESUME_PATH, BOT_TIMER_STOP_PATH]) {
        const parsed = parse(pathname, { idempotencyKey: 'not-allowed', delete: true });
        assert.equal(parsed.ok, false);
        if (!parsed.ok) assert.equal(parsed.code, 'forbidden');
    }
});

test('pause and resume accept a note and reject unknown fields', () => {
    const pause = parse(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-brief',
        description: 'Checked the top ten',
    });
    assert.equal(pause.ok, true);
    if (!pause.ok || pause.command.kind !== 'pause') return;
    assert.equal(pause.command.description, 'Checked the top ten');

    const resume = parse(BOT_TIMER_RESUME_PATH, {
        idempotencyKey: 'resume-brief',
        taskId: PARENT,
        description: 'Drafted the brief',
    });
    assert.equal(resume.ok, true);
    if (!resume.ok || resume.command.kind !== 'resume') return;
    assert.equal(resume.command.taskId, PARENT);

    const missing = parse(BOT_TIMER_RESUME_PATH, { idempotencyKey: 'resume-brief' });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, 'invalid_request');

    const unknown = parse(BOT_TIMER_PAUSE_PATH, {
        idempotencyKey: 'pause-brief',
        hours: 1,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.code, 'unknown_field');
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

test('stop accepts positive numeric hours and includes them in the request hash', () => {
    const payload = { idempotencyKey: 'stop-with-trim' };
    const original = parse(BOT_TIMER_STOP_PATH, payload);
    const trimmed = parse(BOT_TIMER_STOP_PATH, { ...payload, hours: 0.25 });
    assert.ok(original.ok && trimmed.ok && trimmed.command.kind === 'stop');
    assert.equal(trimmed.command.hours, 0.25);
    assert.notEqual(original.command.requestHash, trimmed.command.requestHash);
    for (const hours of [0, -1, '0.25', null]) {
        const result = parse(BOT_TIMER_STOP_PATH, { ...payload, hours });
        assert.ok(!result.ok);
        assert.equal(result.code, 'invalid_request');
    }
});

test('a trimmed stop with implicit completion time hashes the same on retry', () => {
    const payload = { idempotencyKey: 'stop-complete-with-trim', hours: 0.25, complete: true };
    const original = parseBotRequest(BOT_TIMER_STOP_PATH, payload, new Date('2026-11-03T15:00:00Z'));
    const retry = parseBotRequest(BOT_TIMER_STOP_PATH, payload, new Date('2026-11-03T15:05:00Z'));
    assert.ok(original.ok && retry.ok);
    assert.equal(retry.command.requestHash, original.command.requestHash);
});
