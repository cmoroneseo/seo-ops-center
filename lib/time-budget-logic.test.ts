/**
 * Run with:  node --test lib/time-budget-logic.test.ts
 *
 * These mirror the three real planner scenarios:
 *   1. Carlos has an internal 1:1          — tracked, no client, no budget
 *   2. Carlos has a client meeting         — tracked, client, NOT budget
 *   3. Carlos does client task work        — tracked, client, YES budget
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    sumBudgetHoursByClient,
    sumTrackedHoursByClient,
    sumInternalHours,
    type BudgetableLog,
} from './time-budget-logic.ts';

const PIPE = 'client-pipe-it-right';
const VOLT = 'client-12-volt';

// One week of Carlos's time, covering all three scenarios.
const WEEK: BudgetableLog[] = [
    // 1. internal 1:1 — no client
    { hours: 0.5, countsTowardBudget: false },
    // 2. client meeting — tracked against Pipe It Right, excluded from budget
    { clientId: PIPE, hours: 1, countsTowardBudget: false },
    // 3. client task work — counts
    { clientId: PIPE, hours: 2, countsTowardBudget: true },
    { clientId: PIPE, hours: 1.5, countsTowardBudget: true },
    // a second client, task work only
    { clientId: VOLT, hours: 3, countsTowardBudget: true },
];

test('a client meeting does NOT consume the client SEO budget', () => {
    const budget = sumBudgetHoursByClient(WEEK);
    // 2 + 1.5 of task work. The 1h meeting is deliberately absent.
    assert.equal(budget[PIPE], 3.5);
});

test('the same client meeting IS still tracked against the client', () => {
    const tracked = sumTrackedHoursByClient(WEEK);
    // 1h meeting + 2 + 1.5 task work
    assert.equal(tracked[PIPE], 4.5);
});

test('tracked minus budget is exactly the non-budget time', () => {
    const tracked = sumTrackedHoursByClient(WEEK);
    const budget = sumBudgetHoursByClient(WEEK);
    assert.equal(Math.round((tracked[PIPE] - budget[PIPE]) * 100) / 100, 1);
});

test('internal work never lands on any client', () => {
    const budget = sumBudgetHoursByClient(WEEK);
    const tracked = sumTrackedHoursByClient(WEEK);
    // Only the two real clients appear, never an "undefined" bucket.
    assert.deepEqual(Object.keys(budget).sort(), [VOLT, PIPE].sort());
    assert.deepEqual(Object.keys(tracked).sort(), [VOLT, PIPE].sort());
    assert.equal(Object.keys(budget).includes('undefined'), false);
});

test('internal hours are still counted, just separately', () => {
    assert.equal(sumInternalHours(WEEK), 0.5);
});

test('a client with only meetings shows zero budget but non-zero tracked', () => {
    const logs: BudgetableLog[] = [
        { clientId: PIPE, hours: 1, countsTowardBudget: false },
        { clientId: PIPE, hours: 0.5, countsTowardBudget: false },
    ];
    assert.equal(sumBudgetHoursByClient(logs)[PIPE], undefined);
    assert.equal(sumTrackedHoursByClient(logs)[PIPE], 1.5);
});

test('fractional hours do not drift', () => {
    const logs: BudgetableLog[] = [
        { clientId: VOLT, hours: 0.1, countsTowardBudget: true },
        { clientId: VOLT, hours: 0.2, countsTowardBudget: true },
    ];
    // 0.1 + 0.2 is 0.30000000000000004 without rounding.
    assert.equal(sumBudgetHoursByClient(logs)[VOLT], 0.3);
});

test('empty input yields empty rollups, not a crash', () => {
    assert.deepEqual(sumBudgetHoursByClient([]), {});
    assert.deepEqual(sumTrackedHoursByClient([]), {});
    assert.equal(sumInternalHours([]), 0);
});
