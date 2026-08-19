import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
