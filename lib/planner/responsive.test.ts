import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerItem } from './items.ts';
import {
    agendaItemsForDay,
    clampOverlayAnchor,
    createPlannerSurfaceStack,
    cycleFocusIndex,
    isPlannerFocusEligible,
    movePriorityId,
    plannerGridAccessibility,
    plannerTimerActionPlacement,
    plannerSurfaceBehavior,
    quickCreateTypeButtonProps,
    resolveMonthAgendaDay,
    selectPlannerFocusTarget,
    shouldRestorePlannerFocus,
    type PlannerFocusObservation,
    weekGridMinWidth,
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

test('week grid keeps all seven days reachable in a narrow horizontal scroll region', () => {
    assert.equal(weekGridMinWidth(7), '848px');
    assert.equal(weekGridMinWidth(1), '100%');
});

test('planner surfaces are modal only at the breakpoints where they have backdrops', () => {
    assert.deepEqual(plannerSurfaceBehavior('detail', 390), {
        modal: true,
        role: 'dialog',
        trapFocus: true,
        backdrop: true,
    });
    assert.deepEqual(plannerSurfaceBehavior('detail', 1024), {
        modal: false,
        role: 'complementary',
        trapFocus: false,
        backdrop: false,
    });
    assert.deepEqual(plannerSurfaceBehavior('quick-create', 1024), {
        modal: false,
        role: 'dialog',
        trapFocus: false,
        backdrop: false,
    });
    assert.equal(plannerSurfaceBehavior('settings', 639).modal, true);
    assert.equal(plannerSurfaceBehavior('settings', 640).modal, false);
});

test('only the top planner surface owns Escape before the previous surface resumes', () => {
    const stack = createPlannerSurfaceStack<string>();
    const unregisterDetail = stack.register('detail');
    const unregisterSettings = stack.register('settings');

    assert.equal(stack.isTop('detail'), false);
    assert.equal(stack.isTop('settings'), true);

    unregisterSettings();
    assert.equal(stack.isTop('detail'), true);
    unregisterDetail();
    assert.equal(stack.top(), null);
});

const VISIBLE_FOCUS_TARGET: PlannerFocusObservation = {
    connected: true,
    hasClientRect: true,
    disabled: false,
    hidden: false,
    inert: false,
    ariaHidden: false,
    display: 'block',
    visibility: 'visible',
    opacity: 1,
    nativeFocusable: false,
    contentEditable: false,
    tabIndexAttribute: null,
};

test('focus eligibility rejects a plain div but accepts real programmatic focus targets', () => {
    assert.equal(isPlannerFocusEligible(VISIBLE_FOCUS_TARGET), false);
    assert.equal(isPlannerFocusEligible({
        ...VISIBLE_FOCUS_TARGET,
        tabIndexAttribute: '-1',
    }), true);
    assert.equal(isPlannerFocusEligible({
        ...VISIBLE_FOCUS_TARGET,
        nativeFocusable: true,
    }), true);
    assert.equal(isPlannerFocusEligible({
        ...VISIBLE_FOCUS_TARGET,
        contentEditable: true,
    }), true);
});

test('focus eligibility rejects disabled, inert, aria-hidden, disconnected, and zero-rect targets', () => {
    const nativeControl = { ...VISIBLE_FOCUS_TARGET, nativeFocusable: true };
    assert.equal(isPlannerFocusEligible({ ...nativeControl, disabled: true }), false);
    assert.equal(isPlannerFocusEligible({ ...nativeControl, hidden: true }), false);
    assert.equal(isPlannerFocusEligible({ ...nativeControl, inert: true }), false);
    assert.equal(isPlannerFocusEligible({ ...nativeControl, ariaHidden: true }), false);
    assert.equal(isPlannerFocusEligible({ ...nativeControl, connected: false }), false);
    assert.equal(isPlannerFocusEligible({ ...nativeControl, hasClientRect: false }), false);
});

test('focus eligibility rejects CSS-hidden and fully transparent targets', () => {
    assert.equal(isPlannerFocusEligible({
        ...VISIBLE_FOCUS_TARGET,
        tabIndexAttribute: '-1',
        display: 'none',
    }), false);
    for (const visibility of ['hidden', 'collapse']) {
        assert.equal(isPlannerFocusEligible({
            ...VISIBLE_FOCUS_TARGET,
            tabIndexAttribute: '-1',
            visibility,
        }), false);
    }
    assert.equal(isPlannerFocusEligible({
        ...VISIBLE_FOCUS_TARGET,
        tabIndexAttribute: '-1',
        opacity: 0,
    }), false);
});

test('focus selection falls back and can revalidate a target that becomes hidden', () => {
    const opener = { id: 'opener' };
    const planner = { id: 'planner' };
    let openerOpacity = 1;
    const observe = (target: typeof opener): PlannerFocusObservation => ({
        ...VISIBLE_FOCUS_TARGET,
        nativeFocusable: target === opener,
        tabIndexAttribute: target === planner ? '-1' : null,
        opacity: target === opener ? openerOpacity : 1,
    });

    const initiallySelected = selectPlannerFocusTarget([opener, planner], observe);
    assert.equal(initiallySelected, opener);

    openerOpacity = 0;
    assert.equal(selectPlannerFocusTarget([initiallySelected, planner], observe), planner);
    assert.equal(selectPlannerFocusTarget([opener], observe), null);
});

test('outside pointer closes preserve the newly targeted control while deliberate closes restore', () => {
    assert.equal(shouldRestorePlannerFocus('outside'), false);
    assert.equal(shouldRestorePlannerFocus('escape'), true);
    assert.equal(shouldRestorePlannerFocus('dismiss'), true);
    assert.equal(shouldRestorePlannerFocus('programmatic'), true);
});

test('Day mode omits Week horizontal-scroll instructions', () => {
    assert.deepEqual(plannerGridAccessibility(1), {
        label: 'Daily calendar',
        description: null,
    });
    assert.deepEqual(plannerGridAccessibility(7), {
        label: 'Weekly calendar',
        description: 'Scroll horizontally to reach every day of the week.',
    });
});

test('quick-create type controls expose native pressed-button state', () => {
    assert.deepEqual(quickCreateTypeButtonProps('event', 'event'), {
        type: 'button',
        'aria-pressed': true,
    });
    assert.deepEqual(quickCreateTypeButtonProps('task', 'event'), {
        type: 'button',
        'aria-pressed': false,
    });
});

test('timer actions move into details on narrow screens without disappearing', () => {
    assert.deepEqual(plannerTimerActionPlacement(390), {
        card: false,
        detail: true,
    });
    assert.deepEqual(plannerTimerActionPlacement(1024), {
        card: true,
        detail: true,
    });
});
