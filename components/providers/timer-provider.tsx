'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useOrganization } from './organization-provider';
import { getOpenTimerAttempts, mutateTimer, updateSessionNotes } from '@/lib/supabase/time-logs';
import type { SessionNote, TimerAttempt } from '@/lib/types';
import type { TimerMutationRequest, TimerStateResponse } from '@/lib/timer/contracts';
import { getTask, updateTask } from '@/lib/supabase/tasks';
import { shouldMoveBlockToNow, trackedBlockMinutes } from '@/lib/planner/timer-sync';
import { timerSwitchPrompt } from '@/lib/timer-ui';

export { timerSwitchPrompt } from '@/lib/timer-ui';

export interface StartTaskOptions {
    clientId?: string;
    clientName: string;
    taskId?: string;
    taskTitle?: string;
    plannerEventId?: string;
    countsTowardBudget?: boolean;
}

export interface FinalizeTimerOptions {
    description: string;
    billable: boolean;
    countsTowardBudget?: boolean;
    syncToBasecamp?: boolean;
    markTaskComplete?: boolean;
}

export type TimerSwitchConfirmation = (prompt: string) => boolean | Promise<boolean>;

function elapsedSeconds(attempt: TimerAttempt, now: number): number {
    if (!attempt.timerStartedAt || attempt.reviewingAt) return attempt.elapsedSeconds;
    return attempt.elapsedSeconds + Math.max(0, Math.floor((now - new Date(attempt.timerStartedAt).getTime()) / 1000));
}

function mostRecentlyClosedFirst(left: TimerAttempt, right: TimerAttempt): number {
    const closedAt = (attempt: TimerAttempt) => attempt.segments
        .filter(segment => segment.endedAt)
        .reduce((latest, segment) => segment.endedAt! > latest ? segment.endedAt! : latest, attempt.reviewingAt ?? '');
    return closedAt(right).localeCompare(closedAt(left));
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
    resume: (attempt: TimerAttempt, confirmSwitch?: TimerSwitchConfirmation) => Promise<boolean>;
    switchToTask: (target: { taskId?: string; timeLogId?: string; title: string }, confirmSwitch?: TimerSwitchConfirmation) => Promise<boolean>;
    beginStop: (attempt: TimerAttempt) => Promise<TimerStateResponse | null>;
    finalize: (attempt: TimerAttempt, options: FinalizeTimerOptions) => Promise<void>;
    discard: (attempt: TimerAttempt) => Promise<void>;
    addNote: (attemptId: string, text: string) => Promise<void>;
    editNote: (attemptId: string, noteId: string, text: string) => Promise<void>;
    deleteNote: (attemptId: string, noteId: string) => Promise<void>;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function TimerProvider({ children }: { children: React.ReactNode }) {
    const { organization } = useOrganization();
    const [runningTimer, setRunningTimer] = useState<TimerAttempt | null>(null);
    const [pausedTimers, setPausedTimers] = useState<TimerAttempt[]>([]);
    const [clockNow, setClockNow] = useState(() => Date.now());
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    const applyTimerState = useCallback((state: TimerStateResponse) => {
        setRunningTimer(state.running);
        setPausedTimers([...state.paused].sort(mostRecentlyClosedFirst));
        setClockNow(Date.now());
    }, []);

    const refreshAttempts = useCallback(async () => {
        if (!organization) return;
        applyTimerState(await getOpenTimerAttempts(organization.id));
    }, [applyTimerState, organization]);

    const notifyTimerChange = useCallback(() => {
        window.dispatchEvent(new Event('planner:data-changed'));
        window.dispatchEvent(new Event('timer:data-changed'));
        window.dispatchEvent(new Event('client-activity:data-changed'));
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
        notifyTimerChange();
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
        const duration = elapsedSeconds(runningTimer, clockNow);
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

    const switchToTask = useCallback(async (
        target: { taskId?: string; timeLogId?: string; title: string },
        confirmSwitch: TimerSwitchConfirmation = confirmInBrowser,
    ) => {
        if (!runningTimer || (!target.taskId && !target.timeLogId)) return false;
        if (!await confirmSwitch(timerSwitchPrompt(runningTimer, target.title))) return false;
        await mutate({
            action: 'switch',
            fromTimeLogId: runningTimer.id,
            ...(target.timeLogId ? { toTimeLogId: target.timeLogId } : { toTaskId: target.taskId! }),
        });
        return true;
    }, [mutate, runningTimer]);

    const movePlannerBlockToStart = useCallback(async (taskId: string) => {
        const now = new Date();
        const { task } = await getTask(taskId);
        if (!task || !shouldMoveBlockToNow(task.startDate, now)) return;
        const updated = await updateTask(taskId, { startDate: now.toISOString() });
        if (updated.success) window.dispatchEvent(new Event('planner:data-changed'));
    }, []);

    const startTask = useCallback(async (options: StartTaskOptions, confirmSwitch?: TimerSwitchConfirmation) => {
        if (!options.taskId) return false;
        if (runningTimer) {
            const switched = await switchToTask({ taskId: options.taskId, title: options.taskTitle ?? options.clientName }, confirmSwitch);
            if (switched) void movePlannerBlockToStart(options.taskId);
            return switched;
        }
        await mutate({ action: 'start', taskId: options.taskId });
        void movePlannerBlockToStart(options.taskId);
        return true;
    }, [movePlannerBlockToStart, mutate, runningTimer, switchToTask]);

    const pause = useCallback(async (attempt: TimerAttempt) => {
        if (attempt.id !== runningTimer?.id) return;
        await mutate({ action: 'pause', timeLogId: attempt.id });
    }, [mutate, runningTimer?.id]);

    const resume = useCallback(async (attempt: TimerAttempt, confirmSwitch?: TimerSwitchConfirmation) => {
        if (attempt.reviewingAt) return false;
        if (runningTimer && runningTimer.id !== attempt.id) {
            return switchToTask({ timeLogId: attempt.id, title: attempt.taskTitle ?? attempt.clientName ?? 'this work' }, confirmSwitch);
        }
        if (runningTimer?.id === attempt.id) return true;
        await mutate({ action: 'resume', timeLogId: attempt.id });
        return true;
    }, [mutate, runningTimer, switchToTask]);

    const beginStop = useCallback(async (attempt: TimerAttempt) => {
        return mutate({ action: 'begin_stop', timeLogId: attempt.id });
    }, [mutate]);

    const finalize = useCallback(async (attempt: TimerAttempt, options: FinalizeTimerOptions) => {
        await mutate({
            action: 'finalize',
            timeLogId: attempt.id,
            description: options.description,
            billable: options.billable,
            countsTowardBudget: options.countsTowardBudget ?? true,
            syncToBasecamp: options.syncToBasecamp ?? false,
            markTaskComplete: options.markTaskComplete ?? false,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        });
        if (!attempt.taskId) return;
        const updated = await updateTask(attempt.taskId, {
            scheduledMinutes: trackedBlockMinutes(elapsedSeconds(attempt, Date.now())),
        });
        if (updated.success) window.dispatchEvent(new Event('planner:data-changed'));
    }, [mutate]);

    const discard = useCallback(async (attempt: TimerAttempt) => {
        await mutate({ action: 'discard', timeLogId: attempt.id });
    }, [mutate]);

    const replaceAttemptNotes = useCallback((attemptId: string, update: (notes: SessionNote[]) => SessionNote[]) => {
        const replace = (attempt: TimerAttempt) => attempt.id === attemptId ? { ...attempt, sessionNotes: update(attempt.sessionNotes) } : attempt;
        setRunningTimer(current => current ? replace(current) : null);
        setPausedTimers(current => current.map(replace));
    }, []);

    const attemptById = useCallback((attemptId: string) => runningTimer?.id === attemptId
        ? runningTimer
        : pausedTimers.find(item => item.id === attemptId), [pausedTimers, runningTimer]);

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
        getElapsedSeconds: (attempt: TimerAttempt) => elapsedSeconds(attempt, clockNow),
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
    }), [addNote, beginStop, clockNow, deleteNote, discard, editNote, finalize, pause, pausedTimers, resume, runningTimer, startTask, switchToTask]);

    return <TimerContext.Provider value={value}>{children}</TimerContext.Provider>;
}

export function useTimer() {
    const context = useContext(TimerContext);
    if (!context) throw new Error('useTimer must be used within TimerProvider');
    return context;
}
