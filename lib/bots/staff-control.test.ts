import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { botTimerBasecampSummary } from './timer.ts';
import { botRequestDecision } from './scope.ts';
import { markDoneStopNote, parseStaffControl, staffControlOutcome, staffTimerRoleDecision } from './staff-control.ts';

const ID = '11111111-1111-4111-8111-111111111111';

test('staff control accepts pause, resume, and stop and refuses a duration', () => {
    const parsed = parseStaffControl({ action: 'stop', timeLogId: ID, description: 'Ready for review' });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.equal(parsed.input.action, 'stop');
        assert.equal(parsed.input.description, 'Ready for review');
    }
    assert.equal(parseStaffControl({ action: 'pause', timeLogId: ID, hours: 1 }).ok, false);
    assert.equal(parseStaffControl({ action: 'start', timeLogId: ID }).ok, false);
    assert.equal(parseStaffControl({ action: 'resume', timeLogId: 'not-an-id' }).ok, false);
});

test('only the organization owner may control a bot timer from the app', () => {
    assert.deepEqual(staffTimerRoleDecision('owner'), { ok: true });
    for (const role of ['admin', 'member', 'viewer', null, undefined]) {
        const decision = staffTimerRoleDecision(role);
        assert.equal(decision.ok, false);
        if (!decision.ok) {
            assert.equal(decision.status, 403);
            assert.equal(decision.code, 'forbidden');
        }
    }
    assert.equal(botRequestDecision({
        pathname: '/api/bots/timer/staff',
        method: 'POST',
        authorization: 'Bearer seo_bot_example',
    }), 'forbid');
    const route = readFileSync(new URL('../../app/api/bots/timer/staff/route.ts', import.meta.url), 'utf8');
    const decisionAt = route.indexOf('staffTimerRoleDecision(');
    const writeAt = route.indexOf('runBotTimerControl(');
    assert.equal(decisionAt > 0 && writeAt > decisionAt, true);
});

test('marking a task done does not invent a stop note', () => {
    assert.equal(markDoneStopNote(undefined), null);
    assert.equal(markDoneStopNote('   '), null);
    assert.equal(markDoneStopNote('Checked the brief'), 'Checked the brief');
    const summary = botTimerBasecampSummary({
        stretchNotes: ['Mapped the keyword set'],
        stopNote: markDoneStopNote(undefined),
        hours: 2,
        minutes: 120,
    });
    assert.equal(summary, 'Mapped the keyword set');
    assert.equal(/completed/i.test(summary), false);
    const source = readFileSync(new URL('../supabase/bot-timers.ts', import.meta.url), 'utf8');
    assert.match(source, /markDoneStopNote\(null\)/);
    assert.equal(source.includes("description: 'task completed'"), false);
    assert.equal(source.includes('description: "task completed"'), false);
});

test('a second stop is already stopped and a cap is not a normal log', () => {
    const stopped = staffControlOutcome(200, {
        alreadyStopped: true,
        timeLog: { status: 'logged' },
        basecamp: { status: 'skipped' },
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.alreadyStopped, true);
    assert.equal(stopped.phase, 'stopped');

    const capped = staffControlOutcome(200, { capped: true, timeLog: { status: 'needs_review' } });
    assert.equal(capped.capped, true);
    assert.equal(capped.phase, 'stopped');

    const missing = staffControlOutcome(404, { code: 'timer_not_running', error: 'This bot timer is not running or paused.' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'timer_not_running');
});
