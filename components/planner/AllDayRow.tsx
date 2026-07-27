'use client';

import { isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerItem } from '@/lib/planner/items';
import { KIND_STYLES } from './EventCard';

interface AllDayRowProps {
    days: Date[];
    items: PlannerItem[];
    onItemClick?: (item: PlannerItem) => void;
}

/** OOO blocks, all-day events, and reminder chips. */
export function AllDayRow({ days, items, onItemClick }: AllDayRowProps) {
    const allDay = items.filter(i => i.allDay);

    return (
        <div className="flex border-b border-border">
            <div className="flex w-16 shrink-0 items-center justify-end border-r border-border pr-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    All day
                </span>
            </div>
            {days.map(day => {
                const dayItems = allDay.filter(i => isSameDay(new Date(i.startsAt), day));
                return (
                    <div
                        key={day.toISOString()}
                        className="min-h-[28px] flex-1 space-y-0.5 border-r border-border p-1 last:border-r-0"
                    >
                        {dayItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => onItemClick?.(item)}
                                className={cn(
                                    'block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium',
                                    KIND_STYLES[item.kind].card,
                                )}
                            >
                                {item.title}
                            </button>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
