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
    updateSessionNotes,
} from '@/lib/supabase/time-logs';
import { SessionNote } from '@/lib/types';

export interface ActiveTimer {
    id: string;
    clientId: string;
    clientName: string;
    taskId?: string;
    taskTitle?: string;
    elapsedSeconds: number;
    savedSeconds: number;
    status: 'running' | 'paused';
    startedAt: string;
}

interface TimerContextType {
    timer: ActiveTimer | null;
    notes: SessionNote[];
    isRecovering: boolean;
    recoveryTimer: ActiveTimer | null;
    start: (opts: { clientId: string; clientName: string; taskId?: string; taskTitle?: string }) => Promise<void>;
    pause: () => Promise<void>;
    resume: () => Promise<void>;
    stop: (opts: { description: string; hours: number; billable: boolean; category?: string; date: string; clientId: string; taskId?: string }) => Promise<void>;
    discard: () => Promise<void>;
    addNote: (text: string) => Promise<void>;
    editNote: (id: string, newText: string) => Promise<void>;
    deleteNote: (id: string) => Promise<void>;
    acceptRecovery: () => void;
    dismissRecovery: () => Promise<void>;
}

const TimerContext = createContext<TimerContextType | undefined>(undefined);

export function TimerProvider({ children }: { children: React.ReactNode }) {
    const { organization } = useOrganization();
    const [timer, setTimer] = useState<ActiveTimer | null>(null);
    const [notes, setNotes] = useState<SessionNote[]>([]);
    const [recoveryTimer, setRecoveryTimer] = useState<ActiveTimer | null>(null);
    const [isRecovering, setIsRecovering] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const userIdRef = useRef<string | null>(null);
    const timerIdRef = useRef<string | null>(null);

    // Keep timerIdRef in sync so note callbacks always have the current ID
    useEffect(() => {
        timerIdRef.current = timer?.id ?? null;
    }, [timer?.id]);

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

    // Tick interval
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

    // Browser tab title
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

    // Session recovery
    useEffect(() => {
        if (!organization) return;
        const tryRecover = async () => {
            await new Promise(r => setTimeout(r, 500));
            const userId = userIdRef.current;
            if (!userId) return;

            const existing = await getInProgressTimer(organization.id, userId);
            if (!existing) return;

            const savedSeconds = existing.elapsedSeconds;
            const startedAt = existing.timerStartedAt;
            const liveSecs = startedAt
                ? savedSeconds + Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
                : savedSeconds;

            const recovered: ActiveTimer = {
                id: existing.id,
                clientId: existing.clientId,
                clientName: '',
                taskId: existing.taskId ?? undefined,
                taskTitle: existing.description ?? undefined,
                elapsedSeconds: liveSecs,
                savedSeconds,
                status: startedAt ? 'running' : 'paused',
                startedAt: startedAt ?? new Date().toISOString(),
            };
            setRecoveryTimer(recovered);
            setNotes(existing.sessionNotes ?? []);
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
        setNotes([]);
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
        setNotes([]);
    }, [timer]);

    const discard = useCallback(async () => {
        if (!timer) return;
        await discardTimer(timer.id);
        setTimer(null);
        setNotes([]);
    }, [timer]);

    const addNote = useCallback(async (text: string) => {
        const id = timerIdRef.current;
        if (!id || !text.trim()) return;
        const note: SessionNote = {
            id: crypto.randomUUID(),
            text: text.trim(),
            createdAt: new Date().toISOString(),
        };
        setNotes(prev => {
            const updated = [...prev, note];
            updateSessionNotes(id, updated);
            return updated;
        });
    }, []);

    const editNote = useCallback(async (noteId: string, newText: string) => {
        const id = timerIdRef.current;
        if (!id || !newText.trim()) return;
        setNotes(prev => {
            const updated = prev.map(n => n.id === noteId ? { ...n, text: newText.trim() } : n);
            updateSessionNotes(id, updated);
            return updated;
        });
    }, []);

    const deleteNote = useCallback(async (noteId: string) => {
        const id = timerIdRef.current;
        if (!id) return;
        setNotes(prev => {
            const updated = prev.filter(n => n.id !== noteId);
            updateSessionNotes(id, updated);
            return updated;
        });
    }, []);

    const acceptRecovery = useCallback(() => {
        if (!recoveryTimer) return;
        setTimer({ ...recoveryTimer });
        setRecoveryTimer(null);
        setIsRecovering(false);
    }, [recoveryTimer]);

    const dismissRecovery = useCallback(async () => {
        if (recoveryTimer) await discardTimer(recoveryTimer.id);
        setRecoveryTimer(null);
        setNotes([]);
        setIsRecovering(false);
    }, [recoveryTimer]);

    return (
        <TimerContext.Provider value={{
            timer,
            notes,
            isRecovering,
            recoveryTimer,
            start,
            pause,
            resume,
            stop,
            discard,
            addNote,
            editNote,
            deleteNote,
            acceptRecovery,
            dismissRecovery,
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
