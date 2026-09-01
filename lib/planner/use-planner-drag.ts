'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannerEventKind } from '../types';
import { PlannerItem, PlannerItemSource } from './items';
import {
    clampMinutes,
    minutesSinceMidnight,
    durationMinutes,
    resolvePointer,
    resolveSchedulePointer,
    shouldCommitSchedule,
    isOutsideGrid,
    plannerTaskDropTarget,
    type PlannerTaskDropTarget,
    MIN_EVENT_MINUTES,
} from './layout';

export interface DragCommit {
    itemId: string;
    source: PlannerItemSource;
    startsAt: string;
    endsAt: string;
}

export interface DragPreview {
    itemId: string;
    startMin: number;
    endMin: number;
    dayIndex: number;
    /**
     * What the ghost should say and how it should be coloured. Carried here
     * because a create- or backlog-drag has no card on the grid to copy from.
     */
    label: string;
    kind: PlannerEventKind;
}

type DragState =
    | { mode: 'idle' }
    | { mode: 'move'; item: PlannerItem; grabOffsetMin: number; durationMin: number }
    | { mode: 'resize'; item: PlannerItem; edge: 'top' | 'bottom' }
    | { mode: 'create'; dayIndex: number; anchorMin: number }
    | {
        mode: 'schedule';
        taskId: string;
        title: string;
        durationMin: number;
        originX: number;
        originY: number;
    };

interface Options {
    days: Date[];
    startHour: number;
    onCommit: (commit: DragCommit) => void | Promise<void>;
    onCreate?: (dayIndex: number, startMin: number, endMin: number) => void;
    /** A scheduled task dropped on an explicit rail target leaves the grid. */
    onUnschedule?: (itemId: string, target: PlannerTaskDropTarget) => void | Promise<unknown>;
    onDropTargetChange?: (target: PlannerTaskDropTarget | null) => void;
}

/** Combine a calendar day with a minute offset into an ISO timestamp. */
function toIso(day: Date, minutes: number): string {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(minutes);
    return d.toISOString();
}

/**
 * Every planner gesture — move, resize, create, schedule — funnels through this
 * hook so they share one snapping rule and one pixel->time conversion. Pointer
 * capture keeps the drag alive when the cursor leaves the card.
 */
export function usePlannerDrag({
    days, startHour, onCommit, onCreate, onUnschedule, onDropTargetChange,
}: Options) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<DragState>({ mode: 'idle' });
    // The ref is the source of truth for where the drag currently is; the state
    // exists only to trigger a re-render of the ghost. handleUp must never
    // depend on React having re-rendered before pointerup arrives.
    const previewRef = useRef<DragPreview | null>(null);
    const [preview, setPreviewState] = useState<DragPreview | null>(null);
    const setPreview = useCallback((next: DragPreview | null) => {
        previewRef.current = next;
        setPreviewState(next);
    }, []);
    // A real mouse drag ends with pointerup AND a click. Without this flag the
    // detail panel would open every time a card is dropped.
    const draggedRef = useRef(false);
    const dropTargetRef = useRef<PlannerTaskDropTarget | null>(null);

    const setDropTarget = useCallback((target: PlannerTaskDropTarget | null) => {
        if (dropTargetRef.current === target) return;
        dropTargetRef.current = target;
        onDropTargetChange?.(target);
    }, [onDropTargetChange]);

    const dropTargetAt = useCallback((e: PointerEvent) => {
        if (typeof document === 'undefined') return null;
        return plannerTaskDropTarget(
            document.elementsFromPoint(e.clientX, e.clientY)
                .map(element => element.getAttribute('data-planner-task-drop-target')),
        );
    }, []);

    /** Pointer position -> { dayIndex, minutes } in grid space. Math lives in layout.ts. */
    const resolve = useCallback((e: PointerEvent | React.PointerEvent) => {
        const grid = gridRef.current;
        if (!grid) return null;
        const rect = grid.getBoundingClientRect();
        return resolvePointer({
            clientX: e.clientX,
            clientY: e.clientY,
            rect: { left: rect.left, top: rect.top, width: rect.width },
            scrollTop: grid.scrollTop,
            dayCount: days.length,
            startHour,
        });
    }, [days.length, startHour]);

    /** Was the drop outside the grid? That is the gesture for "unschedule". */
    const droppedOutside = useCallback((e: PointerEvent) => {
        const grid = gridRef.current;
        if (!grid) return false;
        const rect = grid.getBoundingClientRect();
        return isOutsideGrid({
            clientX: e.clientX,
            clientY: e.clientY,
            rect: { left: rect.left, top: rect.top, width: rect.width },
            height: rect.height,
        });
    }, []);

    const resolveSchedule = useCallback((
        e: PointerEvent,
        state: Extract<DragState, { mode: 'schedule' }>,
    ) => {
        const grid = gridRef.current;
        if (!grid) return null;
        const rect = grid.getBoundingClientRect();
        return resolveSchedulePointer({
            clientX: e.clientX,
            clientY: e.clientY,
            originX: state.originX,
            originY: state.originY,
            rect: { left: rect.left, top: rect.top, width: rect.width },
            height: rect.height,
            scrollTop: grid.scrollTop,
            dayCount: days.length,
            startHour,
        });
    }, [days.length, startHour]);

    const canCommitSchedule = useCallback((e: PointerEvent, hasPreview: boolean) => {
        const grid = gridRef.current;
        if (!grid) return false;
        const rect = grid.getBoundingClientRect();
        return shouldCommitSchedule({
            hasPreview,
            clientX: e.clientX,
            clientY: e.clientY,
            rect: { left: rect.left, top: rect.top, width: rect.width },
            height: rect.height,
        });
    }, []);

    const beginMove = useCallback((item: PlannerItem, e: React.PointerEvent) => {
        // Reset before the draggable check: every card press starts here, so this
        // is what keeps a stale flag from swallowing an unrelated later click.
        draggedRef.current = false;
        setDropTarget(null);
        if (!item.draggable) return;
        const at = resolve(e);
        if (!at) return;
        const startMin = minutesSinceMidnight(item.startsAt);
        stateRef.current = {
            mode: 'move',
            item,
            grabOffsetMin: at.minutes - startMin,
            durationMin: Math.max(MIN_EVENT_MINUTES, durationMinutes(item.startsAt, item.endsAt)),
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
    }, [resolve, setDropTarget]);

    const beginResize = useCallback((item: PlannerItem, edge: 'top' | 'bottom', e: React.PointerEvent) => {
        draggedRef.current = false;
        if (!item.draggable) return;
        stateRef.current = { mode: 'resize', item, edge };
        (e.target as Element).setPointerCapture?.(e.pointerId);
    }, []);

    const beginCreate = useCallback((e: React.PointerEvent) => {
        const at = resolve(e);
        if (!at) return;
        stateRef.current = { mode: 'create', dayIndex: at.dayIndex, anchorMin: at.minutes };
        setPreview({
            itemId: '__new__',
            startMin: at.minutes,
            endMin: at.minutes,
            dayIndex: at.dayIndex,
            label: 'New event',
            kind: 'event',
        });
    }, [resolve, setPreview]);

    const beginSchedule = useCallback((
        taskId: string, title: string, durationMin: number, e: React.PointerEvent,
    ) => {
        draggedRef.current = false;
        setPreview(null);
        stateRef.current = {
            mode: 'schedule',
            taskId,
            title,
            durationMin,
            originX: e.clientX,
            originY: e.clientY,
        };
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    }, [setPreview]);

    // Global listeners: the pointer routinely leaves the element it started on.
    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            const state = stateRef.current;
            if (state.mode === 'idle') return;
            setDropTarget(
                state.mode === 'move' && state.item.source === 'task'
                    ? dropTargetAt(e)
                    : null,
            );
            const at = state.mode === 'schedule' ? resolveSchedule(e, state) : resolve(e);
            if (!at) return;
            draggedRef.current = true;

            if (state.mode === 'move') {
                const startMin = clampMinutes(at.minutes - state.grabOffsetMin);
                setPreview({
                    itemId: state.item.id,
                    startMin,
                    endMin: clampMinutes(startMin + state.durationMin),
                    dayIndex: at.dayIndex,
                    label: state.item.title,
                    kind: state.item.kind,
                });
            } else if (state.mode === 'resize') {
                const startMin = minutesSinceMidnight(state.item.startsAt);
                const endMin = startMin + durationMinutes(state.item.startsAt, state.item.endsAt);
                const dayIndex = days.findIndex(d =>
                    new Date(d).toDateString() === new Date(state.item.startsAt).toDateString());
                const next = state.edge === 'top'
                    ? { startMin: Math.min(at.minutes, endMin - MIN_EVENT_MINUTES), endMin }
                    : { startMin, endMin: Math.max(at.minutes, startMin + MIN_EVENT_MINUTES) };
                setPreview({
                    itemId: state.item.id,
                    ...next,
                    dayIndex: Math.max(0, dayIndex),
                    label: state.item.title,
                    kind: state.item.kind,
                });
            } else if (state.mode === 'create') {
                const lo = Math.min(state.anchorMin, at.minutes);
                const hi = Math.max(state.anchorMin, at.minutes);
                setPreview({
                    itemId: '__new__',
                    startMin: lo,
                    endMin: hi,
                    dayIndex: state.dayIndex,
                    label: 'New event',
                    kind: 'event',
                });
            } else if (state.mode === 'schedule') {
                setPreview({
                    itemId: `task:${state.taskId}`,
                    startMin: at.minutes,
                    endMin: clampMinutes(at.minutes + state.durationMin),
                    dayIndex: at.dayIndex,
                    label: state.title,
                    // Scheduled tasks render as focus blocks, same as on the grid.
                    kind: 'focus',
                });
            }
        };

        const handleUp = (e: PointerEvent) => {
            const state = stateRef.current;
            const current = previewRef.current;
            const dropTarget = dropTargetRef.current;
            stateRef.current = { mode: 'idle' };
            setPreview(null);
            setDropTarget(null);
            if (state.mode === 'idle') return;
            if (state.mode === 'schedule' && !canCommitSchedule(e, Boolean(current))) return;

            if (state.mode === 'move' && state.item.source === 'task' && dropTarget) {
                void onUnschedule?.(state.item.id, dropTarget);
                return;
            }

            if (!current || droppedOutside(e)) return;

            const day = days[current.dayIndex];
            if (!day) return;

            if (state.mode === 'create') {
                // A drag shorter than the snap increment reads as a click.
                const span = Math.max(current.endMin - current.startMin, 0);
                const endMin = span < MIN_EVENT_MINUTES ? current.startMin + 60 : current.endMin;
                onCreate?.(current.dayIndex, current.startMin, clampMinutes(endMin));
                return;
            }

            if (state.mode === 'schedule') {
                void onCommit({
                    itemId: `task:${state.taskId}`,
                    source: 'task',
                    startsAt: toIso(day, current.startMin),
                    endsAt: toIso(day, Math.max(current.endMin, current.startMin + MIN_EVENT_MINUTES)),
                });
                return;
            }

            void onCommit({
                itemId: state.item.id,
                source: state.item.source,
                startsAt: toIso(day, current.startMin),
                endsAt: toIso(day, Math.max(current.endMin, current.startMin + MIN_EVENT_MINUTES)),
            });
        };

        const abort = () => {
            stateRef.current = { mode: 'idle' };
            draggedRef.current = false;
            setPreview(null);
            setDropTarget(null);
        };

        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') abort();
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', abort);
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', abort);
            window.removeEventListener('keydown', handleKey);
            setDropTarget(null);
        };
    }, [
        days, resolve, resolveSchedule, canCommitSchedule, droppedOutside, dropTargetAt,
        onCommit, onCreate, onUnschedule, setDropTarget, setPreview,
    ]);

    /**
     * True exactly once after a gesture that actually moved, so the caller can
     * swallow the synthetic click that follows pointerup.
     */
    const consumeDragClick = useCallback(() => {
        const dragged = draggedRef.current;
        draggedRef.current = false;
        return dragged;
    }, []);

    return { preview, beginMove, beginResize, beginCreate, beginSchedule, consumeDragClick, gridRef };
}
