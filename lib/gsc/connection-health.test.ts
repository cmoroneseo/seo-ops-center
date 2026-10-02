import test from 'node:test';
import assert from 'node:assert/strict';
import { performanceHealth } from './connection-health.ts';
import type { PerformanceModel } from '../workspace-canvas/project.ts';

const model: PerformanceModel = {
    state: 'ready', message: '', lastSync: '2026-10-01T12:00:00Z', finalizedThrough: '2026-10-05',
    points: [{ date: '2026-10-05', clicks: null, previousDate: null, previousClicks: null }],
    showPrevious: false, observedDays: 0, expectedDays: 1, missingDays: 1,
};
const now = new Date('2026-10-08T12:00:00Z');
test('connection actions distinguish expired authorization from temporary failures', () => {
    assert.equal(performanceHealth({ ...model, connectionHealth: 'reconnect' }, now), 'reconnect');
    assert.equal(performanceHealth({ ...model, connectionHealth: 'interrupted' }, now), 'interrupted');
});
test('stale recent reports retain their data while historical reports avoid false warnings', () => {
    assert.equal(performanceHealth(model, now), 'stale');
    assert.equal(performanceHealth({ ...model, points: [{ ...model.points[0], date: '2026-08-31' }] }, now), null);
    assert.equal(performanceHealth({ ...model, lastSync: '2026-10-08T11:00:00Z' }, now), null);
    assert.equal(performanceHealth({ ...model, lastSync: null }, now), null);
    assert.equal(performanceHealth({ ...model, lastSync: 'invalid' }, now), null);
});
