'use client';

import { useState } from 'react';
import { isSameDay } from 'date-fns';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerItem } from '@/lib/planner/items';
import { KIND_STYLES } from './EventCard';

/**
 * How many chips a day shows before collapsing. Overdue roll-forward can pile a
 * dozen items onto today, and an uncapped row eats the grid.
 */
const COLLAPSED_PER_DAY = 2;

interface AllDayRowProps {
    days: Date[];
    items: PlannerItem[];
    onItemClick?: (item: PlannerItem) => void;
}

/** OOO blocks, all-day events, reminder chips, and rolled-forward overdue work. */
export function AllDayRow({ days, items, onItemClick }: AllDayRowProps) {
    const [expanded, setExpanded] = useState(false);
    const allDay = items.filter(i => i.allDay);

    const byDay = days.map(day => allDay.filter(i => isSameDay(new Date(i.startsAt), day)));
    const busiest = byDay.reduce((max, d) => Math.max(max, d.length), 0);
    const hasOverflow = busiest > COLLAPSED_PER_DAY;

    return (
        <div className="flex border-b border-border">
            <div className="flex w-16 shrink-0 items-start justify-end gap-1 border-r border-border py-1 pr-2">
                {hasOverflow && (
                    <button
                        onClick={() => setExpanded(e => !e)}
                        aria-label={expanded ? 'Collapse all-day events' : 'Expand all-day events'}
                        aria-expanded={expanded}
                        className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
                    </button>
                )}
                <span className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    All day
                </span>
            </div>

            {days.map((day, i) => {
                const dayItems = byDay[i];
                const shown = expanded ? dayItems : dayItems.slice(0, COLLAPSED_PER_DAY);
                const hidden = dayItems.length - shown.length;
                return (
                    <div
                        key={day.toISOString()}
                        className={cn(
                            'min-h-[28px] flex-1 space-y-0.5 border-r border-border p-1 last:border-r-0',
                            expanded && 'max-h-40 overflow-y-auto',
                        )}
                    >
                        {shown.map(item => (
                            <button
                                key={item.id}
                                onClick={() => onItemClick?.(item)}
                                title={item.title}
                                className={cn(
                                    'block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium',
                                    KIND_STYLES[item.kind].card,
                                )}
                            >
                                {item.title}
                            </button>
                        ))}

                        {hidden > 0 && (
                            <button
                                onClick={() => setExpanded(true)}
                                className="block w-full rounded px-1.5 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                                +{hidden} more
                            </button>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
