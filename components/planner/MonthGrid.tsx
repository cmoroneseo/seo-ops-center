'use client';

import { useEffect, useState } from 'react';
import {
    isSameMonth, isToday, isSameDay, format,
} from 'date-fns';
import { cn } from '@/lib/utils';
import {
    PlannerItem, plannerSourceLabel, plannerTimeLabel,
} from '@/lib/planner/items';
import { agendaItemsForDay, resolveMonthAgendaDay } from '@/lib/planner/responsive';
import { ACTUAL_STYLE, KIND_STYLES } from './EventCard';

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
    const [selectedDay, setSelectedDay] = useState(() =>
        resolveMonthAgendaDay(anchorDate, days));

    useEffect(() => {
        setSelectedDay(current => resolveMonthAgendaDay(anchorDate, days, current));
    }, [anchorDate, days]);

    const firstDay = days[0]?.getDay() ?? 0;
    const dayLabels = Array.from({ length: 7 }, (_, index) =>
        DAY_LABELS[(firstDay + index) % DAY_LABELS.length]);
    const agendaItems = agendaItemsForDay(items, selectedDay);

    const selectDay = (day: Date) => {
        setSelectedDay(day);
        if (window.matchMedia('(min-width: 640px)').matches) onDayClick?.(day);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="grid shrink-0 grid-cols-7 border-b border-border">
                {dayLabels.map(label => (
                    <div
                        key={label}
                        className="px-0.5 py-1.5 text-center text-[10px] uppercase tracking-wide text-muted-foreground sm:px-2 sm:py-2 sm:text-[11px]"
                    >
                        <span className="sm:hidden" aria-hidden="true">{label.slice(0, 1)}</span>
                        <span className="sr-only sm:not-sr-only">{label}</span>
                    </div>
                ))}
            </div>

            <div className="grid shrink-0 grid-cols-7 overflow-y-auto sm:min-h-0 sm:flex-1">
                {days.map(day => {
                    const dayItems = agendaItemsForDay(items, day);
                    const overflow = dayItems.length - MAX_VISIBLE;
                    const selected = isSameDay(day, selectedDay);
                    return (
                        <div
                            key={`${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`}
                            className={cn(
                                'min-h-14 border-b border-r border-border p-0.5 sm:min-h-[110px] sm:p-1.5',
                                !isSameMonth(day, anchorDate) && 'bg-muted/30',
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => selectDay(day)}
                                aria-label={`${format(day, 'EEEE, MMMM d')}, ${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}`}
                                aria-pressed={selected}
                                aria-current={isToday(day) ? 'date' : undefined}
                                className={cn(
                                    'flex min-h-12 w-full flex-col items-center justify-center rounded-md text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:mb-1 sm:min-h-6 sm:w-6',
                                    selected && 'bg-primary/10 ring-1 ring-primary/40 sm:ring-0',
                                    isToday(day) && 'bg-red-500 text-white',
                                    !isSameMonth(day, anchorDate) && !isToday(day) && 'text-muted-foreground',
                                )}
                            >
                                <span>{format(day, 'd')}</span>
                                {dayItems.length > 0 && (
                                    <span className="mt-1 flex max-w-full items-center justify-center gap-0.5 sm:hidden" aria-hidden="true">
                                        {dayItems.slice(0, MAX_VISIBLE).map(item => (
                                            <span
                                                key={item.id}
                                                className={cn(
                                                    'h-1.5 w-1.5 rounded-full',
                                                    item.source === 'actual_time'
                                                        ? ACTUAL_STYLE.accent
                                                        : KIND_STYLES[item.kind].accent,
                                                )}
                                            />
                                        ))}
                                        {overflow > 0 && <span className="ml-0.5 text-[9px] leading-none">+{overflow}</span>}
                                    </span>
                                )}
                            </button>

                            <div className="hidden space-y-0.5 sm:block">
                                {dayItems.slice(0, MAX_VISIBLE).map(item => (
                                    <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => onItemClick?.(item)}
                                        className={cn(
                                            'block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium',
                                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                            item.source === 'actual_time'
                                                ? ACTUAL_STYLE.card
                                                : KIND_STYLES[item.kind].card,
                                        )}
                                    >
                                        {item.title}
                                        {item.timerState === 'running' && ' · Running'}
                                        {item.timerState === 'paused' && ' · Paused'}
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

            <section
                className="min-h-0 flex-1 overflow-y-auto border-t border-border bg-card px-3 py-3 sm:hidden"
                aria-labelledby="month-agenda-heading"
                aria-live="polite"
            >
                <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h2 id="month-agenda-heading" className="text-sm font-semibold">
                        {format(selectedDay, 'EEEE, MMMM d')}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground">
                        {agendaItems.length} {agendaItems.length === 1 ? 'item' : 'items'}
                    </span>
                </div>

                {agendaItems.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
                        Nothing scheduled for this day.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {agendaItems.map(item => (
                            <button
                                type="button"
                                key={item.id}
                                onClick={() => onItemClick?.(item)}
                                className="flex min-h-11 w-full items-start gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <span className={cn(
                                    'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                                    item.source === 'actual_time'
                                        ? ACTUAL_STYLE.accent
                                        : KIND_STYLES[item.kind].accent,
                                )} />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-xs font-medium leading-snug">{item.title}</span>
                                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                        {plannerSourceLabel(item)} · {plannerTimeLabel(item)}
                                        {item.timerState === 'running' && ' · Running'}
                                        {item.timerState === 'paused' && ' · Paused'}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
