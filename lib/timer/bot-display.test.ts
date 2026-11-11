import assert from 'node:assert/strict';
import test from 'node:test';

import {
    botBadgeLabel,
    botTimerDeleteMessage,
    formatOpenTaskHours,
    botTimerElapsedSeconds,
    botTimerFromRow,
    botTimerHours,
    planRowWithBotTimer,
    rowTimerClick,
    taskHoursWithBotTimers,
    type BotTimerClock,
} from './bot-display.ts';

const START = '2026-11-03T18:00:00.000Z';
const PAUSE = '2026-11-03T18:20:00.000Z';
const RESUME = '2026-11-03T18:35:00.000Z';
const NOW = new Date('2026-11-03T18:40:00.000Z');

function clock(patch: Partial<BotTimerClock> = {}): BotTimerClock {
    return {
        id: 'bot-1',
        taskId: 'task-1',
        taskTitle: 'Fixture — August brief',
        botKeyId: 'key-1',
        botName: 'seo-manager',
        phase: 'running',
        openStartedAt: START,
        stretches: [],
        billable: true,
        countsTowardBudget: true,
        ...patch,
    };
}

test('elapsed time adds closed stretches and the open stretch, and skips the pause gap', () => {
    const running = clock({
        openStartedAt: RESUME,
        stretches: [{ startedAt: START, endedAt: PAUSE }],
    });
    assert.equal(botTimerElapsedSeconds(running, NOW), 20 * 60 + 5 * 60);
    const paused = clock({
        phase: 'paused',
        openStartedAt: null,
        stretches: [{ startedAt: START, endedAt: PAUSE }],
    });
    assert.equal(botTimerElapsedSeconds(paused, NOW), 20 * 60);
    assert.equal(botTimerHours(running, NOW), 0.42);
});

test('a fresh running timer with no stretches counts from its start', () => {
    const running = clock({ openStartedAt: START });
    assert.equal(botTimerElapsedSeconds(running, new Date('2026-11-03T18:00:05.000Z')), 5);
    assert.equal(botTimerElapsedSeconds(running, new Date('2026-11-03T17:59:00.000Z')), 0);
});

test('a short open bot timer is shown in minutes, not as 0.0h', () => {
    assert.equal(formatOpenTaskHours(0), '0h');
    assert.equal(formatOpenTaskHours(125 / 3600), '2m');
    assert.equal(formatOpenTaskHours(1.5), '1.5h');
});

test('task total adds live bot time on top of logged hours and does not double count', () => {
    const running = clock({ openStartedAt: START });
    const paused = clock({
        id: 'bot-2',
        phase: 'paused',
        openStartedAt: null,
        stretches: [{ startedAt: START, endedAt: PAUSE }],
    });
    assert.equal(taskHoursWithBotTimers(1.5, [running, paused], new Date('2026-11-03T19:00:00.000Z')), 2.83);
    assert.equal(taskHoursWithBotTimers(0, [], NOW), 0);
});

test('the row shows the bot clock when Carlos has no timer on that task', () => {
    const bot = clock();
    const view = planRowWithBotTimer(
        { phase: 'idle', seconds: 0 },
        [bot],
        () => 90,
    );
    assert.equal(view.phase, 'running');
    assert.equal(view.seconds, 90);
    assert.equal(view.owner, 'bot');
    assert.equal(view.botLabel, 'seo-manager bot');
    assert.deepEqual(rowTimerClick(view), { action: 'pause-bot', botTimerId: 'bot-1' });
});

test('his own timer keeps the play button when a bot is also on the task', () => {
    const view = planRowWithBotTimer(
        { phase: 'running', seconds: 40 },
        [clock()],
        () => 90,
    );
    assert.equal(view.owner, 'human');
    assert.equal(view.seconds, 40);
    assert.deepEqual(view.extraBotLabels, ['seo-manager bot']);
    assert.deepEqual(rowTimerClick(view), { action: 'human' });
});

test('two bots on one idle task: the running one owns the row and the other is labelled', () => {
    const view = planRowWithBotTimer(
        { phase: 'idle', seconds: 0 },
        [
            clock({ id: 'paused', phase: 'paused', openStartedAt: null, botName: 'technical-seo' }),
            clock({ id: 'running', botName: 'seo-manager' }),
        ],
        timer => timer.id === 'running' ? 12 : 40,
    );
    assert.equal(view.botTimerId, 'running');
    assert.equal(view.botLabel, 'seo-manager bot');
    assert.deepEqual(view.extraBotLabels, ['technical-seo bot']);
    assert.deepEqual(rowTimerClick({ ...view, phase: 'paused' }), { action: 'resume-bot', botTimerId: 'running' });
});

test('badge and delete copy name the bot', () => {
    assert.equal(botBadgeLabel('seo-manager'), 'seo-manager bot');
    assert.equal(botBadgeLabel('SEO Manager Bot'), 'SEO Manager Bot');
    assert.equal(botBadgeLabel('  '), 'bot');
    assert.equal(
        botTimerDeleteMessage(['seo-manager']),
        'Stop the seo-manager bot timer before deleting this task.',
    );
    assert.match(botTimerDeleteMessage(['seo-manager', 'technical-seo']), /seo-manager bot and technical-seo bot/);
});

test('a database row becomes a clock without treating an open segment as bot time', () => {
    const timer = botTimerFromRow({
        id: 'log-1',
        task_id: 'task-1',
        client_id: 'client-1',
        bot_key_id: 'key-1',
        status: 'in_progress',
        timer_started_at: RESUME,
        billable: true,
        counts_toward_budget: false,
        tasks: { title: 'Fixture — August brief' },
        clients: { name: 'Fixture Client (not real)' },
        bot_api_keys: { name: 'seo-manager' },
        time_log_segments: [
            { started_at: START, ended_at: PAUSE, note: 'Mapped the keyword set' },
            { started_at: RESUME, ended_at: null },
        ],
    });
    assert.ok(timer);
    assert.equal(timer?.phase, 'running');
    assert.equal(timer?.openStartedAt, RESUME);
    assert.equal(timer?.stretches.length, 1);
    assert.equal(timer?.botName, 'seo-manager');
    assert.equal(timer?.countsTowardBudget, false);
    assert.equal(botTimerFromRow({ id: 'human', task_id: 'task-1', status: 'in_progress', timer_started_at: START }), null);
    assert.equal(botTimerFromRow({
        id: 'closed',
        task_id: 'task-1',
        bot_key_id: 'key-1',
        status: 'logged',
        timer_started_at: null,
    }), null);
});
