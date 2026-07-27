'use client';

import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerEventKind } from '@/lib/types';
import { PlannerItem } from '@/lib/planner/items';
import { minutesToY, minutesSinceMidnight, durationMinutes, PX_PER_HOUR } from '@/lib/planner/layout';

/** One place defines what each kind looks like. */
export const KIND_STYLES: Record<PlannerEventKind, { card: string; accent: string }> = {
    meeting: { card: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', accent: 'bg-blue-500' },
    focus:   { card: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', accent: 'bg-violet-500' },
    ooo:     { card: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', accent: 'bg-amber-500' },
    lunch:   { card: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', accent: 'bg-emerald-500' },
    event:   { card: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', accent: 'bg-sky-500' },
};

interface EventCardProps {
    item: PlannerItem;
    column: number;
    columnCount: number;
    startHour: number;
    onClick?: (item: PlannerItem) => void;
    onMoveStart?: (item: PlannerItem, e: React.PointerEvent) => void;
    onResizeStart?: (item: PlannerItem, edge: 'top' | 'bottom', e: React.PointerEvent) => void;
}

export function EventCard({
    item, column, columnCount, startHour, onClick, onMoveStart, onResizeStart,
}: EventCardProps) {
    const startMin = minutesSinceMidnight(item.startsAt);
    const minutes = Math.max(15, durationMinutes(item.startsAt, item.endsAt));
    const top = minutesToY(startMin, startHour);
    const height = (minutes / 60) * PX_PER_HOUR;

    // Stacked cards inset slightly rather than tiling edge to edge.
    const widthPct = 100 / columnCount;
    const style: React.CSSProperties = {
        top,
        height,
        left: `${column * widthPct}%`,
        width: `calc(${widthPct}% - 4px)`,
    };

    const styles = KIND_STYLES[item.kind];
    const isShort = minutes < 45;

    return (
        <div
            style={style}
            onPointerDown={e => onMoveStart?.(item, e)}
            onClick={() => onClick?.(item)}
            className={cn(
                'absolute z-10 overflow-hidden rounded-md border border-black/5 px-2 py-1 text-left shadow-sm',
                'transition-shadow hover:shadow-md',
                onMoveStart && 'cursor-grab active:cursor-grabbing',
                styles.card,
            )}
        >
            <div className={cn('absolute inset-y-0 left-0 w-0.5', styles.accent)} />
            <div className={cn('truncate text-[11px] font-semibold leading-tight', isShort && 'text-[10px]')}>
                {item.title}
            </div>
            {!isShort && (
                <div className="truncate text-[10px] opacity-75">
                    {format(new Date(item.startsAt), 'h:mm')} – {format(new Date(item.endsAt), 'h:mm a')}
                </div>
            )}

            {onResizeStart && (
                <>
                    <div
                        onPointerDown={e => { e.stopPropagation(); onResizeStart(item, 'top', e); }}
                        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                    />
                    <div
                        onPointerDown={e => { e.stopPropagation(); onResizeStart(item, 'bottom', e); }}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    />
                </>
            )}
        </div>
    );
}
