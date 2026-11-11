import { dateOffset } from '@/lib/gsc/history';
import { ptToday } from '@/lib/sync/months';

import { BASELINE_DAYS, GSC_LAG_DAYS, type CheckpointDays } from './thresholds';

const PACIFIC = 'America/Los_Angeles';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

export function isIsoDay(value: string): boolean {
    return DAY.test(value);
}

/** Pacific calendar date for an instant. */
export function ptDate(iso: string): string | null {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: PACIFIC,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

export function formatPt(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat('en-US', {
        timeZone: PACIFIC,
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
    }).format(date);
}

export function formatDay(iso: string): string {
    if (!DAY.test(iso)) return iso;
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function formatDayWithYear(iso: string): string {
    if (!DAY.test(iso)) return iso;
    const [year, month, day] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * A `datetime-local` value typed as Pacific wall time, to a UTC instant.
 * Tries both Pacific offsets and keeps the one that formats back to the same clock time.
 */
export function ptLocalToIso(local: string): string | null {
    const match = LOCAL.exec(local);
    if (!match) return null;
    for (const offset of ['-08:00', '-07:00']) {
        const date = new Date(`${match[1]}T${match[2]}:${match[3]}:00${offset}`);
        if (Number.isNaN(date.getTime())) continue;
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: PACIFIC,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(date);
        const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
        const back = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
        if (back === local) return date.toISOString();
    }
    return null;
}

export function isoToPtLocal(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: PACIFIC,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(date);
    const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Same calendar month and day, one year earlier. Feb 29 becomes Feb 28. */
export function sameDateLastYear(iso: string): string {
    const [year, month, day] = iso.split('-').map(Number);
    const last = year - 1;
    const safeDay = month === 2 && day === 29 ? 28 : day;
    return `${last}-${String(month).padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`;
}

export function baselineWindow(liveOn: string): { start: string; end: string } {
    return { start: dateOffset(liveOn, -BASELINE_DAYS), end: dateOffset(liveOn, -1) };
}

export function afterWindow(liveOn: string, days: CheckpointDays): { start: string; end: string } {
    return { start: liveOn, end: dateOffset(liveOn, days - 1) };
}

/** Latest Pacific date Search Console treats as final. Today minus the lag. */
export function finalThrough(now: Date): string {
    return dateOffset(ptToday(now), -GSC_LAG_DAYS);
}

export function shiftWindowLastYear(window: { start: string; end: string }): { start: string; end: string } {
    return { start: sameDateLastYear(window.start), end: sameDateLastYear(window.end) };
}
