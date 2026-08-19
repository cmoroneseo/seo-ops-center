'use client';

import {
    isSameMonth, isToday, isSameDay, format,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerItem } from '@/lib/planner/items';
import { KIND_STYLES } from './EventCard';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE = 3;

interface MonthGridProps {
    anchorDate: Date;
    days: Date[];
    items: PlannerItem[];
    onItemClick?: (item: PlannerItem) => void;
    onDayClick?: (day: Date) => void;
}

export function MonthGrid({ anchorDate, days, items, onItemClick, onDayClick }: MonthGridProps) {
    const firstDay = days[0]?.getDay() ?? 0;
    const dayLabels = Array.from({ length: 7 }, (_, index) =>
        DAY_LABELS[(firstDay + index) % DAY_LABELS.length]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid grid-cols-7 border-b border-border">
                {dayLabels.map(label => (
                    <div
                        key={label}
                        className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground"
                    >
                        {label}
                    </div>
                ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto">
                {days.map(day => {
                    const dayItems = items.filter(i => isSameDay(new Date(i.startsAt), day));
                    const overflow = dayItems.length - MAX_VISIBLE;
                    return (
                        <div
                            key={day.toISOString()}
                            onClick={() => onDayClick?.(day)}
                            className={cn(
                                'min-h-[110px] border-b border-r border-border p-1.5',
                                !isSameMonth(day, anchorDate) && 'bg-muted/30',
                            )}
                        >
                            <div
                                className={cn(
                                    'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                                    isToday(day) && 'bg-red-500 text-white',
                                    !isSameMonth(day, anchorDate) && 'text-muted-foreground',
                                )}
                            >
                                {format(day, 'd')}
                            </div>

                            <div className="space-y-0.5">
                                {dayItems.slice(0, MAX_VISIBLE).map(item => (
                                    <button
                                        key={item.id}
                                        onClick={e => { e.stopPropagation(); onItemClick?.(item); }}
                                        className={cn(
                                            'block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium',
                                            KIND_STYLES[item.kind].card,
                                        )}
                                    >
                                        {item.title}
                                    </button>
                                ))}
                                {overflow > 0 && (
                                    <div className="px-1 text-[10px] text-muted-foreground">
                                        +{overflow} more
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
