import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { taskStretchLines } from './task-stretches.ts';

test('human timer rows keep the grouped session list', () => {
    const lines = taskStretchLines({
        status: 'logged',
        description: 'Client call',
        segments: [{
            startedAt: '2026-11-03T18:00:00.000Z',
            endedAt: '2026-11-03T18:30:00.000Z',
        }],
    });
    assert.equal(lines, null);

    const pausedHuman = taskStretchLines({
        status: 'in_progress',
        timerStartedAt: undefined,
        segments: [{
            startedAt: '2026-11-03T18:00:00.000Z',
            endedAt: '2026-11-03T18:30:00.000Z',
        }],
    });
    assert.equal(pausedHuman, null);
});

test('a bot entry lists every stretch with its note and does not invent an end while running', () => {
    const lines = taskStretchLines({
        status: 'paused',
        segments: [
            {
                startedAt: '2026-11-03T18:00:00.000Z',
                endedAt: '2026-11-03T18:30:00.000Z',
                note: 'Mapped the keyword set\nChecked the top ten',
            },
            {
                startedAt: '2026-11-03T20:00:00.000Z',
                endedAt: '2026-11-03T20:20:00.000Z',
                note: 'Drafted the brief',
            },
        ],
    });
    assert.equal(lines?.length, 2);
    assert.equal(lines?.[0].endedAt, '2026-11-03T18:30:00.000Z');
    assert.equal(lines?.[1].note, 'Drafted the brief');

    const running = taskStretchLines({
        status: 'in_progress',
        description: 'Drafted the brief',
        timerStartedAt: '2026-11-03T20:00:00.000Z',
        segments: [{
            startedAt: '2026-11-03T18:00:00.000Z',
            endedAt: '2026-11-03T18:30:00.000Z',
            note: 'Mapped the keyword set',
        }],
    });
    assert.equal(running?.[1].endedAt, null);
    assert.equal(running?.[1].note, 'Drafted the brief');
});

test('human pause still closes a segment without a paused status, and Basecamp notes stay on the bot stop path', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const pause = schema.slice(schema.indexOf('function public.pause_time_attempt'));
    const body = pause.slice(0, pause.indexOf('revoke execute on function public.pause_time_attempt'));
    assert.equal(body.includes("status = 'paused'"), false);
    assert.match(body, /set ended_at = p_paused_at/);
    assert.match(body, /set timer_started_at = null/);

    const humanRoute = readFileSync(new URL('../../app/api/time-tracking/route.ts', import.meta.url), 'utf8');
    assert.equal(humanRoute.includes('botTimerBasecampSummary'), false);
    assert.match(humanRoute, /\.is\('bot_key_id', null\)/);
});
