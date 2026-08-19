import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PX_PER_HOUR,
    AXIS_WIDTH,
    minutesToY,
    yToMinutes,
    snapMinutes,
    clampMinutes,
    packOverlaps,
    minutesSinceMidnight,
    durationMinutes,
    resolvePointer,
    resolveSchedulePointer,
    shouldCommitSchedule,
    isOutsideGrid,
    staggerBounds,
    isWorkMinute,
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

// --- overlap stagger --------------------------------------------------------

test('staggerBounds gives a lone card the full width', () => {
    assert.deepEqual(staggerBounds(0, 1), { leftPct: 0, widthPct: 100, zIndex: 10 });
});

test('staggerBounds indents the second card and runs it to the right edge', () => {
    // The first card keeps its title visible on the left; the second layers over it.
    assert.deepEqual(staggerBounds(0, 2), { leftPct: 0, widthPct: 100, zIndex: 10 });
    assert.deepEqual(staggerBounds(1, 2), { leftPct: 50, widthPct: 50, zIndex: 11 });
});

test('staggerBounds stacks a three-way overlap with rising z-index', () => {
    const bounds = [0, 1, 2].map(c => staggerBounds(c, 3));
    assert.deepEqual(bounds.map(b => b.zIndex), [10, 11, 12]);
    // Each starts further right and still reaches the edge.
    assert.equal(bounds[0].leftPct + bounds[0].widthPct, 100);
    assert.equal(bounds[1].leftPct + bounds[1].widthPct, 100);
    assert.equal(bounds[2].leftPct + bounds[2].widthPct, 100);
    assert.ok(bounds[0].leftPct < bounds[1].leftPct);
    assert.ok(bounds[1].leftPct < bounds[2].leftPct);
});

test('staggerBounds survives a zero columnCount rather than dividing by zero', () => {
    assert.equal(staggerBounds(0, 0).widthPct, 100);
});

// --- working hours ----------------------------------------------------------

test('isWorkMinute covers the working day and excludes its end boundary', () => {
    assert.equal(isWorkMinute(9 * 60, 9, 17), true);
    assert.equal(isWorkMinute(12 * 60, 9, 17), true);
    assert.equal(isWorkMinute(16 * 60 + 59, 9, 17), true);
    assert.equal(isWorkMinute(17 * 60, 9, 17), false);
    assert.equal(isWorkMinute(8 * 60 + 59, 9, 17), false);
});

// --- pointer resolution -----------------------------------------------------
// A 7-column grid 1164px wide: 64px axis + 7 columns of 157.14px.
const RECT = { left: 100, top: 200, width: AXIS_WIDTH + 7 * 160 };
const base = { rect: RECT, scrollTop: 0, dayCount: 7, startHour: 7 };

test('resolvePointer maps the first column to day 0', () => {
    const at = resolvePointer({ ...base, clientX: RECT.left + AXIS_WIDTH + 5, clientY: RECT.top });
    assert.equal(at.dayIndex, 0);
});

test('resolvePointer maps the fifth column to day 4', () => {
    const at = resolvePointer({ ...base, clientX: RECT.left + AXIS_WIDTH + 4 * 160 + 80, clientY: RECT.top });
    assert.equal(at.dayIndex, 4);
});

test('resolvePointer clamps a pointer in the axis gutter to day 0', () => {
    const at = resolvePointer({ ...base, clientX: RECT.left + 10, clientY: RECT.top });
    assert.equal(at.dayIndex, 0);
});

test('resolvePointer clamps past the last column to the last day', () => {
    const at = resolvePointer({ ...base, clientX: RECT.left + 99999, clientY: RECT.top });
    assert.equal(at.dayIndex, 6);
});

test('resolvePointer converts y to the snapped wall-clock minute', () => {
    // One hour below the top of a grid starting at 7am -> 8:00.
    const at = resolvePointer({
        ...base,
        clientX: RECT.left + AXIS_WIDTH + 5,
        clientY: RECT.top + PX_PER_HOUR,
    });
    assert.equal(at.minutes, 8 * 60);
});

test('resolvePointer accounts for scroll position', () => {
    const at = resolvePointer({
        ...base,
        clientX: RECT.left + AXIS_WIDTH + 5,
        clientY: RECT.top,
        scrollTop: PX_PER_HOUR * 2,
    });
    assert.equal(at.minutes, 9 * 60);
});

test('resolvePointer snaps to the nearest 15 minutes', () => {
    // 20 minutes past 7am in px -> snaps to 7:15.
    const at = resolvePointer({
        ...base,
        clientX: RECT.left + AXIS_WIDTH + 5,
        clientY: RECT.top + (20 / 60) * PX_PER_HOUR,
    });
    assert.equal(at.minutes, 7 * 60 + 15);
});

test('resolvePointer survives a single-day (day view) grid', () => {
    const at = resolvePointer({
        ...base,
        dayCount: 1,
        clientX: RECT.left + AXIS_WIDTH + 500,
        clientY: RECT.top,
    });
    assert.equal(at.dayIndex, 0);
});

// --- drop-outside detection -------------------------------------------------

test('isOutsideGrid is false inside the grid', () => {
    assert.equal(
        isOutsideGrid({ clientX: RECT.left + 200, clientY: RECT.top + 100, rect: RECT, height: 728 }),
        false,
    );
});

test('isOutsideGrid is true left of the grid (the sidebar)', () => {
    assert.equal(
        isOutsideGrid({ clientX: RECT.left - 50, clientY: RECT.top + 100, rect: RECT, height: 728 }),
        true,
    );
});

test('isOutsideGrid is true above the grid (the header)', () => {
    assert.equal(
        isOutsideGrid({ clientX: RECT.left + 200, clientY: RECT.top - 30, rect: RECT, height: 728 }),
        true,
    );
});

// --- drawer-to-grid scheduling intent -------------------------------------

test('resolveSchedulePointer ignores tiny pointer jitter', () => {
    assert.equal(resolveSchedulePointer({
        ...base,
        height: 728,
        originX: RECT.left + AXIS_WIDTH + 5,
        originY: RECT.top + 50,
        clientX: RECT.left + AXIS_WIDTH + 9,
        clientY: RECT.top + 52,
    }), null);
});

test('resolveSchedulePointer ignores movement that never enters the grid', () => {
    assert.equal(resolveSchedulePointer({
        ...base,
        height: 728,
        originX: 20,
        originY: RECT.top + 50,
        clientX: RECT.left - 20,
        clientY: RECT.top + 100,
    }), null);
});

test('resolveSchedulePointer resolves a real drawer-to-grid drag', () => {
    assert.deepEqual(resolveSchedulePointer({
        ...base,
        height: 728,
        originX: 20,
        originY: RECT.top + 50,
        clientX: RECT.left + AXIS_WIDTH + 20,
        clientY: RECT.top + 50,
    }), { dayIndex: 0, minutes: 480 });
});

test('shouldCommitSchedule requires a preview and a drop inside the grid', () => {
    assert.equal(shouldCommitSchedule({
        hasPreview: true,
        clientX: RECT.left + 200,
        clientY: RECT.top + 100,
        rect: RECT,
        height: 728,
    }), true);
    assert.equal(shouldCommitSchedule({
        hasPreview: false,
        clientX: RECT.left + 200,
        clientY: RECT.top + 100,
        rect: RECT,
        height: 728,
    }), false);
    assert.equal(shouldCommitSchedule({
        hasPreview: true,
        clientX: RECT.left - 20,
        clientY: RECT.top + 100,
        rect: RECT,
        height: 728,
    }), false);
});
