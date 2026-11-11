'use client';

import { useEffect, useState } from 'react';
import { TimerContext } from '@/components/providers/timer-provider';
import { BotTimerChip } from '@/components/timer/BotTimerChip';
import { FloatingTimer } from '@/components/timer/FloatingTimer';
import { StagePlanListView } from '@/components/seo-plan/StagePlanListView';
import { botTimerElapsedSeconds, formatOpenTaskHours, taskHoursWithBotTimers, type BotTimerClock } from '@/lib/timer/bot-display';
import type { StageListTask } from '@/lib/seo-plan/stage-list';
import type { TimerAttempt } from '@/lib/types';

/**
 * Dev-only picture of a running bot timer next to a person's timer.
 * Every row is a fixture. This page does not read or write time_logs,
 * tasks, or Basecamp.
 */
export default function BotTimerRunningFixturePage() {
    if (process.env.NODE_ENV === 'production') return null;
    return <Fixture />;
}

const TASKS: StageListTask[] = [
    {
        id: 'fixture-brief',
        title: 'Fixture — August brief',
        status: 'in_progress',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-11-03T18:00:00.000Z',
        category: 'content',
        basecamp: false,
        recurring: false,
        dueDate: '2026-11-12',
    },
    {
        id: 'fixture-mine',
        title: 'Fixture — My own notes',
        status: 'in_progress',
        stage: 'backlog',
        position: 2,
        parentTaskId: null,
        createdAt: '2026-11-03T18:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        dueDate: '2026-11-12',
    },
];

function Fixture() {
    const [startedAt, setStartedAt] = useState<string | null>(null);
    const [now, setNow] = useState(0);
    const [phase, setPhase] = useState<'running' | 'paused' | 'stopped'>('running');
    const [pausedSeconds, setPausedSeconds] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        const opened = new Date(Date.now() - 125_000).toISOString();
        setStartedAt(opened);
        setNow(Date.now());
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, []);

    const bot: BotTimerClock = {
        id: 'fixture-bot-timer',
        taskId: 'fixture-brief',
        taskTitle: 'Fixture — August brief',
        clientName: 'Fixture Client (not real)',
        botKeyId: 'fixture-key',
        botName: 'seo-manager',
        phase: phase === 'paused' ? 'paused' : 'running',
        openStartedAt: phase === 'running' ? startedAt : null,
        stretches: phase === 'running' || !startedAt ? [] : [{ startedAt, endedAt: new Date(Date.parse(startedAt) + pausedSeconds * 1000).toISOString() }],
        billable: true,
        countsTowardBudget: true,
    };
    const seconds = phase === 'stopped'
        ? 0
        : phase === 'paused'
            ? pausedSeconds
            : botTimerElapsedSeconds(bot, new Date(now));
    const liveHours = phase === 'stopped' ? 0.03 : taskHoursWithBotTimers(0, [bot], new Date(now));

    const human: TimerAttempt = {
        id: 'fixture-human',
        organizationId: 'fixture-org',
        clientName: 'Fixture Client (not real)',
        taskId: 'fixture-mine',
        taskTitle: 'Fixture — My own notes',
        userId: 'fixture-carlos',
        date: '2026-11-11',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 0,
        sessionNotes: [],
        source: 'seo_pm',
        importStatus: 'mapped',
        timerStartedAt: now > 0 ? new Date(now - 45_000).toISOString() : undefined,
        segments: [],
    };

    const pauseBot = () => {
        if (phase !== 'running') return;
        setPausedSeconds(botTimerElapsedSeconds(bot, new Date()));
        setPhase('paused');
        setNotice('Paused. Nothing was sent to Basecamp. This is fixture data.');
    };
    const resumeBot = () => {
        setPhase('running');
        setNotice(null);
    };
    const stopBot = () => {
        setPhase('stopped');
        setNotice('Stopped. One timesheet entry would be saved, and the note would not include the clock. Nothing here was sent to Basecamp.');
    };

    return (
        <TimerContext.Provider
            value={{
                runningTimer: human,
                pausedTimers: [],
                getElapsedSeconds: () => (now === 0 ? 45 : Math.max(0, Math.round((Date.now() - (now - 45_000)) / 1000))),
                startTask: async () => true,
                pause: async () => undefined,
                resume: async () => true,
                switchToTask: async () => true,
                beginStop: async () => ({ running: human, paused: [] }),
                finalize: async () => ({ running: null, paused: [] }),
                discard: async () => undefined,
                addNote: async () => undefined,
                editNote: async () => undefined,
                deleteNote: async () => undefined,
                getAttemptById: () => human,
                botTimers: phase === 'stopped' ? [] : [bot],
                getBotElapsedSeconds: () => seconds,
                pauseBotTimer: async () => { pauseBot(); },
                resumeBotTimer: async () => { resumeBot(); },
                stopBotTimer: async () => { stopBot(); return { capped: false }; },
                stopBotTimersOnTask: async () => { stopBot(); return { ok: true, capped: false }; },
            }}
        >
            <main className="min-h-screen bg-background p-6 text-foreground">
                <header className="mb-6 max-w-3xl space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixture — not a real client</p>
                    <h1 className="text-2xl font-semibold">Bot timer running</h1>
                    <p className="text-sm text-muted-foreground">
                        Sample data only. The row, the floating timers, and the task view are the same controls as the app.
                        Nothing on this screen is saved, and it does not send time to Basecamp.
                    </p>
                    {notice && <p role="status" data-fixture-notice className="text-sm text-foreground">{notice}</p>}
                </header>
                <div className="grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <section aria-label="Task list" className="rounded-xl border border-border bg-card p-3">
                        <StagePlanListView
                            tasks={TASKS}
                            query=""
                            onQueryChange={() => undefined}
                            onOpenTask={() => undefined}
                            onAddTasks={async () => undefined}
                            onReorder={async () => undefined}
                            today="2026-11-11"
                            initialMonth="2026-11"
                            clientName="Fixture Client (not real)"
                            loggedHours={{ 'fixture-brief': 0, 'fixture-mine': 0 }}
                            timerByTaskId={phase === 'stopped' ? {
                                'fixture-mine': { phase: 'running', seconds: 45, owner: 'human' },
                            } : {
                                'fixture-brief': {
                                    phase: phase === 'paused' ? 'paused' : 'running',
                                    seconds,
                                    owner: 'bot',
                                    botTimerId: bot.id,
                                    botLabel: 'seo-manager bot',
                                },
                                'fixture-mine': { phase: 'running', seconds: 45, owner: 'human' },
                            }}
                            onRowTimer={() => {
                                if (phase === 'running') pauseBot();
                                else if (phase === 'paused') resumeBot();
                            }}
                        />
                    </section>
                    <section aria-label="Task view" data-fixture-task-view className="space-y-3 rounded-xl border border-border bg-card p-4">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task view</p>
                        <h2 className="text-lg font-semibold">Fixture — August brief</h2>
                        <p className="text-sm text-muted-foreground">Fixture Client (not real)</p>
                        {phase === 'stopped' ? (
                            <p className="text-sm">0.0h logged. The bot timer is stopped.</p>
                        ) : (
                            <>
                                <BotTimerChip
                                    timer={bot}
                                    seconds={seconds}
                                    onPause={() => pauseBot()}
                                    onResume={() => resumeBot()}
                                    onStop={() => stopBot()}
                                />
                                <p data-task-live-hours className="text-sm font-semibold">{formatOpenTaskHours(liveHours)} so far</p>
                            </>
                        )}
                    </section>
                </div>
                <FloatingTimer clients={[]} />
            </main>
        </TimerContext.Provider>
    );
}
