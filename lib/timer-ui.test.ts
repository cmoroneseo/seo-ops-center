import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { TimerAttempt } from './types.ts';

const timerUi = await import('./timer-ui.ts').catch(() => null);

const quickStart = readFileSync(
    new URL('../components/timer/QuickStartPopover.tsx', import.meta.url),
    'utf8',
);
const notifications = readFileSync(
    new URL('../components/timer/TimerNotifications.tsx', import.meta.url),
    'utf8',
);
const timerProvider = readFileSync(
    new URL('../components/providers/timer-provider.tsx', import.meta.url),
    'utf8',
);
const plannerPage = readFileSync(
    new URL('../app/(dashboard)/planner/page.tsx', import.meta.url),
    'utf8',
);
const stopSheet = readFileSync(
    new URL('../components/timer/StopConfirmSheet.tsx', import.meta.url),
    'utf8',
);
const floatingTimer = readFileSync(
    new URL('../components/timer/FloatingTimer.tsx', import.meta.url),
    'utf8',
);

test('timer quick start loads current tasks for the selected client', () => {
    assert.match(quickStart, /getTasksByClient/);
    assert.match(quickStart, /getTasksByClient\(clientId\)/);
    assert.match(quickStart, /setTasks\(loaded\)/);
});

test('time reminders are positioned above the floating timer', () => {
    assert.match(notifications, /bottom-40 lg:bottom-24/);
});

test('timer task writebacks notify the open planner to refresh', () => {
    assert.match(timerProvider, /planner:data-changed/);
    assert.match(plannerPage, /addEventListener\('planner:data-changed', reload\)/);
    assert.match(plannerPage, /removeEventListener\('planner:data-changed', reload\)/);
});

test('a client timer cannot submit before Basecamp eligibility resolves', () => {
    assert.match(stopSheet, /isCheckingBasecamp/);
    assert.match(stopSheet, /disabled=\{isSubmitting \|\| isCheckingBasecamp \|\| !description\.trim\(\)\}/);
});

test('timer UI keeps one running attempt and a recoverable paused work queue', () => {
    assert.match(timerProvider, /runningTimer:\s*TimerAttempt \| null/);
    assert.match(timerProvider, /pausedTimers:\s*TimerAttempt\[\]/);
    assert.match(timerProvider, /getOpenTimerAttempts\(organization\.id\)/);
    assert.doesNotMatch(timerProvider, /\btimer:\s*(ActiveTimer|TimerAttempt)/);
});

test('canonical timer mutations refresh planner, timer, and client activity views', () => {
    assert.match(timerProvider, /planner:data-changed/);
    assert.match(timerProvider, /timer:data-changed/);
    assert.match(timerProvider, /client-activity:data-changed/);
});

test('starting or resuming a different attempt confirms an atomic server switch', () => {
    assert.match(timerProvider, /timerSwitchPrompt/);
    assert.match(timerProvider, /action:\s*'switch'/);
    assert.match(timerProvider, /startTask/);
    assert.match(timerProvider, /resume/);
});

test('timer switch prompt identifies both attempts without deriving browser state', () => {
    const attempt = { clientName: 'Northwind', taskTitle: 'Audit backlinks' } as TimerAttempt;
    assert.equal(
        timerUi?.timerSwitchPrompt(attempt, 'Update schema'),
        'Pause “Audit backlinks” and start “Update schema”?',
    );
});

test('floating timer lists paused work with resume and stop controls', () => {
    assert.match(floatingTimer, /Paused Work/);
    assert.match(floatingTimer, /pausedTimers/);
    assert.match(floatingTimer, />\s*Resume/);
    assert.match(floatingTimer, />\s*(\{attempt\.reviewingAt \? 'Review' : 'Stop'\}|Stop)/);
});
