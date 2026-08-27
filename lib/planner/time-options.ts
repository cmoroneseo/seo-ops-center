import { formatBlockDuration } from './task-block-log.ts';

/**
 * Editable start and end times for a draft block.
 *
 * The quick-create popover showed its time range as plain text, so the only
 * way to correct a block you had just drawn was to cancel and drag again.
 * Clicking the time should offer the same thing every calendar offers: a list
 * of times, and — for the end — what duration each one produces, so you can
 * pick by the answer you actually want ("an hour and a half") rather than by
 * doing clock arithmetic.
 */

export interface TimeOption {
    /** The instant this option would set, as ISO. */
    value: string;
    /** "3:15pm" */
    label: string;
    /** "1h 15m" — the block length this option produces. End options only. */
    duration?: string;
}

const STEP_MINUTES = 15;
/** How far past the start end-times are offered. Twelve hours is a long day. */
const MAX_BLOCK_MINUTES = 12 * 60;
const DAY_MINUTES = 24 * 60;

/** "3:15pm", "12:00am" — lowercase meridiem, matching the chips on the grid. */
export function formatTimeLabel(value: Date | string): string {
    const date = typeof value === 'string' ? new Date(value) : value;
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const meridiem = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    return `${hours}:${String(minutes).padStart(2, '0')}${meridiem}`;
}

function addMinutes(iso: string, minutes: number): Date {
    return new Date(new Date(iso).getTime() + minutes * 60_000);
}

export function minutesBetween(startsAt: string, endsAt: string): number {
    return Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
}

/**
 * End times offered for a block, each labelled with the resulting duration.
 *
 * Only times AFTER the start are produced, so an end can never be chosen that
 * inverts the block.
 */
export function endTimeOptions(startsAt: string): TimeOption[] {
    const options: TimeOption[] = [];
    for (let minutes = STEP_MINUTES; minutes <= MAX_BLOCK_MINUTES; minutes += STEP_MINUTES) {
        const end = addMinutes(startsAt, minutes);
        options.push({
            value: end.toISOString(),
            label: formatTimeLabel(end),
            duration: formatBlockDuration(minutes),
        });
    }
    return options;
}

/** Every quarter hour of the start's own day. */
export function startTimeOptions(startsAt: string): TimeOption[] {
    const dayStart = new Date(startsAt);
    dayStart.setHours(0, 0, 0, 0);
    const options: TimeOption[] = [];
    for (let minutes = 0; minutes < DAY_MINUTES; minutes += STEP_MINUTES) {
        const at = new Date(dayStart.getTime() + minutes * 60_000);
        options.push({ value: at.toISOString(), label: formatTimeLabel(at) });
    }
    return options;
}

/**
 * Move the start, keeping the block the same length.
 *
 * Dragging the start of a block elsewhere in the day means "do this later",
 * not "make this shorter" — so the end follows rather than staying put.
 */
export function withStartTime(
    range: { startsAt: string; endsAt: string },
    nextStart: string,
): { startsAt: string; endsAt: string } {
    const duration = minutesBetween(range.startsAt, range.endsAt);
    return {
        startsAt: new Date(nextStart).toISOString(),
        endsAt: addMinutes(nextStart, duration).toISOString(),
    };
}

/** Move the end, keeping the start. Refuses an end at or before the start. */
export function withEndTime(
    range: { startsAt: string; endsAt: string },
    nextEnd: string,
): { startsAt: string; endsAt: string } {
    if (new Date(nextEnd).getTime() <= new Date(range.startsAt).getTime()) return range;
    return { startsAt: range.startsAt, endsAt: new Date(nextEnd).toISOString() };
}
