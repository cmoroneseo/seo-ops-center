'use client';

import { useEffect } from 'react';
import { isToday, isSameDay, isWeekend, format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
    PX_PER_HOUR, DEFAULT_START_HOUR, DEFAULT_END_HOUR,
    packOverlaps, minutesSinceMidnight, durationMinutes, isWorkMinute,
} from '@/lib/planner/layout';
import type { PlannerEventKind } from '@/lib/types';
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
    /** Hours outside this range are shaded as off-hours. */
    workStartHour?: number;
    workEndHour?: number;
    onItemClick?: (item: PlannerItem) => void;
    onCommit?: (commit: DragCommit) => void | Promise<void>;
    onCreate?: (dayIndex: number, startMin: number, endMin: number) => void;
    onUnschedule?: (itemId: string) => void | Promise<void>;
    /**
     * A block that has been drawn but not saved yet — it stays on the grid,
     * filled, while the quick-create popover collects the details.
     */
    pendingBlock?: { startsAt: string; endsAt: string; label: string; kind: PlannerEventKind } | null;
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
    workStartHour = 9,
    workEndHour = 17,
    onItemClick,
    onCommit,
    onCreate,
    onUnschedule,
    pendingBlock,
    onDragHandlesReady,
}: WeekGridProps) {
    const bodyHeight = (endHour - startHour) * PX_PER_HOUR;
    // One entry per hour row, carrying the hour it represents so the row can be
    // shaded when it falls outside the working day.
    const hourRows = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);

    const timedItems = items.filter(i => !i.allDay);

    const {
        preview, beginMove, beginResize, beginCreate, beginSchedule, consumeDragClick, gridRef,
    } = usePlannerDrag({
        days,
        startHour,
        onCommit: onCommit ?? (() => {}),
        onCreate,
        onUnschedule,
    });

    // pointerup after a drag is followed by a click; opening the detail panel
    // there would make every drop pop the panel.
    const handleCardClick = (item: PlannerItem) => {
        if (consumeDragClick()) return;
        onItemClick?.(item);
    };

    // Arrow-key nudge: shift the block by whole minutes, clamped to the day, and
    // commit it exactly as a drag would. The keyboard path for moving a block.
    const handleKeyMove = (item: PlannerItem, deltaMinutes: number) => {
        if (!item.draggable || !onCommit) return;
        const startMs = new Date(item.startsAt).getTime() + deltaMinutes * 60_000;
        const dayStart = new Date(item.startsAt);
        dayStart.setHours(0, 0, 0, 0);
        const durationMs = new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime();
        // Keep the whole block inside its day.
        const lower = dayStart.getTime();
        const upper = lower + 24 * 60 * 60_000 - durationMs;
        const clamped = Math.min(upper, Math.max(lower, startMs));
        void onCommit({
            itemId: item.id,
            source: item.source,
            startsAt: new Date(clamped).toISOString(),
            endsAt: new Date(clamped + durationMs).toISOString(),
        });
    };

    useEffect(() => {
        onDragHandlesReady?.({ beginSchedule });
    }, [onDragHandlesReady, beginSchedule]);

    // The card under the cursor is pulled out of normal flow and drawn as a
    // solid ghost in whichever column the pointer is over — including a day it
    // is not persisted in. Built from the preview alone, because a create- or
    // backlog-drag has no card on the grid to copy.
    const draggedItem = preview ? timedItems.find(i => i.id === preview.itemId) : undefined;
    const previewDay = preview ? days[preview.dayIndex] : undefined;

    const ghostItem: PlannerItem | null = preview && previewDay
        ? {
            id: `${preview.itemId}:ghost`,
            source: draggedItem?.source ?? 'event',
            title: preview.label,
            startsAt: isoAt(previewDay, preview.startMin),
            endsAt: isoAt(previewDay, preview.endMin),
            allDay: false,
            kind: preview.kind,
            attendeeIds: [],
            draggable: false,
            raw: draggedItem?.raw ?? ({} as PlannerItem['raw']),
        }
        : null;

    // Same solid treatment as the drag ghost, held until the popover resolves.
    const pendingItem: PlannerItem | null = pendingBlock
        ? {
            id: 'pending:block',
            source: 'event',
            title: pendingBlock.label,
            startsAt: pendingBlock.startsAt,
            endsAt: pendingBlock.endsAt,
            allDay: false,
            kind: pendingBlock.kind,
            attendeeIds: [],
            draggable: false,
            raw: {} as PlannerItem['raw'],
        }
        : null;

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
                    const showsGhost = Boolean(ghostItem && previewDay && isSameDay(previewDay, day));
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
                            {hourRows.map(hour => {
                                const offHours =
                                    isWeekend(day) || !isWorkMinute(hour * 60, workStartHour, workEndHour);
                                return (
                                    <div
                                        key={hour}
                                        data-hour-line="1"
                                        className={cn(
                                            'border-b border-border/50',
                                            // Reads as "dimmed" against either theme; bg-muted
                                            // is nearly invisible on the dark grid.
                                            offHours && 'bg-black/[0.06] dark:bg-black/25',
                                        )}
                                        style={{ height: PX_PER_HOUR }}
                                    />
                                );
                            })}
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
                                    onClick={handleCardClick}
                                    onMoveStart={beginMove}
                                    onResizeStart={beginResize}
                                    onKeyMove={handleKeyMove}
                                />
                            ))}

                            {showsGhost && ghostItem && (
                                <EventCard
                                    item={ghostItem}
                                    column={0}
                                    columnCount={1}
                                    startHour={startHour}
                                    ghost
                                />
                            )}

                            {pendingItem && isSameDay(new Date(pendingItem.startsAt), day) && (
                                <EventCard
                                    item={pendingItem}
                                    column={0}
                                    columnCount={1}
                                    startHour={startHour}
                                    ghost
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
