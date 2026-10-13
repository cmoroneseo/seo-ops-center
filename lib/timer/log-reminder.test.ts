import test from 'node:test';
import assert from 'node:assert/strict';
import { decideEndOfDayReminder, endOfDayLogLookup, calendarDateInTimeZone } from './log-reminder';

const user = 'user-1';
// 00:30 UTC on Oct 14 is 17:30 on Oct 13 in Los Angeles (PDT, UTC-7).
const evening = new Date('2026-10-14T00:30:00.000Z');

test('Los Angeles evening uses the local date, not the UTC date', () => {
    assert.equal(evening.toISOString().slice(0, 10), '2026-10-14');
    assert.equal(calendarDateInTimeZone(evening, 'America/Los_Angeles'), '2026-10-13');
    const decision = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [{ userId: user, date: '2026-10-13', hours: 2.5, status: 'logged' }],
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(decision.localDate, '2026-10-13');
    assert.equal(decision.show, false);
    assert.equal(decision.reason, 'logged_today');
});

test('the reminder shows only when this member has no hours on that local day', () => {
    const none = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [{ userId: 'someone-else', date: '2026-10-13', hours: 8, status: 'logged' }],
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(none.show, true);
    assert.equal(none.reason, 'remind');

    const dated = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [{ userId: user, date: '2026-10-13T00:00:00.000Z', hours: 1, status: 'logged' }],
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(dated.reason, 'logged_today');

    const running = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [{ userId: user, date: '2026-10-13', hours: 0, status: 'in_progress' }],
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(running.reason, 'logged_today');
});

test('a failed query is not zero hours, and a presented day does not repeat', () => {
    const failed = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: null,
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(failed.show, false);
    assert.equal(failed.reason, 'query_failed');

    const repeated = decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [],
        shownForDate: '2026-10-13',
        dismissedForDate: null,
    });
    assert.equal(repeated.show, false);
    assert.equal(repeated.reason, 'already_shown');

    const beforeFour = decideEndOfDayReminder({
        now: new Date('2026-10-13T22:30:00.000Z'),
        timeZone: 'America/Los_Angeles',
        userId: user,
        logs: [],
        shownForDate: null,
        dismissedForDate: null,
    });
    assert.equal(beforeFour.localDate, '2026-10-13');
    assert.equal(beforeFour.reason, 'before_hour');

    assert.equal(decideEndOfDayReminder({
        now: evening,
        timeZone: 'America/Los_Angeles',
        userId: '',
        logs: [],
        shownForDate: null,
        dismissedForDate: null,
    }).reason, 'missing_user');
});

test('the lookup uses the local date, the member, and a hard failure', () => {
    const monthBoundary = new Date('2026-10-01T06:30:00.000Z');
    assert.equal(monthBoundary.toISOString().slice(0, 10), '2026-10-01');
    const localDate = calendarDateInTimeZone(monthBoundary, 'America/Los_Angeles');
    assert.equal(localDate, '2026-09-30');
    assert.deepEqual(endOfDayLogLookup(localDate, user), {
        onDate: '2026-09-30',
        userId: user,
        throwOnError: true,
        includeInProgress: true,
    });
});
