import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DASHBOARD_WAVES_AFTER,
    DASHBOARD_WAVES_BEFORE,
    OVERVIEW_WAVES_AFTER,
    OVERVIEW_WAVES_BEFORE,
    loadOverviewParts,
    waveLatency,
} from './client-overview-load.ts';

const LATENCY_MS = 40;

test('overview parts run in one wave', async () => {
    let inFlight = 0;
    let peak = 0;
    const started = performance.now();
    const part = async (name: string) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, LATENCY_MS));
        inFlight -= 1;
        return name;
    };
    const [hours, fulfillment, tasks, plan, marketingPlan, changeLog] = await loadOverviewParts({
        hours: () => part('hours'),
        fulfillment: () => part('fulfillment'),
        tasks: () => part('tasks'),
        plan: () => part('plan'),
        marketingPlan: () => part('marketingPlan'),
        changeLog: () => part('changeLog'),
    });
    const elapsed = performance.now() - started;
    assert.deepEqual([hours, fulfillment, tasks, plan, marketingPlan, changeLog], [
        'hours', 'fulfillment', 'tasks', 'plan', 'marketingPlan', 'changeLog',
    ]);
    assert.equal(peak, 6);
    assert.ok(elapsed < LATENCY_MS * 2, `overview wave took ${elapsed.toFixed(1)}ms`);
});

test('overview and dashboard critical paths are shorter than the old waterfalls', async () => {
    const overviewBefore = await waveLatency(OVERVIEW_WAVES_BEFORE, LATENCY_MS);
    const overviewAfter = await waveLatency(OVERVIEW_WAVES_AFTER, LATENCY_MS);
    const dashboardBefore = await waveLatency(DASHBOARD_WAVES_BEFORE, LATENCY_MS);
    const dashboardAfter = await waveLatency(DASHBOARD_WAVES_AFTER, LATENCY_MS);
    assert.equal(OVERVIEW_WAVES_BEFORE.length, 3);
    assert.equal(OVERVIEW_WAVES_AFTER.length, 1);
    assert.equal(DASHBOARD_WAVES_BEFORE.length, 7);
    assert.equal(DASHBOARD_WAVES_AFTER.length, 2);
    assert.ok(overviewAfter < overviewBefore / 2, `overview ${overviewAfter.toFixed(1)}ms vs ${overviewBefore.toFixed(1)}ms`);
    assert.ok(dashboardAfter < dashboardBefore / 2, `dashboard ${dashboardAfter.toFixed(1)}ms vs ${dashboardBefore.toFixed(1)}ms`);
    console.log(JSON.stringify({
        latencyMs: LATENCY_MS,
        overviewBeforeMs: Math.round(overviewBefore),
        overviewAfterMs: Math.round(overviewAfter),
        dashboardBeforeMs: Math.round(dashboardBefore),
        dashboardAfterMs: Math.round(dashboardAfter),
    }));
});
