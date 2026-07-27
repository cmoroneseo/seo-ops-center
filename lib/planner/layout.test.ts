import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PX_PER_HOUR,
    minutesToY,
    yToMinutes,
    snapMinutes,
    clampMinutes,
    packOverlaps,
    minutesSinceMidnight,
    durationMinutes,
} from './layout.ts';

// --- pixel <-> minute conversion -------------------------------------------

test('minutesToY places the grid start hour at y=0', () => {
    assert.equal(minutesToY(7 * 60, 7), 0);
});

test('minutesToY scales one hour to PX_PER_HOUR', () => {
    assert.equal(minutesToY(8 * 60, 7), PX_PER_HOUR);
});

test('minutesToY handles a half hour', () => {
    assert.equal(minutesToY(7 * 60 + 30, 7), PX_PER_HOUR / 2);
});

test('yToMinutes is the inverse of minutesToY', () => {
    for (const minutes of [420, 480, 555, 720, 1140]) {
        assert.equal(yToMinutes(minutesToY(minutes, 7), 7), minutes);
    }
});

// --- snapping ---------------------------------------------------------------

test('snapMinutes rounds to the nearest 15', () => {
    assert.equal(snapMinutes(7), 0);
    assert.equal(snapMinutes(8), 15);
    assert.equal(snapMinutes(22), 15);
    assert.equal(snapMinutes(23), 30);
    assert.equal(snapMinutes(60), 60);
});

test('clampMinutes keeps values inside a single day', () => {
    assert.equal(clampMinutes(-30), 0);
    assert.equal(clampMinutes(2000), 1440);
    assert.equal(clampMinutes(600), 600);
});

// --- ISO helpers ------------------------------------------------------------

test('minutesSinceMidnight reads local wall-clock time', () => {
    const iso = new Date(2026, 6, 27, 9, 30).toISOString();
    assert.equal(minutesSinceMidnight(iso), 9 * 60 + 30);
});

test('durationMinutes measures the gap between two ISO strings', () => {
    const start = new Date(2026, 6, 27, 9, 0).toISOString();
    const end = new Date(2026, 6, 27, 10, 30).toISOString();
    assert.equal(durationMinutes(start, end), 90);
});

// --- overlap packing --------------------------------------------------------

test('packOverlaps gives disjoint events the full width', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 660, endMin: 720 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 1], ['b', 0, 1]],
    );
});

test('packOverlaps splits two overlapping events into two columns', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 660 },
        { id: 'b', startMin: 600, endMin: 720 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 2], ['b', 1, 2]],
    );
});

test('packOverlaps splits a three-way overlap into three columns', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 720 },
        { id: 'b', startMin: 560, endMin: 700 },
        { id: 'c', startMin: 580, endMin: 680 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 3], ['b', 1, 3], ['c', 2, 3]],
    );
});

test('packOverlaps clusters transitively: A-B overlap, B-C overlap, A-C do not', () => {
    // A 9:00-10:00, B 9:45-11:00, C 10:30-11:30
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 585, endMin: 660 },
        { id: 'c', startMin: 630, endMin: 690 },
    ]);
    // All three share a cluster, so all report the same columnCount.
    assert.deepEqual(packed.map(p => p.columnCount), [2, 2, 2]);
    // A and C do not overlap, so C reuses A's column.
    const byId = Object.fromEntries(packed.map(p => [p.item.id, p.column]));
    assert.equal(byId.a, 0);
    assert.equal(byId.b, 1);
    assert.equal(byId.c, 0);
});

test('packOverlaps treats touching events as disjoint', () => {
    // A ends exactly when B starts.
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 600, endMin: 660 },
    ]);
    assert.deepEqual(packed.map(p => p.columnCount), [1, 1]);
});

test('packOverlaps handles identical start and end times', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 540, endMin: 600 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 2], ['b', 1, 2]],
    );
});

test('packOverlaps returns an empty array for no input', () => {
    assert.deepEqual(packOverlaps([]), []);
});
