import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerItem } from './items.ts';
import {
    agendaItemsForDay,
    clampOverlayAnchor,
    cycleFocusIndex,
    movePriorityId,
    resolveMonthAgendaDay,
} from './responsive.ts';

function item(
    id: string,
    startsAt: Date,
    options: { allDay?: boolean; title?: string } = {},
): PlannerItem {
    return {
        id,
        source: 'event',
        title: options.title ?? id,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + 60 * 60_000).toISOString(),
        allDay: options.allDay ?? false,
        kind: 'event',
        attendeeIds: [],
        draggable: true,
        raw: {} as PlannerItem['raw'],
    };
}

test('month agenda keeps the selected displayed day and resets an out-of-range selection', () => {
    const days = [new Date(2026, 6, 26), new Date(2026, 7, 18), new Date(2026, 8, 5)];

    assert.equal(
        resolveMonthAgendaDay(new Date(2026, 7, 18), days, new Date(2026, 6, 26)).getDate(),
        26,
    );
    assert.deepEqual(
        resolveMonthAgendaDay(new Date(2026, 8, 18), days, new Date(2026, 9, 4)),
        new Date(2026, 8, 18),
    );
});

test('month agenda returns only the selected local day with all-day work first', () => {
    const selected = new Date(2026, 7, 18);
    const items = [
        item('late', new Date(2026, 7, 18, 15)),
        item('tomorrow', new Date(2026, 7, 19, 8)),
        item('all-day', new Date(2026, 7, 18, 0), { allDay: true }),
        item('early', new Date(2026, 7, 18, 9)),
    ];

    assert.deepEqual(
        agendaItemsForDay(items, selected).map(entry => entry.id),
        ['all-day', 'early', 'late'],
    );
});

test('overlay anchors stay inside narrow and desktop viewports', () => {
    assert.equal(clampOverlayAnchor(-40, 320), 12);
    assert.equal(clampOverlayAnchor(300, 375), 23);
    assert.equal(clampOverlayAnchor(420, 1280), 420);
});

test('priority button ordering moves one step and stops at list boundaries', () => {
    const ids = ['a', 'b', 'c'];

    assert.deepEqual(movePriorityId(ids, 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(movePriorityId(ids, 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(movePriorityId(ids, 'a', -1), ids);
    assert.deepEqual(movePriorityId(ids, 'c', 1), ids);
});

test('dialog focus cycling wraps in both directions', () => {
    assert.equal(cycleFocusIndex(2, 3, false), 0);
    assert.equal(cycleFocusIndex(0, 3, true), 2);
    assert.equal(cycleFocusIndex(1, 3, false), 2);
});
