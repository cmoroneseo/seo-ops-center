'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useOrganization } from './organization-provider';
import { createClient } from '@/lib/supabase/client';
import {
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    discardTimer,
    getInProgressTimer,
} from '@/lib/supabase/time-logs';

export interface ActiveTimer {
    id: string;
    clientId: string;
    clientName: string;
    taskId?: string;
    taskTitle?: string;
    elapsedSeconds: number; // live ticking value
    savedSeconds: number;   // last value persisted to DB
    status: 'running' | 'paused';
    startedAt: string;      // ISO — when timer_started_at was last set
}

interface TimerContextType {
    timer: ActiveTimer | null;
    isRecovering: boolean;
    start: (opts: { clientId: string; clientName: string; taskId?: string; taskTitle?: string }) => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    stop: (opts: { description: string; hours: number; billable: boolean; category?: string; date: string; clientId: string; taskId?: string }) => Promise<void>;
    discard: () => Promise<void>;
    dismissRecovery: () => void;
    recoveryTimer: ActiveTimer | null;
    acceptRecovery: () => void;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function TimerProvider({ children }: { children: React.ReactNode }) {
    const { organization } = useOrganization();
    const [timer, setTimer] = useState<ActiveTimer | null>(null);
    const [recoveryTimer, setRecoveryTimer] = useState<ActiveTimer | null>(null);
    const [isRecovering, setIsRecovering] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const userIdRef = useRef<string | null>(null);

    // Resolve current user ID
    useEffect(() => {
        const supabase = createClient();
        if (!supabase) {
            userIdRef.current = 'mock-user-1';
            return;
        }
        supabase.auth.getSession().then(({ data }: { data: { session: { user?: { id: string } } | null } }) => {
            userIdRef.current = data.session?.user?.id ?? null;
        });
    }, []);

    // Tick interval while timer is running
    useEffect(() => {
        if (timer?.status === 'running') {
            intervalRef.current = setInterval(() => {
                setTimer(prev => {
                    if (!prev || prev.status !== 'running') return prev;
                    const secondsSinceResume = Math.floor(
                        (Date.now() - new Date(prev.startedAt).getTime()) / 1000
                    );
                    return { ...prev, elapsedSeconds: prev.savedSeconds + secondsSinceResume };
                });
            }, 1000);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [timer?.status]);

    // Update browser tab title while timer is active
    useEffect(() => {
        if (!timer) {
            document.title = 'SEO Ops Center';
            return;
        }
        const h = Math.floor(timer.elapsedSeconds / 3600);
        const m = Math.floor((timer.elapsedSeconds % 3600) / 60);
        const s = timer.elapsedSeconds % 60;
        const elapsed = h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        const icon = timer.status === 'running' ? '⏱' : '⏸';
        document.title = `${icon} ${elapsed} — ${timer.clientName || 'Timer'} | SEO Ops`;
    }, [timer?.elapsedSeconds, timer?.status, timer?.clientName]);

    // On mount: check for an orphaned in-progress timer (session recovery)
    useEffect(() => {
        if (!organization) return;
        const tryRecover = async () => {
            // Small delay to ensure userIdRef is populated
            await new Promise(r => setTimeout(r, 500));
            const userId = userIdRef.current;
            if (!userId) return;

            const existing = await getInProgressTimer(organization.id, userId);
            if (!existing) return;

            // Reconstruct elapsed time
            const savedSeconds = existing.elapsedSeconds;
            const startedAt = existing.timerStartedAt;
            const liveSecs = startedAt
                ? savedSeconds + Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
                : savedSeconds;

            const recovered: ActiveTimer = {
                id: existing.id,
                clientId: existing.clientId,
                clientName: '', // will be resolved by caller after dismissal
                elapsedSeconds: liveSecs,
                savedSeconds,
                status: startedAt ? 'running' : 'paused',
                startedAt: startedAt ?? new Date().toISOString(),
            };
            setRecoveryTimer(recovered);
            setIsRecovering(true);
        };
        tryRecover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [organization?.id]);

    const start = useCallback(async (opts: {
        clientId: string;
        clientName: string;
        taskId?: string;
        taskTitle?: string;
    }) => {
        if (!organization || !userIdRef.current) return;

        // If there is already a running timer, pause it first
        if (timer?.status === 'running') {
            await pauseTimer(timer.id, timer.elapsedSeconds);
        }

        const result = await startTimer({
            organizationId: organization.id,
            userId: userIdRef.current,
            clientId: opts.clientId,
            taskId: opts.taskId,
        });
        if (!result.success || !result.id) return;

        const now = new Date().toISOString();
        setTimer({
            id: result.id,
            clientId: opts.clientId,
            clientName: opts.clientName,
            taskId: opts.taskId,
            taskTitle: opts.taskTitle,
            elapsedSeconds: 0,
            savedSeconds: 0,
            status: 'running',
            startedAt: now,
        });
    }, [organization, timer]);

    const pause = useCallback(async () => {
        if (!timer || timer.status !== 'running') return;
        await pauseTimer(timer.id, timer.elapsedSeconds);
        setTimer(prev => prev ? { ...prev, status: 'paused', savedSeconds: prev.elapsedSeconds } : null);
    }, [timer]);

    const resume = useCallback(async () => {
        if (!timer || timer.status !== 'paused') return;
        const now = new Date().toISOString();
        await resumeTimer(timer.id);
        setTimer(prev => prev ? { ...prev, status: 'running', startedAt: now, savedSeconds: prev.elapsedSeconds } : null);
    }, [timer]);

    const stop = useCallback(async (opts: {
        description: string;
        hours: number;
        billable: boolean;
        category?: string;
        date: string;
        clientId: string;
        taskId?: string;
    }) => {
        if (!timer) return;
        await stopTimer(timer.id, opts);
        setTimer(null);
    }, [timer]);

    const discard = useCallback(async () => {
        if (!timer) return;
        await discardTimer(timer.id);
        setTimer(null);
    }, [timer]);

    const acceptRecovery = useCallback(() => {
        if (!recoveryTimer) return;
        setTimer({ ...recoveryTimer, status: recoveryTimer.status });
        setRecoveryTimer(null);
        setIsRecovering(false);
    }, [recoveryTimer]);

    const dismissRecovery = useCallback(async () => {
        if (recoveryTimer) {
            await discardTimer(recoveryTimer.id);
        }
        setRecoveryTimer(null);
        setIsRecovering(false);
    }, [recoveryTimer]);

    return (
        <TimerContext.Provider value={{
            timer,
            isRecovering,
            recoveryTimer,
            start,
            pause,
            resume,
            stop,
            discard,
            dismissRecovery,
            acceptRecovery,
        }}>
            {children}
        </TimerContext.Provider>
    );
}

export function useTimer() {
    const ctx = useContext(TimerContext);
    if (!ctx) throw new Error('useTimer must be used within TimerProvider');
    return ctx;
}
