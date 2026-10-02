import type { WorkCard } from './project';

/** Date-only calendar values use UTC arithmetic to avoid DST shifts. */
export function calendarDays(month: string): string[] {
    const first = new Date(`${month}-01T00:00:00Z`);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const end = new Date(last);
    end.setUTCDate(last.getUTCDate() + 6 - last.getUTCDay());
    const days: string[] = [];
    for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) days.push(date.toISOString().slice(0, 10));
    return days;
}

export function workOnDate(cards: WorkCard[], date: string): WorkCard[] {
    return cards.filter(card => {
        if (card.startDate && card.dueDate && card.startDate < card.dueDate) return card.startDate <= date && card.dueDate >= date;
        return (card.dueDate ?? card.startDate) === date;
    }).sort((a, b) => a.title.localeCompare(b.title));
}

export function dueDateMoveError(card: WorkCard, date: string): string | null {
    if (!card.taskId) return 'Open the SEO Plan to change this item’s date.';
    if (card.startDate && date < card.startDate) return 'The due date must be on or after the task’s start date. Open the task to change its schedule.';
    return null;
}

/** Monday-aligned weeks clipped to the visible month, including partial weeks. */
export function timelineWeeks(days: string[]): { start: number; end: number }[] {
    const weeks: { start: number; end: number }[] = [];
    for (let index = 0; index < days.length; index++) {
        if (index === 0 || new Date(`${days[index]}T00:00:00Z`).getUTCDay() === 1) weeks.push({ start: index, end: index });
        else weeks[weeks.length - 1].end = index;
    }
    return weeks;
}
