/**
 * Pure geometry for the weekly planner grid.
 *
 * No React, no Supabase, no Date mutation. Every pixel<->time conversion and
 * every overlap decision in the planner routes through this module, which is
 * why it is the only planner module carrying unit tests.
 */

export const PX_PER_HOUR = 56;
export const SNAP_MINUTES = 15;
export const MIN_EVENT_MINUTES = 15;
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 20;

const MINUTES_PER_DAY = 24 * 60;

/** Vertical offset in px for a wall-clock minute, relative to the grid's first hour. */
export function minutesToY(minutes: number, startHour: number = DEFAULT_START_HOUR): number {
    return ((minutes - startHour * 60) / 60) * PX_PER_HOUR;
}

/** Inverse of minutesToY. */
export function yToMinutes(y: number, startHour: number = DEFAULT_START_HOUR): number {
    return (y / PX_PER_HOUR) * 60 + startHour * 60;
}

/** Round to the nearest drag increment. */
export function snapMinutes(minutes: number): number {
    return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Keep a minute offset inside a single day. */
export function clampMinutes(minutes: number): number {
    return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/** Local wall-clock minutes since midnight for an ISO timestamp. */
export function minutesSinceMidnight(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
}

/** Whole minutes between two ISO timestamps. */
export function durationMinutes(startIso: string, endIso: string): number {
    return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

/** Width of the hour-label gutter before the first day column. */
export const AXIS_WIDTH = 64;

/** At or below this, a block is too short for a second line of text. */
export const COMPACT_MAX_MINUTES = 30;

export interface StaggerBounds {
    leftPct: number;
    widthPct: number;
    zIndex: number;
}

/**
 * Where an overlapping card sits, ClickUp-style.
 *
 * Rather than tiling a cluster into equal columns, each successive card is
 * indented and runs to the right edge, layering over the ones beneath. The
 * earlier card keeps its title visible on the left, and the newest sits on top.
 * A lone card takes the full width.
 */
export function staggerBounds(column: number, columnCount: number): StaggerBounds {
    const slot = 100 / Math.max(1, columnCount);
    const leftPct = column * slot;
    return { leftPct, widthPct: 100 - leftPct, zIndex: 10 + column };
}

/** Is this minute inside the configured working day? */
export function isWorkMinute(minutes: number, workStartHour: number, workEndHour: number): boolean {
    return minutes >= workStartHour * 60 && minutes < workEndHour * 60;
}

export interface GridRect {
    left: number;
    top: number;
    width: number;
}

export interface ResolvedPointer {
    dayIndex: number;
    minutes: number;
}

/**
 * Pointer position -> which day column and which snapped minute.
 *
 * Extracted from the drag hook so it can be tested without a DOM: this is the
 * conversion every gesture depends on, and getting it wrong moves events to the
 * wrong day silently.
 *
 * `dayIndex` is clamped to the visible columns so a drag that wanders into the
 * axis gutter or past the last column still resolves to a real day.
 */
export function resolvePointer(params: {
    clientX: number;
    clientY: number;
    rect: GridRect;
    scrollTop: number;
    dayCount: number;
    startHour: number;
    axisWidth?: number;
}): ResolvedPointer {
    const { clientX, clientY, rect, scrollTop, dayCount, startHour } = params;
    const axisWidth = params.axisWidth ?? AXIS_WIDTH;
    const columns = Math.max(1, dayCount);
    const columnWidth = (rect.width - axisWidth) / columns;
    const dayIndex = columnWidth > 0
        ? Math.min(columns - 1, Math.max(0, Math.floor((clientX - rect.left - axisWidth) / columnWidth)))
        : 0;
    const y = clientY - rect.top + scrollTop;
    return { dayIndex, minutes: clampMinutes(snapMinutes(yToMinutes(y, startHour))) };
}

/** Is the pointer outside the grid entirely? A drop out here unschedules. */
export function isOutsideGrid(params: {
    clientX: number;
    clientY: number;
    rect: GridRect;
    height: number;
}): boolean {
    const { clientX, clientY, rect, height } = params;
    return (
        clientX < rect.left ||
        clientX > rect.left + rect.width ||
        clientY < rect.top ||
        clientY > rect.top + height
    );
}

export interface PackableInterval {
    id: string;
    startMin: number;
    endMin: number;
}

export interface PackedInterval<T> {
    item: T;
    /** Zero-based horizontal slot within the cluster. */
    column: number;
    /** How many slots the cluster is divided into. */
    columnCount: number;
}

/**
 * Interval-graph packing.
 *
 * Sorts by start time, groups items into clusters of transitively-overlapping
 * intervals, then assigns each item the lowest column index whose previous
 * occupant has already ended. Every item in a cluster reports the same
 * columnCount so the renderer can size them all to 1/columnCount.
 *
 * Touching intervals (one ends exactly as the next begins) do NOT overlap.
 * Results are returned in the caller's original order.
 */
export function packOverlaps<T extends PackableInterval>(items: T[]): PackedInterval<T>[] {
    if (items.length === 0) return [];

    const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const result = new Map<string, { column: number; columnCount: number }>();

    let cluster: T[] = [];
    let clusterEnd = -Infinity;

    const flush = () => {
        if (cluster.length === 0) return;
        // columnEnds[i] = the end minute of the last item placed in column i
        const columnEnds: number[] = [];
        const placements: { id: string; column: number }[] = [];

        for (const item of cluster) {
            let column = columnEnds.findIndex(end => end <= item.startMin);
            if (column === -1) {
                column = columnEnds.length;
                columnEnds.push(item.endMin);
            } else {
                columnEnds[column] = item.endMin;
            }
            placements.push({ id: item.id, column });
        }

        for (const p of placements) {
            result.set(p.id, { column: p.column, columnCount: columnEnds.length });
        }
        cluster = [];
        clusterEnd = -Infinity;
    };

    for (const item of sorted) {
        // A new cluster starts when this item begins at or after everything seen so far.
        if (item.startMin >= clusterEnd) flush();
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMin);
    }
    flush();

    return items.map(item => {
        const placement = result.get(item.id) ?? { column: 0, columnCount: 1 };
        return { item, column: placement.column, columnCount: placement.columnCount };
    });
}
