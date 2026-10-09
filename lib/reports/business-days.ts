/**
 * Pacific business days for report draft (day 3) and send (day 5, 9:00 AM PT).
 * Weekends and US federal holidays are not business days. Callers can add
 * extra holidays; they cannot remove a federal holiday.
 */

import { ptToday } from '@/lib/sync/months';

export const PT_TIME_ZONE = 'America/Los_Angeles';

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function iso(year: number, month: number, day: number): string {
    return `${year}-${pad(month)}-${pad(day)}`;
}

function utcDate(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day));
}

function addDays(year: number, month: number, day: number, delta: number): { year: number; month: number; day: number } {
    const date = utcDate(year, month, day);
    date.setUTCDate(date.getUTCDate() + delta);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function weekday(year: number, month: number, day: number): number {
    return utcDate(year, month, day).getUTCDay();
}

function nthWeekday(year: number, month: number, dow: number, n: number): string {
    const first = weekday(year, month, 1);
    const delta = (dow - first + 7) % 7;
    const day = 1 + delta + (n - 1) * 7;
    return iso(year, month, day);
}

function lastWeekday(year: number, month: number, dow: number): string {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lastDow = weekday(year, month, last);
    const delta = (lastDow - dow + 7) % 7;
    return iso(year, month, last - delta);
}

/** Saturday holidays are observed Friday. Sunday holidays are observed Monday. */
function observed(year: number, month: number, day: number): string {
    const dow = weekday(year, month, day);
    if (dow === 6) {
        const previous = addDays(year, month, day, -1);
        return iso(previous.year, previous.month, previous.day);
    }
    if (dow === 0) {
        const next = addDays(year, month, day, 1);
        return iso(next.year, next.month, next.day);
    }
    return iso(year, month, day);
}

/** Observed US federal holidays that fall in or are observed during `year`. */
export function usFederalHolidays(year: number): string[] {
    const dates = [
        observed(year, 1, 1),
        nthWeekday(year, 1, 1, 3),
        nthWeekday(year, 2, 1, 3),
        lastWeekday(year, 5, 1),
        observed(year, 6, 19),
        observed(year, 7, 4),
        nthWeekday(year, 9, 1, 1),
        nthWeekday(year, 10, 1, 2),
        observed(year, 11, 11),
        nthWeekday(year, 11, 4, 4),
        observed(year, 12, 25),
        observed(year + 1, 1, 1),
    ];
    return [...new Set(dates)].filter(date => date.startsWith(String(year))).sort();
}

function holidaySet(year: number, extra: readonly string[]): Set<string> {
    const dates = [
        ...usFederalHolidays(year - 1),
        ...usFederalHolidays(year),
        ...usFederalHolidays(year + 1),
        ...extra.filter(date => DAY.test(date)),
    ];
    return new Set(dates);
}

export function isWeekend(ptDate: string): boolean {
    const match = DAY.exec(ptDate);
    if (!match) return false;
    const dow = weekday(Number(match[1]), Number(match[2]), Number(match[3]));
    return dow === 0 || dow === 6;
}

export function isBusinessDay(ptDate: string, extraHolidays: readonly string[] = []): boolean {
    const match = DAY.exec(ptDate);
    if (!match) return false;
    if (isWeekend(ptDate)) return false;
    const year = Number(match[1]);
    return !holidaySet(year, extraHolidays).has(ptDate);
}

export function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 1-based business-day index inside the month, or null when the date is not one. */
export function businessDayNumber(ptDate: string, extraHolidays: readonly string[] = []): number | null {
    const match = DAY.exec(ptDate);
    if (!match || !isBusinessDay(ptDate, extraHolidays)) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    let count = 0;
    for (let cursor = 1; cursor <= day; cursor += 1) {
        if (isBusinessDay(iso(year, month, cursor), extraHolidays)) count += 1;
    }
    return count;
}

/** The nth business day of a YYYY-MM month. Null when the month does not have that many. */
export function nthBusinessDay(month: string, n: number, extraHolidays: readonly string[] = []): string | null {
    const match = MONTH.exec(month);
    if (!match || !Number.isInteger(n) || n < 1) return null;
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const last = daysInMonth(year, monthNumber);
    let count = 0;
    for (let day = 1; day <= last; day += 1) {
        const date = iso(year, monthNumber, day);
        if (!isBusinessDay(date, extraHolidays)) continue;
        count += 1;
        if (count === n) return date;
    }
    return null;
}

function zoneParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const bag = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: PT_TIME_ZONE,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    const hour = Number(bag.hour);
    return {
        year: Number(bag.year),
        month: Number(bag.month),
        day: Number(bag.day),
        hour: hour === 24 ? 0 : hour,
        minute: Number(bag.minute),
        second: Number(bag.second),
    };
}

/** UTC instant for a Pacific wall-clock time. 9:00 is outside the DST fold. */
export function instantAtPt(ptDate: string, hour: number, minute = 0): Date {
    const match = DAY.exec(ptDate);
    if (!match || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        throw new Error('Invalid Pacific time');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
    const got = zoneParts(guess);
    const gotUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const wantUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
    return new Date(guess.getTime() + (wantUtc - gotUtc));
}

function nextMonth(month: string): string {
    const match = MONTH.exec(month);
    if (!match) throw new Error('Invalid month');
    let year = Number(match[1]);
    let monthNumber = Number(match[2]) + 1;
    if (monthNumber === 13) {
        monthNumber = 1;
        year += 1;
    }
    return `${year}-${pad(monthNumber)}`;
}

function addCalendarDay(ptDate: string): string {
    const match = DAY.exec(ptDate);
    if (!match) throw new Error('Invalid date');
    const next = addDays(Number(match[1]), Number(match[2]), Number(match[3]), 1);
    return iso(next.year, next.month, next.day);
}

/**
 * Business day 5 of the month after the report, at 9:00 AM Pacific.
 * If that instant has already passed, the next business day at 9:00 AM Pacific.
 */
export function reportSendInstant(reportMonth: string, now: Date, extraHolidays: readonly string[] = []): Date {
    const targetDay = nthBusinessDay(nextMonth(reportMonth), 5, extraHolidays);
    if (!targetDay) throw new Error('Invalid month');
    const target = instantAtPt(targetDay, 9, 0);
    if (target.getTime() > now.getTime()) return target;
    let cursor = ptToday(now);
    for (let step = 0; step < 40; step += 1) {
        cursor = addCalendarDay(cursor);
        if (!isBusinessDay(cursor, extraHolidays)) continue;
        const candidate = instantAtPt(cursor, 9, 0);
        if (candidate.getTime() > now.getTime()) return candidate;
    }
    throw new Error('No upcoming business day');
}
