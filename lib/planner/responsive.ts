import type { PlannerItem } from './items';

function localDayKey(value: Date): string {
    return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

export function resolveMonthAgendaDay(
    anchorDate: Date,
    days: Date[],
    selectedDay?: Date,
): Date {
    if (!selectedDay) return anchorDate;
    const selectedKey = localDayKey(selectedDay);
    return days.some(day => localDayKey(day) === selectedKey) ? selectedDay : anchorDate;
}

export function agendaItemsForDay(items: PlannerItem[], day: Date): PlannerItem[] {
    const dayKey = localDayKey(day);
    return items
        .filter(item => localDayKey(new Date(item.startsAt)) === dayKey)
        .sort((a, b) => {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
        });
}

export function clampOverlayAnchor(
    preferredX: number,
    viewportWidth: number,
    overlayWidth = 340,
    gutter = 12,
): number {
    const furthestSafeLeft = viewportWidth - overlayWidth - gutter;
    return Math.max(gutter, Math.min(preferredX, furthestSafeLeft));
}

export function movePriorityId(
    orderedIds: string[],
    id: string,
    direction: -1 | 1,
): string[] {
    const index = orderedIds.indexOf(id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= orderedIds.length) return [...orderedIds];
    const next = [...orderedIds];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

export function cycleFocusIndex(current: number, count: number, backwards: boolean): number {
    if (count <= 0) return -1;
    return (current + (backwards ? -1 : 1) + count) % count;
}

const WEEK_TIME_AXIS_WIDTH = 64;
const WEEK_DAY_MIN_WIDTH = 112;

/** A seven-day week stays legible and becomes horizontally scrollable on narrow screens. */
export function weekGridMinWidth(dayCount: number): string {
    if (dayCount <= 1) return '100%';
    return `${WEEK_TIME_AXIS_WIDTH + dayCount * WEEK_DAY_MIN_WIDTH}px`;
}

export interface PlannerGridAccessibility {
    label: 'Daily calendar' | 'Weekly calendar';
    description: string | null;
}

/** Describe only multi-day grids as horizontally scrollable weeks. */
export function plannerGridAccessibility(dayCount: number): PlannerGridAccessibility {
    if (dayCount <= 1) return { label: 'Daily calendar', description: null };
    return {
        label: 'Weekly calendar',
        description: 'Scroll horizontally to reach every day of the week.',
    };
}

export type PlannerSurfaceKind = 'detail' | 'quick-create' | 'settings';

export interface PlannerSurfaceBehavior {
    modal: boolean;
    role: 'dialog' | 'complementary';
    trapFocus: boolean;
    backdrop: boolean;
}

/** Keep semantics and focus behavior aligned with each surface's responsive layout. */
export function plannerSurfaceBehavior(
    kind: PlannerSurfaceKind,
    viewportWidth: number,
): PlannerSurfaceBehavior {
    const modal = viewportWidth < (kind === 'settings' ? 640 : 1024);
    if (modal) {
        return { modal: true, role: 'dialog', trapFocus: true, backdrop: true };
    }
    return {
        modal: false,
        role: kind === 'detail' ? 'complementary' : 'dialog',
        trapFocus: false,
        backdrop: false,
    };
}

export interface PlannerSurfaceStack<T> {
    register: (surface: T) => () => void;
    isTop: (surface: T) => boolean;
    top: () => T | null;
}

/** Coordinates Escape/focus ownership when planner surfaces overlap. */
export function createPlannerSurfaceStack<T>(): PlannerSurfaceStack<T> {
    let surfaces: T[] = [];
    return {
        register(surface) {
            surfaces = [...surfaces.filter(candidate => candidate !== surface), surface];
            let registered = true;
            return () => {
                if (!registered) return;
                registered = false;
                surfaces = surfaces.filter(candidate => candidate !== surface);
            };
        },
        isTop(surface) {
            return surfaces.at(-1) === surface;
        },
        top() {
            return surfaces.at(-1) ?? null;
        },
    };
}

export interface PlannerFocusObservation {
    connected: boolean;
    hasClientRect: boolean;
    disabled?: boolean;
    hidden: boolean;
    inert: boolean;
    ariaHidden: boolean;
    display: string;
    visibility: string;
    opacity: number;
    nativeFocusable: boolean;
    contentEditable: boolean;
    tabIndexAttribute: string | null;
}

export function isPlannerFocusEligible(observation: PlannerFocusObservation): boolean {
    if (!observation.connected || !observation.hasClientRect || observation.disabled) return false;
    if (observation.hidden || observation.inert || observation.ariaHidden) return false;
    if (observation.display === 'none') return false;
    if (observation.visibility === 'hidden' || observation.visibility === 'collapse') return false;
    if (observation.opacity <= 0) return false;
    return observation.nativeFocusable
        || observation.contentEditable
        || observation.tabIndexAttribute !== null;
}

/** Pick the first currently visible, programmatically focusable candidate. */
export function selectPlannerFocusTarget<T>(
    candidates: Array<T | null | undefined>,
    observe: (candidate: T) => PlannerFocusObservation,
): T | null {
    for (const candidate of candidates) {
        if (candidate != null && isPlannerFocusEligible(observe(candidate))) return candidate;
    }
    return null;
}

export type PlannerCloseReason = 'escape' | 'dismiss' | 'outside' | 'programmatic';

/** Pointer outside-dismissal must not steal focus back from the newly clicked target. */
export function shouldRestorePlannerFocus(reason: PlannerCloseReason): boolean {
    return reason !== 'outside';
}

/** Native toggle-button attributes for the quick-create type chooser. */
export function quickCreateTypeButtonProps<T extends string>(type: T, active: T) {
    return {
        type: 'button' as const,
        'aria-pressed': type === active,
    };
}
