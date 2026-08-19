import {
    eachDayOfInterval,
    endOfMonth,
    endOfWeek,
    startOfMonth,
    startOfWeek,
} from 'date-fns';

/** Every local calendar day rendered by a month grid, including spillover weeks. */
export function buildMonthDays(anchorDate: Date, weekStartsOn: 0 | 1): Date[] {
    const options = { weekStartsOn } as const;
    return eachDayOfInterval({
        start: startOfWeek(startOfMonth(anchorDate), options),
        end: endOfWeek(endOfMonth(anchorDate), options),
    });
}
