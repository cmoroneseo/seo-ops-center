import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatTimeLabel, endTimeOptions, startTimeOptions,
    withStartTime, withEndTime, minutesBetween,
} from './time-options.ts';

/** 2:00 PM local, whatever zone the test runs in. */
function localAt(hours: number, minutes = 0): string {
    const d = new Date(2026, 7, 27, hours, minutes, 0, 0);
    return d.toISOString();
}

test('times read the way the grid writes them', () => {
    assert.equal(formatTimeLabel(localAt(15, 15)), '3:15pm');
    assert.equal(formatTimeLabel(localAt(0, 0)), '12:00am');
    assert.equal(formatTimeLabel(localAt(12, 0)), '12:00pm');
    assert.equal(formatTimeLabel(localAt(9, 5)), '9:05am');
});

test('end options say what duration each one produces', () => {
    // Picking by the answer you want — "an hour and a half" — instead of
    // doing clock arithmetic, which is the whole point of the list.
    const options = endTimeOptions(localAt(14));
    assert.equal(options[0].label, '2:15pm');
    assert.equal(options[0].duration, '15m');
    assert.equal(options[3].label, '3:00pm');
    assert.equal(options[3].duration, '1h');
    assert.equal(options[5].duration, '1h 30m');
});

test('no end option can invert the block', () => {
    const start = localAt(14);
    const startMs = new Date(start).getTime();
    for (const option of endTimeOptions(start)) {
        assert.ok(new Date(option.value).getTime() > startMs, option.label);
    }
});

test('end options cross midnight rather than stopping at it', () => {
    // A block drawn at 11pm still needs to be lengthenable.
    const options = endTimeOptions(localAt(23));
    assert.equal(options[3].label, '12:00am');
    assert.equal(options[3].duration, '1h');
});

test('start options cover the whole day at quarter hours', () => {
    const options = startTimeOptions(localAt(14));
    assert.equal(options.length, 96);
    assert.equal(options[0].label, '12:00am');
    assert.equal(options[options.length - 1].label, '11:45pm');
});

test('moving the start keeps the block the same length', () => {
    // "Do this later", not "make this shorter".
    const range = { startsAt: localAt(14), endsAt: localAt(15, 30) };
    const moved = withStartTime(range, localAt(16));
    assert.equal(minutesBetween(moved.startsAt, moved.endsAt), 90);
    assert.equal(formatTimeLabel(moved.endsAt), '5:30pm');
});

test('moving the end keeps the start', () => {
    const range = { startsAt: localAt(14), endsAt: localAt(15) };
    const changed = withEndTime(range, localAt(16, 45));
    assert.equal(changed.startsAt, range.startsAt);
    assert.equal(formatTimeLabel(changed.endsAt), '4:45pm');
});

test('an end at or before the start is refused, not applied', () => {
    const range = { startsAt: localAt(14), endsAt: localAt(15) };
    assert.deepEqual(withEndTime(range, localAt(13)), range);
    assert.deepEqual(withEndTime(range, localAt(14)), range);
});
