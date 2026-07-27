'use client';

import { useEffect } from 'react';
import { isToday, isSameDay, format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
    PX_PER_HOUR, DEFAULT_START_HOUR, DEFAULT_END_HOUR,
    packOverlaps, minutesSinceMidnight, durationMinutes,
} from '@/lib/planner/layout';
import { PlannerItem } from '@/lib/planner/items';
import { TimeAxis } from './TimeAxis';
import { NowLine } from './NowLine';
import { EventCard } from './EventCard';
import { AllDayRow } from './AllDayRow';
import { usePlannerDrag, DragCommit } from '@/lib/planner/use-planner-drag';

export interface PlannerDragHandles {
    beginSchedule: (taskId: string, title: string, durationMin: number, e: React.PointerEvent) => void;
}

interface WeekGridProps {
    days: Date[];
    items: PlannerItem[];
    startHour?: number;
    endHour?: number;
    onItemClick?: (item: PlannerItem) => void;
    onCommit?: (commit: DragCommit) => void | Promise<void>;
    onCreate?: (dayIndex: number, startMin: number, endMin: number) => void;
    /** Hands the sidebar a way to start a backlog-task drag. */
    onDragHandlesReady?: (handles: PlannerDragHandles) => void;
}

/** Build an ISO timestamp from a day plus a minute offset. */
function isoAt(day: Date, minutes: number): string {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(minutes);
    return d.toISOString();
}

export function WeekGrid({
    days,
    items,
    startHour = DEFAULT_START_HOUR,
    endHour = DEFAULT_END_HOUR,
    onItemClick,
    onCommit,
    onCreate,
    onDragHandlesReady,
}: WeekGridProps) {
    const bodyHeight = (endHour - startHour) * PX_PER_HOUR;
    const hourLines = Array.from({ length: endHour - startHour }, (_, i) => i);

    const timedItems = items.filter(i => !i.allDay);

    const { preview, beginMove, beginResize, beginCreate, beginSchedule, gridRef } = usePlannerDrag({
        days,
        startHour,
        onCommit: onCommit ?? (() => {}),
        onCreate,
    });

    useEffect(() => {
        onDragHandlesReady?.({ beginSchedule });
    }, [onDragHandlesReady, beginSchedule]);

    // The item under the cursor is pulled out of normal flow and drawn as a
    // ghost in whichever column the pointer is over — including a different day
    // than the one it is persisted in.
    const draggedItem = preview ? timedItems.find(i => i.id === preview.itemId) : undefined;
    const previewDay = preview ? days[preview.dayIndex] : undefined;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Day headers */}
            <div className="flex border-b border-border">
                <div className="w-16 shrink-0 border-r border-border" />
                {days.map(day => (
                    <div key={day.toISOString()} className="flex-1 px-2 py-2 text-center">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {format(day, 'EEE')}
                        </div>
                        <div
                            className={cn(
                                'mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
                                isToday(day) && 'bg-red-500 text-white',
                            )}
                        >
                            {format(day, 'd')}
                        </div>
                    </div>
                ))}
            </div>

            <AllDayRow days={days} items={items} onItemClick={onItemClick} />

            {/* Scrollable time body */}
            <div ref={gridRef} className="flex min-h-0 flex-1 overflow-y-auto">
                <TimeAxis startHour={startHour} endHour={endHour} />
                {days.map(day => {
                    const dayItems = timedItems.filter(i =>
                        isSameDay(new Date(i.startsAt), day) && i.id !== draggedItem?.id);
                    const showsGhost = Boolean(
                        preview && draggedItem && previewDay && isSameDay(previewDay, day));
                    return (
                        <div
                            key={day.toISOString()}
                            className="relative flex-1 border-r border-border last:border-r-0"
                            style={{ height: bodyHeight }}
                            data-day={day.toISOString()}
                            onPointerDown={e => {
                                // Blank space only — cards stop propagation themselves.
                                const el = e.target as HTMLElement;
                                if (e.target === e.currentTarget || el.dataset.hourLine) {
                                    beginCreate(e);
                                }
                            }}
                        >
                            {hourLines.map(i => (
                                <div
                                    key={i}
                                    data-hour-line="1"
                                    className="border-b border-border/50"
                                    style={{ height: PX_PER_HOUR }}
                                />
                            ))}
                            {isToday(day) && <NowLine startHour={startHour} />}

                            {packOverlaps(
                                dayItems.map(i => ({
                                    id: i.id,
                                    startMin: minutesSinceMidnight(i.startsAt),
                                    endMin: minutesSinceMidnight(i.startsAt)
                                        + Math.max(15, durationMinutes(i.startsAt, i.endsAt)),
                                    item: i,
                                })),
                            ).map(({ item: packed, column, columnCount }) => (
                                <EventCard
                                    key={packed.id}
                                    item={packed.item}
                                    column={column}
                                    columnCount={columnCount}
                                    startHour={startHour}
                                    onClick={onItemClick}
                                    onMoveStart={beginMove}
                                    onResizeStart={beginResize}
                                />
                            ))}

                            {showsGhost && preview && draggedItem && previewDay && (
                                <EventCard
                                    item={{
                                        ...draggedItem,
                                        startsAt: isoAt(previewDay, preview.startMin),
                                        endsAt: isoAt(previewDay, preview.endMin),
                                    }}
                                    column={0}
                                    columnCount={1}
                                    startHour={startHour}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
