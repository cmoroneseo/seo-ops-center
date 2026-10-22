'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOrganization } from './organization-provider';
import { getClientTimesheetSyncEnabled, getOpenTimerAttempts, mutateTimer, updateSessionNotes } from '@/lib/supabase/time-logs';
import type { SessionNote, TimerAttempt } from '@/lib/types';
import type { TimerMutationRequest, TimerStateResponse } from '@/lib/timer/contracts';
import { startTimerMutation } from '@/lib/timer/backdated-start';
import { updateTask } from '@/lib/supabase/tasks';
import { trackedBlockMinutes } from '@/lib/planner/timer-sync';
import {
    confirmAndSwitchTimer,
    finalizeTimerAttempt,
    findTimerAttempt,
    resolveTaskStart,
    timerRefreshEvents,
    timerUiStateFromResponse,
    totalAttemptActiveSeconds,
    type TimerSwitchConfirmation,
    type TimerSwitchTarget,
} from '@/lib/timer-ui';

export { timerSwitchPrompt } from '@/lib/timer-ui';

export interface StartTaskOptions {
    clientId?: string;
    clientName: string;
    taskId?: string;
    taskTitle?: string;
    plannerEventId?: string;
    countsTowardBudget?: boolean;
    /** Optional ISO instant for a timer that began earlier today. */
    startedAt?: string;
}

export interface FinalizeTimerOptions {
    description: string;
    billable: boolean;
    countsTowardBudget?: boolean;
    syncToBasecamp?: boolean;
    markTaskComplete?: boolean;
    /** Completion instant chosen before the timer was stopped. */
    completedAt?: string;
}

export type { TimerSwitchConfirmation } from '@/lib/timer-ui';

export interface ResumeTimerOptions {
    /** A cancelled stop review. resume_time_attempt clears reviewing_at and opens a segment. */
    continueReview?: boolean;
}

function confirmInBrowser(prompt: string): boolean {
    return window.confirm(prompt);
}

interface TimerContextType {
    runningTimer: TimerAttempt | null;
    pausedTimers: TimerAttempt[];
    getElapsedSeconds: (attempt: TimerAttempt) => number;
    startTask: (options: StartTaskOptions, confirmSwitch?: TimerSwitchConfirmation) => Promise<boolean>;
    pause: (attempt: TimerAttempt) => Promise<void>;
    resume: (attempt: TimerAttempt, confirmSwitch?: TimerSwitchConfirmation, options?: ResumeTimerOptions) => Promise<boolean>;
    switchToTask: (target: TimerSwitchTarget, confirmSwitch?: TimerSwitchConfirmation) => Promise<boolean>;
    beginStop: (attempt: TimerAttempt) => Promise<TimerStateResponse | null>;
    finalize: (attempt: TimerAttempt, options: FinalizeTimerOptions) => Promise<TimerStateResponse>;
    discard: (attempt: TimerAttempt) => Promise<void>;
    addNote: (attemptId: string, text: string) => Promise<void>;
    editNote: (attemptId: string, noteId: string, text: string) => Promise<void>;
    deleteNote: (attemptId: string, noteId: string) => Promise<void>;
    getAttemptById: (attemptId: string) => TimerAttempt | null;
}

export const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function TimerProvider({ children }: { children: React.ReactNode }) {
    const { organization } = useOrganization();
    const [runningTimer, setRunningTimer] = useState<TimerAttempt | null>(null);
    const [pausedTimers, setPausedTimers] = useState<TimerAttempt[]>([]);
    const [clockNow, setClockNow] = useState(() => Date.now());
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    const applyTimerState = useCallback((state: TimerStateResponse) => {
        const next = timerUiStateFromResponse(state);
        setRunningTimer(next.runningTimer);
        setPausedTimers(next.pausedTimers);
        setClockNow(Date.now());
    }, []);

    const refreshAttempts = useCallback(async () => {
        if (!organization) return;
        applyTimerState(await getOpenTimerAttempts(organization.id));
    }, [applyTimerState, organization]);

    const notifyTimerChange = useCallback((action: TimerMutationRequest['action']) => {
        for (const name of timerRefreshEvents(action)) {
            window.dispatchEvent(new Event(name));
        }
        try {
            localStorage.setItem('timer:data-changed', String(Date.now()));
        } catch {
            // Local storage is only a cross-tab notification fallback.
        }
        broadcastChannelRef.current?.postMessage({ type: 'timer:data-changed' });
    }, []);

    const mutate = useCallback(async (request: TimerMutationRequest) => {
        const state = await mutateTimer(request);
        applyTimerState(state);
        notifyTimerChange(request.action);
        return state;
    }, [applyTimerState, notifyTimerChange]);

    useEffect(() => {
        if (!runningTimer) return;
        const interval = window.setInterval(() => setClockNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, [runningTimer]);

    useEffect(() => {
        if (!runningTimer) {
            document.title = 'SEO Ops Center';
            return;
        }
        const duration = totalAttemptActiveSeconds(runningTimer, new Date(clockNow));
        const hours = Math.floor(duration / 3600);
        const minutes = Math.floor((duration % 3600) / 60);
        const seconds = duration % 60;
        const display = hours > 0
            ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
            : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        document.title = `⏱ ${display} — ${runningTimer.clientName || 'Timer'} | SEO Ops`;
    }, [clockNow, runningTimer]);

    useEffect(() => {
        void refreshAttempts();
    }, [refreshAttempts]);

    useEffect(() => {
        const refresh = () => void refreshAttempts();
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') refresh();
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key === 'timer:data-changed') refresh();
        };
        const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('timer:data-changed');
        broadcastChannelRef.current = channel;
        channel?.addEventListener('message', refresh);
        window.addEventListener('timer:data-changed', refresh);
        window.addEventListener('focus', refresh);
        window.addEventListener('storage', onStorage);
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            channel?.removeEventListener('message', refresh);
            channel?.close();
            if (broadcastChannelRef.current === channel) broadcastChannelRef.current = null;
            window.removeEventListener('timer:data-changed', refresh);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('storage', onStorage);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [refreshAttempts]);

    const browserTimeZone = useCallback(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        [],
    );

    const switchToTask = useCallback((target: TimerSwitchTarget, confirmSwitch: TimerSwitchConfirmation = confirmInBrowser) => (
        confirmAndSwitchTimer({
            running: runningTimer,
            target,
            confirm: confirmSwitch,
            mutate: request => mutate({ ...request, timeZone: browserTimeZone() }),
        })
    ), [browserTimeZone, mutate, runningTimer]);

    const pause = useCallback(async (attempt: TimerAttempt) => {
        if (attempt.id !== runningTimer?.id) return;
        await mutate({ action: 'pause', timeLogId: attempt.id });
    }, [mutate, runningTimer?.id]);

    const resume = useCallback(async (attempt: TimerAttempt, confirmSwitch?: TimerSwitchConfirmation, options?: ResumeTimerOptions) => {
        if (attempt.reviewingAt && !options?.continueReview) return false;
        if (runningTimer && runningTimer.id !== attempt.id) {
            return switchToTask({ timeLogId: attempt.id, title: attempt.taskTitle ?? attempt.clientName ?? 'this work' }, confirmSwitch);
        }
        if (runningTimer?.id === attempt.id) return true;
        await mutate({ action: 'resume', timeLogId: attempt.id });
        return true;
    }, [mutate, runningTimer, switchToTask]);

    const startTask = useCallback(async (options: StartTaskOptions, confirmSwitch?: TimerSwitchConfirmation) => {
        if (!options.taskId) return false;
        if (runningTimer && options.startedAt) {
            throw new Error('Pause or stop the current timer before starting from an earlier time.');
        }
        const decision = resolveTaskStart({
            taskId: options.taskId,
            plannerEventId: options.plannerEventId,
            startedAt: options.startedAt,
            running: runningTimer,
            paused: pausedTimers,
        });
        if (decision.action === 'noop') return true;
        if (decision.action === 'resume') {
            const attempt = pausedTimers.find(item => item.id === decision.attemptId);
            if (!attempt) return false;
            return resume(attempt, confirmSwitch);
        }
        if (decision.action === 'switch') {
            return switchToTask({
                taskId: options.taskId,
                title: options.taskTitle ?? options.clientName,
                plannerEventId: options.plannerEventId,
            }, confirmSwitch);
        }
        await mutate({
            ...startTimerMutation(options.taskId, options.startedAt, browserTimeZone()),
            ...(options.plannerEventId ? { plannerEventId: options.plannerEventId } : {}),
        });
        return true;
    }, [browserTimeZone, mutate, pausedTimers, resume, runningTimer, switchToTask]);

    const beginStop = useCallback(async (attempt: TimerAttempt) => {
        return mutate({ action: 'begin_stop', timeLogId: attempt.id });
    }, [mutate]);

    const finalize = useCallback(async (attempt: TimerAttempt, options: FinalizeTimerOptions) => {
        // No per-entry choice yet: send when this client already syncs its timesheet.
        const syncToBasecamp = options.syncToBasecamp
            ?? await getClientTimesheetSyncEnabled(attempt.clientId);
        const state = await mutate(finalizeTimerAttempt(attempt, {
            description: options.description,
            billable: options.billable,
            syncToBasecamp,
            markTaskComplete: options.markTaskComplete ?? false,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            ...(options.countsTowardBudget === undefined ? {} : { countsTowardBudget: options.countsTowardBudget }),
            ...(options.completedAt ? { completedAt: options.completedAt } : {}),
        }));
        if (!attempt.taskId || attempt.plannerEventId) return state;
        const updated = await updateTask(attempt.taskId, {
            scheduledMinutes: trackedBlockMinutes(totalAttemptActiveSeconds(attempt)),
        });
        if (updated.success) {
            window.dispatchEvent(new Event('planner:data-changed'));
            window.dispatchEvent(new Event('task:data-changed'));
        }
        return state;
    }, [mutate]);

    const discard = useCallback(async (attempt: TimerAttempt) => {
        await mutate({ action: 'discard', timeLogId: attempt.id });
    }, [mutate]);

    const replaceAttemptNotes = useCallback((attemptId: string, update: (notes: SessionNote[]) => SessionNote[]) => {
        const replace = (attempt: TimerAttempt) => attempt.id === attemptId ? { ...attempt, sessionNotes: update(attempt.sessionNotes) } : attempt;
        setRunningTimer(current => current ? replace(current) : null);
        setPausedTimers(current => current.map(replace));
    }, []);

    const attemptById = useCallback((attemptId: string) => findTimerAttempt({ runningTimer, pausedTimers }, attemptId), [pausedTimers, runningTimer]);

    const getAttemptById = useCallback((attemptId: string) => attemptById(attemptId) ?? null, [attemptById]);

    const addNote = useCallback(async (attemptId: string, text: string) => {
        if (!text.trim()) return;
        const attempt = attemptById(attemptId);
        if (!attempt) return;
        const notes = [...attempt.sessionNotes, { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString() }];
        replaceAttemptNotes(attemptId, () => notes);
        await updateSessionNotes(attemptId, notes);
    }, [attemptById, replaceAttemptNotes]);

    const editNote = useCallback(async (attemptId: string, noteId: string, text: string) => {
        if (!text.trim()) return;
        const attempt = attemptById(attemptId);
        if (!attempt) return;
        const notes = attempt.sessionNotes.map(note => note.id === noteId ? { ...note, text: text.trim() } : note);
        replaceAttemptNotes(attemptId, () => notes);
        await updateSessionNotes(attemptId, notes);
    }, [attemptById, replaceAttemptNotes]);

    const deleteNote = useCallback(async (attemptId: string, noteId: string) => {
        const attempt = attemptById(attemptId);
        if (!attempt) return;
        const notes = attempt.sessionNotes.filter(note => note.id !== noteId);
        replaceAttemptNotes(attemptId, () => notes);
        await updateSessionNotes(attemptId, notes);
    }, [attemptById, replaceAttemptNotes]);

    const value = useMemo(() => ({
        runningTimer,
        pausedTimers,
        getElapsedSeconds: (attempt: TimerAttempt) => totalAttemptActiveSeconds(attempt, new Date(clockNow)),
        startTask,
        pause,
        resume,
        switchToTask,
        beginStop,
        finalize,
        discard,
        addNote,
        editNote,
        deleteNote,
        getAttemptById,
    }), [addNote, beginStop, clockNow, deleteNote, discard, editNote, finalize, getAttemptById, pause, pausedTimers, resume, runningTimer, startTask, switchToTask]);

    return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
    const context = useContext(TimerContext);
    if (!context) throw new Error('useTimer must be used within TimerProvider');
    return context;
}
