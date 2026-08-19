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
