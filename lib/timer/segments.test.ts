import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIVE_MINUTES_MS,
  groupSegmentsForDisplay,
  splitSegmentsByLocalDate,
  sumActiveSeconds,
} from './segments.ts';

const segment = (id: string, start: string, end?: string) => ({
  id,
  timeLogId: 'log-1',
  organizationId: 'org-1',
  userId: 'user-1',
  startedAt: start,
  endedAt: end,
});

test('active seconds exclude pause gaps', () => {
  const rows = [
    segment('a', '2026-08-20T17:15:00.000Z', '2026-08-20T19:15:00.000Z'),
    segment('b', '2026-08-20T20:00:00.000Z', '2026-08-20T22:00:00.000Z'),
  ];
  assert.equal(sumActiveSeconds(rows, new Date('2026-08-20T22:00:00.000Z')), 14_400);
});

test('gaps below five minutes merge but five minutes stays split', () => {
  const shortGap = [
    segment('a', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
    segment('b', '2026-08-20T18:04:59.000Z', '2026-08-20T19:00:00.000Z'),
  ];
  const exactGap = [
    segment('a', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
    segment('b', '2026-08-20T18:05:00.000Z', '2026-08-20T19:00:00.000Z'),
  ];
  assert.equal(groupSegmentsForDisplay(shortGap, FIVE_MINUTES_MS).length, 1);
  assert.equal(groupSegmentsForDisplay(exactGap, FIVE_MINUTES_MS).length, 2);
});

test('a segment crossing local midnight is split into date slices', () => {
  const slices = splitSegmentsByLocalDate([
    segment('a', '2026-08-21T06:30:00.000Z', '2026-08-21T07:30:00.000Z'),
  ], 'America/Los_Angeles');
  assert.deepEqual(slices.map(s => [s.localDate, s.activeSeconds]), [
    ['2026-08-20', 1_800],
    ['2026-08-21', 1_800],
  ]);
});

test('open segments use the supplied now without reordering the input', () => {
  const rows = [
    segment('b', '2026-08-20T20:00:00.000Z'),
    segment('a', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
  ];
  const now = new Date('2026-08-20T21:00:00.000Z');

  assert.equal(sumActiveSeconds(rows, now), 7_200);
  assert.deepEqual(rows.map(row => row.id), ['b', 'a']);
  assert.deepEqual(groupSegmentsForDisplay(rows, FIVE_MINUTES_MS, now), [
    {
      startsAt: '2026-08-20T17:00:00.000Z',
      endsAt: '2026-08-20T18:00:00.000Z',
      activeSeconds: 3_600,
      segments: [rows[1]],
    },
    {
      startsAt: '2026-08-20T20:00:00.000Z',
      endsAt: '2026-08-20T21:00:00.000Z',
      activeSeconds: 3_600,
      segments: [rows[0]],
    },
  ]);
});

test('invalid and negative intervals are rejected', () => {
  assert.throws(
    () => sumActiveSeconds([segment('invalid', 'not-a-date', '2026-08-20T18:00:00.000Z')]),
    RangeError,
  );
  assert.throws(
    () => sumActiveSeconds([segment('negative', '2026-08-20T19:00:00.000Z', '2026-08-20T18:00:00.000Z')]),
    RangeError,
  );
});
