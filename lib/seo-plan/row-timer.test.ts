import assert from 'node:assert/strict';
import test from 'node:test';

import type { TimerAttempt } from '../types.ts';
import {
    clickPlanRowTimer,
    planTimerNotice,
    closePlanStopReview,
    formatPlanClock,
    openPlanStopReview,
    planChooseTaskClass,
    planRowTimeText,
    planRowTimerSwitch,
    planRowTimerView,
    planTimerTask,
    tracksOnParentLabel,
    type PlanTimerControls,
} from './row-timer.ts';

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1',
        organizationId: 'org-1',
        userId: 'user-1',
        date: '2026-10-20',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 0,
        sessionNotes: [],
        segments: [],
        ...overrides,
    };
}

function controls(partial: Partial<PlanTimerControls> = {}): PlanTimerControls & {
    starts: unknown[];
    pauses: string[];
    resumes: unknown[];
    stops: string[];
} {
    const starts: unknown[] = [];
    const pauses: string[] = [];
    const resumes: unknown[] = [];
    const stops: string[] = [];
    return {
        starts,
        pauses,
        resumes,
        stops,
        startTask: async (options, confirmSwitch) => {
            starts.push({ options, allowed: await confirmSwitch?.('Pause and switch?') });
            return partial.startTask ? partial.startTask(options, confirmSwitch) : true;
        },
        pause: async (item) => {
            pauses.push(item.id);
            await partial.pause?.(item);
        },
        resume: async (item, confirmSwitch, options) => {
            resumes.push({ id: item.id, allowed: await confirmSwitch?.('switch'), options });
            return partial.resume ? partial.resume(item, confirmSwitch, options) : true;
        },
        beginStop: async (item) => {
            stops.push(item.id);
            return partial.beginStop?.(item);
        },
    };
}

test('the plan switch confirmation never asks the browser', () => {
    let prompts = 0;
    const original = globalThis.confirm;
    globalThis.confirm = () => {
        prompts += 1;
        return false;
    };
    try {
        assert.equal(planRowTimerSwitch('Pause “A” and start “B”?'), true);
        assert.equal(prompts, 0);
    } finally {
        globalThis.confirm = original;
    }
});

test('a row clock is the open attempt, and logged time stays on idle rows', () => {
    assert.equal(formatPlanClock(487), '8:07');
    assert.equal(formatPlanClock(125), '2:05');
    assert.equal(formatPlanClock(3661), '1:01:01');

    const running = attempt({ id: 'run', taskId: 'bravo', timerStartedAt: '2026-10-20T15:00:00.000Z' });
    const paused = attempt({ id: 'pause', taskId: 'alpha', elapsedSeconds: 487 });
    const elapsed = (item: TimerAttempt) => item.id === 'run' ? 125 : item.elapsedSeconds;

    assert.deepEqual(planRowTimerView('bravo', running, [paused], elapsed), { phase: 'running', seconds: 125 });
    assert.equal(planRowTimeText({ phase: 'running', seconds: 125 }, '1.5h'), '2:05');
    assert.equal(planRowTimeText(planRowTimerView('alpha', running, [paused], elapsed), '45m'), '❙❙ 8:07');
    assert.equal(planRowTimeText(planRowTimerView('other', running, [paused], elapsed), '0h'), '0h');
});

test('starting another row switches through the non-blocking confirm and promotes a to-do', async () => {
    const running = attempt({ id: 'run', taskId: 'alpha', taskTitle: 'Alpha', timerStartedAt: '2026-10-20T15:00:00.000Z' });
    const api = controls();
    const result = await clickPlanRowTimer({
        taskId: 'bravo',
        taskTitle: 'Bravo',
        taskStatus: 'todo',
        clientId: 'client-1',
        clientName: 'Maya',
        running,
        paused: [],
        controls: api,
    });

    assert.deepEqual(result, { action: 'start', ok: true, promoted: true });
    assert.equal(api.pauses.length, 0);
    assert.deepEqual(api.starts, [{
        options: { clientId: 'client-1', clientName: 'Maya', taskId: 'bravo', taskTitle: 'Bravo' },
        allowed: true,
    }]);
});

test('a declined start does not promote, and an in-progress task is not promoted again', async () => {
    const declined = await clickPlanRowTimer({
        taskId: 'bravo',
        taskTitle: 'Bravo',
        taskStatus: 'todo',
        clientId: 'client-1',
        clientName: 'Maya',
        running: null,
        paused: [],
        controls: controls({ startTask: async () => false }),
    });
    assert.deepEqual(declined, { action: 'start', ok: false, promoted: false });

    const already = await clickPlanRowTimer({
        taskId: 'bravo',
        taskTitle: 'Bravo',
        taskStatus: 'in_progress',
        clientId: 'client-1',
        clientName: 'Maya',
        running: null,
        paused: [],
        controls: controls(),
    });
    assert.equal(already.action === 'start' && already.promoted, false);
});

test('the running row pauses, and a paused row resumes without a browser confirm', async () => {
    const running = attempt({ id: 'run', taskId: 'alpha', timerStartedAt: '2026-10-20T15:00:00.000Z' });
    const paused = attempt({ id: 'pause', taskId: 'bravo' });
    const pausing = controls();
    assert.deepEqual(await clickPlanRowTimer({
        taskId: 'alpha',
        taskTitle: 'Alpha',
        taskStatus: 'in_progress',
        clientId: 'client-1',
        clientName: 'Maya',
        running,
        paused: [paused],
        controls: pausing,
    }), { action: 'pause' });
    assert.deepEqual(pausing.pauses, ['run']);

    const resuming = controls();
    assert.deepEqual(await clickPlanRowTimer({
        taskId: 'bravo',
        taskTitle: 'Bravo',
        taskStatus: 'in_progress',
        clientId: 'client-1',
        clientName: 'Maya',
        running,
        paused: [paused],
        controls: resuming,
    }), { action: 'resume', ok: true });
    assert.deepEqual(resuming.resumes, [{ id: 'pause', allowed: true, options: undefined }]);
    assert.equal(resuming.starts.length, 0);
});

test('checking a running row opens stop review with mark-complete, and cancel resumes it', async () => {
    const running = attempt({ id: 'run', taskId: 'alpha', timerStartedAt: '2026-10-20T15:00:00.000Z' });
    const opened = await openPlanStopReview({
        taskId: 'alpha',
        running,
        beginStop: async () => undefined,
    });
    assert.deepEqual(opened, { attemptId: 'run', markTaskComplete: true });

    const idle = await openPlanStopReview({
        taskId: 'bravo',
        running,
        beginStop: async () => { throw new Error('should not stop'); },
    });
    assert.equal(idle, null);

    const reviewing = attempt({ id: 'run', taskId: 'alpha', reviewingAt: '2026-10-20T15:08:00.000Z' });
    const api = controls();
    assert.equal(await closePlanStopReview({ attempt: reviewing, resume: api.resume }), 'resumed');
    assert.deepEqual(api.resumes, [{ id: 'run', allowed: true, options: { continueReview: true } }]);

    assert.equal(await closePlanStopReview({ attempt: null, resume: api.resume }), 'settled');
    assert.equal(api.resumes.length, 1);
});

test('a row play that finds an open entry explains the resume or the review', () => {
    assert.equal(planTimerNotice({ action: 'resume', ok: true }), 'Resumed the paused timer on this task.');
    assert.equal(planTimerNotice({ action: 'noop' }), 'This timer is in review. Finish or discard it from the timer widget.');
    assert.equal(planTimerNotice({ action: 'pause' }), null);
    assert.equal(planTimerNotice({ action: 'start', ok: true, promoted: false }), null);
    assert.equal(planTimerNotice({ action: 'resume', ok: false }), null);
});

test('Choose Task is a ghost button on the plan and stays the primary elsewhere', () => {
    assert.match(planChooseTaskClass(true, false), /bg-transparent/);
    assert.doesNotMatch(planChooseTaskClass(true, false), /green/);
    assert.match(planChooseTaskClass(false, false), /green-500/);
    assert.match(planChooseTaskClass(true, true), /amber/);
});

test('a subtask play button tracks time on its parent and says so', () => {
    const parent = { title: 'SEO Setup' };
    const subtask = planTimerTask({
        id: 'chore',
        title: 'Submit sitemap',
        parentTaskId: 'pillar',
    }, parent);
    assert.deepEqual(subtask, {
        taskId: 'pillar',
        label: 'Tracks time on SEO Setup',
        parentTitle: 'SEO Setup',
    });
    assert.equal(tracksOnParentLabel('SEO Setup'), subtask.label);

    const own = planTimerTask({ id: 'pillar', title: 'SEO Setup' }, null);
    assert.deepEqual(own, { taskId: 'pillar', label: null, parentTitle: null });

    const successor = planTimerTask({
        id: 'next-week',
        title: 'SEO Setup',
        parentTaskId: 'pillar',
        recurring: true,
    }, parent);
    assert.deepEqual(successor, { taskId: 'next-week', label: null, parentTitle: null });
});

test('a subtask with no loaded parent still names the parent task', () => {
    const tracked = planTimerTask({
        id: 'chore',
        title: 'Submit sitemap',
        parentTaskId: 'pillar',
    }, null);
    assert.equal(tracked.taskId, 'pillar');
    assert.equal(tracked.label, 'Tracks time on the parent task');
    assert.equal(tracked.parentTitle, 'the parent task');
});
