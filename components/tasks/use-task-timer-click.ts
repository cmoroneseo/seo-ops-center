'use client';

import { useRef, useState } from 'react';
import { useTimer } from '@/components/providers/timer-provider';
import { attemptForPlanTask, planRowTimerView } from '@/lib/seo-plan/row-timer';
import { RESUMED_OPEN_TIMER_MESSAGE, REVIEWING_TIMER_MESSAGE } from '@/lib/timer/attempt-state';

export interface TaskTimerTarget {
    id: string;
    title: string;
    clientId?: string;
    projectId?: string;
    clientName?: string;
}

/**
 * One in-flight play click per view.
 * A second click while the first request is out does not start another entry.
 */
export function useTaskTimerClick() {
    const timer = useTimer();
    const pendingRef = useRef<string | null>(null);
    const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const onTimer = async (task: TaskTimerTarget, trackedTaskId = task.id) => {
        if (pendingRef.current) return;
        pendingRef.current = trackedTaskId;
        setPendingTaskId(trackedTaskId);
        setNotice(null);
        try {
            const view = planRowTimerView(
                trackedTaskId,
                timer.runningTimer,
                timer.pausedTimers,
                timer.getElapsedSeconds,
            );
            const attempt = attemptForPlanTask(trackedTaskId, timer.runningTimer, timer.pausedTimers);
            if (view.phase === 'running' && attempt) {
                await timer.pause(attempt);
                return;
            }
            if (view.phase === 'reviewing') {
                setNotice(REVIEWING_TIMER_MESSAGE);
                return;
            }
            if (view.phase === 'paused' && attempt) {
                const ok = await timer.resume(attempt);
                if (ok) setNotice(RESUMED_OPEN_TIMER_MESSAGE);
                return;
            }
            if (!(task.clientId || task.projectId)) return;
            await timer.startTask({
                clientId: task.clientId ?? task.projectId ?? '',
                clientName: task.clientName ?? 'Unknown',
                taskId: trackedTaskId,
                taskTitle: task.title,
            });
        } catch (error) {
            setNotice(error instanceof Error ? error.message : 'Unable to update the timer.');
        } finally {
            pendingRef.current = null;
            setPendingTaskId(null);
        }
    };

    return {
        pendingTaskId,
        notice,
        onTimer,
        runningTimer: timer.runningTimer,
        pausedTimers: timer.pausedTimers,
        getElapsedSeconds: timer.getElapsedSeconds,
    };
}
