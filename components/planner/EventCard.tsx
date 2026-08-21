'use client';

import { format } from 'date-fns';
import { Pause, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEventKind } from '@/lib/types';
import { PlannerItem, plannerTimeLabel } from '@/lib/planner/items';
import {
    timerActionsForItem, type PlannerTimerAction,
} from '@/lib/planner/actual-items';
import {
    minutesToY, minutesSinceMidnight, durationMinutes, PX_PER_HOUR,
    staggerBounds, COMPACT_MAX_MINUTES,
} from '@/lib/planner/layout';

/** One place defines what each kind looks like. */
export const KIND_STYLES: Record<PlannerEventKind, { card: string; accent: string }> = {
    meeting: { card: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', accent: 'bg-blue-500' },
    focus:   { card: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', accent: 'bg-violet-500' },
    ooo:     { card: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', accent: 'bg-amber-500' },
    lunch:   { card: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', accent: 'bg-emerald-500' },
    event:   { card: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', accent: 'bg-sky-500' },
};

export const ACTUAL_STYLE = {
    card: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    accent: 'bg-emerald-500',
};

/**
 * While a card is being dragged, resized, or drawn it fills solid rather than
 * washing out — the block reads as a thing you are placing, not a hint.
 */
export const KIND_GHOST: Record<PlannerEventKind, string> = {
    meeting: 'bg-blue-500 text-white',
    focus:   'bg-violet-500 text-white',
    ooo:     'bg-amber-500 text-white',
    lunch:   'bg-emerald-500 text-white',
    event:   'bg-sky-500 text-white',
};

interface EventCardProps {
    item: PlannerItem;
    column: number;
    columnCount: number;
    startHour: number;
    /** Solid fill: this card is being dragged, resized, or drawn right now. */
    ghost?: boolean;
    onClick?: (item: PlannerItem) => void;
    onMoveStart?: (item: PlannerItem, e: React.PointerEvent) => void;
    onResizeStart?: (item: PlannerItem, edge: 'top' | 'bottom', e: React.PointerEvent) => void;
    /** Keyboard nudge in minutes (arrow keys); the mouse equivalent is a drag. */
    onKeyMove?: (item: PlannerItem, deltaMinutes: number) => void;
    onTimerAction?: (action: PlannerTimerAction, item: PlannerItem) => void;
    canControlTimer?: boolean;
}

export function EventCard({
    item, column, columnCount, startHour, ghost = false,
    onClick, onMoveStart, onResizeStart, onKeyMove, onTimerAction,
    canControlTimer = false,
}: EventCardProps) {
    const startMin = minutesSinceMidnight(item.startsAt);
    // Task timer controls need enough physical room to remain operable even
    // immediately after Start; timestamps and reported duration stay exact.
    const minimumMinutes = item.source === 'task' || item.source === 'actual_time' ? 30 : 15;
    const minutes = Math.max(minimumMinutes, durationMinutes(item.startsAt, item.endsAt));
    const top = minutesToY(startMin, startHour);
    const height = (minutes / 60) * PX_PER_HOUR;

    // Overlapping cards layer rather than tile: each is indented and runs to the
    // right edge, so the one beneath keeps its title readable on the left.
    const { leftPct, widthPct, zIndex } = staggerBounds(column, columnCount);
    const style: React.CSSProperties = {
        top,
        height,
        left: `${leftPct}%`,
        width: `calc(${widthPct}% - 4px)`,
        zIndex: ghost ? 30 : zIndex,
    };

    const styles = item.source === 'actual_time' ? ACTUAL_STYLE : KIND_STYLES[item.kind];
    // Too short for two lines — title and time share one row instead, which is
    // where the time is most worth showing.
    const isCompact = minutes <= COMPACT_MAX_MINUTES;

    // A ghost is a transient render of a card being placed — never a tab stop.
    const interactive = !ghost && Boolean(onClick);

    const timeLabel = plannerTimeLabel(item);
    const stateLabel = item.timerState === 'running'
        ? 'Running'
        : item.timerState === 'paused'
            ? 'Paused'
            : null;
    const timerActions = canControlTimer ? timerActionsForItem(item) : [];

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick?.(item);
            return;
        }
        // Nudge in 15-min steps — the keyboard equivalent of dragging.
        if (onKeyMove && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            onKeyMove(item, e.key === 'ArrowUp' ? -15 : 15);
        }
    };

    return (
        <div
            style={style}
            onPointerDown={e => onMoveStart?.(item, e)}
            className={cn(
                'group absolute overflow-hidden rounded-md border border-black/5 text-left',
                'focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1',
                onMoveStart && 'cursor-grab active:cursor-grabbing',
                ghost
                    // Lifted above the other cards and opaque, so it reads as the
                    // block you are placing rather than one of the ones already there.
                    ? cn('shadow-xl ring-2 ring-white/25', KIND_GHOST[item.kind])
                    : cn('shadow-sm transition-shadow hover:shadow-md', styles.card),
            )}
        >
            {!ghost && <div className={cn('absolute inset-y-0 left-0 w-0.5', styles.accent)} />}

            {interactive ? (
                <button
                    type="button"
                    onClick={() => onClick?.(item)}
                    onKeyDown={handleKeyDown}
                    aria-label={`${item.title}, ${timeLabel}${stateLabel ? `, ${stateLabel}` : ''}`}
                    className={cn(
                        'absolute inset-0 w-full text-left focus:outline-none',
                        isCompact ? 'px-1.5 py-0.5' : 'px-2 py-1',
                    )}
                >
                    {isCompact ? (
                        <div className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap pl-1">
                            <span className="truncate text-[11px] font-semibold leading-tight">{item.title}</span>
                            <span className="shrink-0 text-[10px] opacity-70">
                                {format(new Date(item.startsAt), 'h:mma').toLowerCase()}
                                {stateLabel && ` · ${stateLabel}`}
                            </span>
                        </div>
                    ) : (
                        <>
                            <div className="truncate text-[11px] font-semibold leading-tight">{item.title}</div>
                            <div className="truncate text-[10px] opacity-75">
                                {format(new Date(item.startsAt), 'h:mm')} – {format(new Date(item.endsAt), 'h:mm a')}
                            </div>
                            {stateLabel && (
                                <div className="truncate text-[10px] font-medium">{stateLabel}</div>
                            )}
                        </>
                    )}
                </button>
            ) : (
                <div className={isCompact ? 'px-1.5 py-0.5' : 'px-2 py-1'}>
                    <div className="truncate text-[11px] font-semibold leading-tight">{item.title}</div>
                    <div className="truncate text-[10px] opacity-75">
                        {format(new Date(item.startsAt), 'h:mm')} – {format(new Date(item.endsAt), 'h:mm a')}
                    </div>
                </div>
            )}

            {timerActions.length > 0 && (
                <div className="absolute bottom-1 right-1 z-10 hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 lg:flex">
                    {timerActions.map(action => {
                        const Icon = action === 'pause' ? Pause : action === 'stop' ? Square : Play;
                        const label = action === 'start'
                            ? 'Start Timer'
                            : `${action[0].toUpperCase()}${action.slice(1)} timer`;
                        return (
                            <button
                                type="button"
                                key={action}
                                aria-label={`${label} for ${item.title}`}
                                title={label}
                                onPointerDown={e => e.stopPropagation()}
                                onClick={e => {
                                    e.stopPropagation();
                                    onTimerAction?.(action, item);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-md border border-black/10 bg-card/95 text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <Icon className="h-3 w-3" />
                            </button>
                        );
                    })}
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
