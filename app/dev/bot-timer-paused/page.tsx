'use client';

import { LedgerInspector } from '@/components/timesheets/LedgerInspector';
import { WeeklyLedgerGrid } from '@/components/timesheets/WeeklyLedgerGrid';
import { buildWeeklyLedger, type LedgerLog } from '@/lib/timesheets/ledger';
import { taskStretchLines } from '@/lib/timer/task-stretches';

/**
 * Dev-only picture of a paused bot timer. The rows are fixtures. This page
 * does not read or write time_logs and it is not a client task.
 */
export default function BotTimerPausedFixturePage() {
    if (process.env.NODE_ENV === 'production') {
        return null;
    }

    const entries: LedgerLog[] = [
        {
            id: 'fixture-paused',
            organizationId: 'fixture-org',
            clientId: 'fixture-client',
            clientName: 'Fixture Client (not real)',
            taskId: 'fixture-task',
            taskTitle: 'Fixture — August brief',
            userId: 'fixture-user',
            date: '2026-11-03',
            hours: 0.5,
            description: 'Mapped the keyword set\nChecked the top ten',
            countsTowardBudget: true,
            status: 'paused',
            source: 'seo_pm',
            importStatus: 'mapped',
            pausedAt: '2026-11-03T18:30:00.000Z',
        },
        {
            id: 'fixture-logged',
            organizationId: 'fixture-org',
            clientId: 'fixture-client',
            clientName: 'Fixture Client (not real)',
            taskId: 'fixture-other',
            taskTitle: 'Fixture — already logged',
            userId: 'fixture-user',
            date: '2026-11-03',
            hours: 1,
            description: 'Confirmed sample hour',
            countsTowardBudget: true,
            status: 'logged',
            source: 'seo_pm',
            importStatus: 'mapped',
        },
    ];
    const ledger = buildWeeklyLedger(entries, '2026-11-02', {
        now: new Date('2026-11-03T20:00:00.000Z'),
    });
    const pausedGroup = ledger.clients.find(group => group.paused);
    const pausedRow = pausedGroup?.rows[0];
    const stretches = taskStretchLines({
        status: 'paused',
        segments: [
            {
                startedAt: '2026-11-03T18:00:00.000Z',
                endedAt: '2026-11-03T18:30:00.000Z',
                note: 'Mapped the keyword set\nChecked the top ten',
            },
        ],
    }) ?? [];

    return (
        <main className="mx-auto max-w-6xl space-y-8 bg-background p-8 text-foreground">
            <header className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fixture — not a real client</p>
                <h1 className="text-2xl font-semibold">Paused bot timer</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                    Sample data only. Nothing on this screen is saved, and it is not a client task.
                    The grid is the timesheet. The list is what the task drawer shows for each stretch.
                </p>
            </header>
            <WeeklyLedgerGrid
                ledger={ledger}
                today="2026-11-03"
                selectedRowKey={pausedRow?.key ?? null}
                onSelectRow={() => undefined}
            />
            {pausedGroup && pausedRow && (
                <div className="max-w-md">
                    <LedgerInspector
                        group={pausedGroup}
                        row={pausedRow}
                        entries={entries}
                        onClose={() => undefined}
                        onAddTime={() => undefined}
                    />
                </div>
            )}
            <section className="max-w-md space-y-2 rounded-xl border border-border bg-card p-4" aria-label="Task drawer stretches">
                <h2 className="text-sm font-semibold">Fixture — August brief</h2>
                <p className="text-[11px] text-muted-foreground">Paused</p>
                <ul className="space-y-1.5" data-bot-stretches>
                    {stretches.map(stretch => (
                        <li key={stretch.startedAt} className="text-sm text-muted-foreground">
                            <span className="text-foreground">
                                {stretch.endedAt
                                    ? `${new Date(stretch.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(stretch.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                    : 'Still running'}
                            </span>
                            {stretch.note && <span className="mt-0.5 block whitespace-pre-line">{stretch.note}</span>}
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
